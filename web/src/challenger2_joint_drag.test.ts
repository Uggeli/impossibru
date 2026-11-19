import { describe, it, expect, beforeEach } from 'vitest';
import {
  pose,
  transform,
  inverseRigid,
  mv,
  ProjectError,
  validateProject,
} from './engine';
import { browserRequest, starterProject } from './runtime';
import { setupTestEnvironment } from './test-helpers';
import type { ProjectDocument, Vec3 } from './types';

function createDeepHierarchyDocument(depth: number): ProjectDocument {
  const doc: ProjectDocument = starterProject();
  const bones: Record<string, any> = {
    bone_0: {
      part: 'part',
      translation: [5, 10, 15],
      rotation: [15, 30, 45],
    },
  };

  for (let i = 1; i < depth; i++) {
    bones[`bone_${i}`] = {
      parent: `bone_${i - 1}`,
      translation: [i * 2, -i * 3, i * 1.5],
      rotation: [(i * 25) % 180, (i * 35) % 180, (i * 45) % 180],
    };
  }

  doc.rig = { bones, ik_chains: {} };
  return doc;
}

function getBoneWorldPos(worldTransforms: Record<string, number[]>, boneName: string): Vec3 {
  const m = worldTransforms[boneName];
  return [m[3], m[7], m[11]];
}

function dist3D(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('Challenger 2: Rest-mode joint dragging math across deep bone hierarchies', () => {
  beforeEach(() => {
    setupTestEnvironment();
  });
  it('correctly updates root bone (no parent)', () => {
    const doc = createDeepHierarchyDocument(3);
    const targetWorld: Vec3 = [120, -45, 78.5];

    // Simulate rest joint drag for root
    const b = doc.rig.bones.bone_0;
    b.translation = [targetWorld[0], targetWorld[1], targetWorld[2]];

    const worldTransforms = pose(doc);
    const pos = getBoneWorldPos(worldTransforms, 'bone_0');

    expect(dist3D(pos, targetWorld)).toBeLessThan(1e-6);
  });

  it('correctly updates 1-level child bone with rotated/translated parent', () => {
    const doc = createDeepHierarchyDocument(3);
    const targetWorld: Vec3 = [-50, 75, -20.25];

    // Drag bone_1 (child of bone_0)
    const b = doc.rig.bones.bone_1;
    const worldTransformsBefore = pose(doc);
    const parentMat = worldTransformsBefore[b.parent!];
    const inv = inverseRigid(parentMat);
    const local = mv(inv, targetWorld);
    b.translation = [local[0], local[1], local[2]];

    const worldTransformsAfter = pose(doc);
    const pos = getBoneWorldPos(worldTransformsAfter, 'bone_1');

    expect(dist3D(pos, targetWorld)).toBeLessThan(1e-5);
  });

  it('correctly updates deep bone (depth 10) in complex rotated hierarchy', () => {
    const depth = 10;
    const doc = createDeepHierarchyDocument(depth);
    const targetPoints: Vec3[] = [
      [100, 200, 300],
      [-50.5, 12.25, -99.75],
      [0, 0, 0],
      [-250, -350, -450],
      [15.123, -42.857, 108.991],
    ];

    for (const targetWorld of targetPoints) {
      const leafBone = `bone_${depth - 1}`;
      const b = doc.rig.bones[leafBone];

      const worldTransformsBefore = pose(doc);
      const parentMat = worldTransformsBefore[b.parent!];
      const inv = inverseRigid(parentMat);
      const local = mv(inv, targetWorld);
      b.translation = [local[0], local[1], local[2]];

      const worldTransformsAfter = pose(doc);
      const pos = getBoneWorldPos(worldTransformsAfter, leafBone);

      expect(dist3D(pos, targetWorld)).toBeLessThan(1e-4);
    }
  });

  it('preserves ancestor transforms when dragging a child bone', () => {
    const doc = createDeepHierarchyDocument(6);
    const worldBefore = pose(doc);
    const ancestorPositionsBefore = [0, 1, 2, 3, 4].map((i) =>
      getBoneWorldPos(worldBefore, `bone_${i}`)
    );

    // Drag bone_5
    const b = doc.rig.bones.bone_5;
    const parentMat = worldBefore[b.parent!];
    const inv = inverseRigid(parentMat);
    const targetWorld: Vec3 = [999, -888, 777];
    const local = mv(inv, targetWorld);
    b.translation = [local[0], local[1], local[2]];

    const worldAfter = pose(doc);
    const ancestorPositionsAfter = [0, 1, 2, 3, 4].map((i) =>
      getBoneWorldPos(worldAfter, `bone_${i}`)
    );

    // Verify all ancestors remained at their exact prior world positions
    for (let i = 0; i < 5; i++) {
      expect(dist3D(ancestorPositionsBefore[i], ancestorPositionsAfter[i])).toBeLessThan(1e-6);
    }

    // Verify bone_5 is at target
    expect(dist3D(getBoneWorldPos(worldAfter, 'bone_5'), targetWorld)).toBeLessThan(1e-4);
  });

  it('sequential drags across multiple hierarchy levels behave consistently', () => {
    const doc = createDeepHierarchyDocument(8);

    // Drag bone_3 to target_3
    const target3: Vec3 = [40, -10, 25];
    let world = pose(doc);
    let inv = inverseRigid(world[doc.rig.bones.bone_3.parent!]);
    let local = mv(inv, target3);
    doc.rig.bones.bone_3.translation = [local[0], local[1], local[2]];

    world = pose(doc);
    expect(dist3D(getBoneWorldPos(world, 'bone_3'), target3)).toBeLessThan(1e-5);

    // Drag bone_7 to target_7
    const target7: Vec3 = [-100, 80, -30];
    inv = inverseRigid(world[doc.rig.bones.bone_7.parent!]);
    local = mv(inv, target7);
    doc.rig.bones.bone_7.translation = [local[0], local[1], local[2]];

    world = pose(doc);
    expect(dist3D(getBoneWorldPos(world, 'bone_3'), target3)).toBeLessThan(1e-5);
    expect(dist3D(getBoneWorldPos(world, 'bone_7'), target7)).toBeLessThan(1e-4);
  });

  it('browserRequest /api/rig/drag unprojects screen coordinates correctly across camera angles', async () => {
    const doc = createDeepHierarchyDocument(4);
    const origin = doc.export!.origin;
    const scale = doc.export!.scale;

    const testAngles = [0, 45, 90, 135, 180, 225, 270, 315];
    for (const direction of testAngles) {
      const screen = [origin[0] + 30 * scale, origin[1] - 20 * scale]; // x_unscaled = 30, y_unscaled = 20
      const depth = 15;

      const res = await browserRequest('/api/rig/drag', {
        method: 'POST',
        body: JSON.stringify({
          document: doc,
          kind: 'joint',
          mode: 'rest',
          name: 'bone_3',
          screen,
          direction,
          depth,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      const updatedDoc = data.document;

      // Calculate expected world position from screen unprojection formula
      const a = (direction * Math.PI) / 180;
      const x = 30;
      const y = 20;
      const z = depth;
      const expectedWorld: Vec3 = [
        Math.cos(a) * x - Math.sin(a) * z,
        y,
        Math.sin(a) * x + Math.cos(a) * z,
      ];

      const worldTransforms = pose(updatedDoc);
      const actualPos = getBoneWorldPos(worldTransforms, 'bone_3');
      expect(dist3D(actualPos, expectedWorld)).toBeLessThan(1e-4);
    }
  });

  it('browserRequest /api/rig/drag throws 422 for unknown bone', async () => {
    const doc = createDeepHierarchyDocument(3);
    const res = await browserRequest('/api/rig/drag', {
      method: 'POST',
      body: JSON.stringify({
        document: doc,
        kind: 'joint',
        mode: 'rest',
        name: 'non_existent_bone',
        screen: [48, 88],
        direction: 0,
        depth: 0,
      }),
    });
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.valid).toBe(false);
    expect(data.error.message).toContain("unknown bone 'non_existent_bone'");
  });
});
