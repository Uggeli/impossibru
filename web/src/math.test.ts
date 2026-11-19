import { describe, expect, it } from 'vitest';
import { normalizeAngle, pose, reparent, ProjectError } from './engine';
import { starterProject } from './runtime';
import type { ProjectDocument } from './types';

function createHierarchyDoc(): ProjectDocument {
  const doc = starterProject('hierarchy');
  doc.rig.bones = {
    root: { translation: [0, 10, 0], rotation: [0, 0, 0] },
    torso: { parent: 'root', translation: [0, 5, 0], rotation: [0, 90, 0] },
    arm_left: { parent: 'torso', translation: [2, 0, 0], rotation: [0, 0, 0] },
    hand_left: { parent: 'arm_left', translation: [1, 0, 0], rotation: [0, 0, 0] },
    leg_left: { parent: 'root', translation: [-1, -4, 0], rotation: [0, 0, 0] },
  };
  return doc;
}

// Helpers for matrix math validation
function matMulVec(m: number[], v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11],
  ];
}

function rotDet3x3(m: number[]): number {
  return (
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[1] * (m[4] * m[10] - m[6] * m[8]) +
    m[2] * (m[4] * m[9] - m[5] * m[8])
  );
}

describe('Angle Normalization (normalizeAngle)', () => {
  it('normalizes standard cardinal angles', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(90)).toBe(90);
    expect(normalizeAngle(-90)).toBe(-90);
    expect(normalizeAngle(180)).toBe(-180);
    expect(normalizeAngle(-180)).toBe(-180);
  });

  it('normalizes multi-revolution full circles', () => {
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(-360)).toBe(0);
    expect(normalizeAngle(720)).toBe(0);
    expect(normalizeAngle(-720)).toBe(0);
    expect(normalizeAngle(3600)).toBe(0);
  });

  it('normalizes overflow angles across boundary', () => {
    expect(normalizeAngle(270)).toBe(-90);
    expect(normalizeAngle(-270)).toBe(90);
    expect(normalizeAngle(540)).toBe(-180);
    expect(normalizeAngle(-540)).toBe(-180);
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(405)).toBe(45);
    expect(normalizeAngle(-405)).toBe(-45);
  });

  it('handles near-zero precision without -0 or precision artifacts', () => {
    expect(normalizeAngle(1e-12)).toBe(0);
    expect(normalizeAngle(-1e-12)).toBe(0);
    expect(normalizeAngle(0.00000000001)).toBe(0);
  });
});

describe('3D Transforms & Matrix Properties (pose)', () => {
  it('evaluates identity transform for zero translation and zero rotation', () => {
    const doc = starterProject('identity');
    doc.rig.bones = {
      root: { translation: [0, 0, 0], rotation: [0, 0, 0] },
    };
    const p = pose(doc);
    const expected = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    expect(p.root.length).toBe(16);
    for (let i = 0; i < 16; i++) {
      expect(p.root[i]).toBeCloseTo(expected[i], 5);
    }
  });

  it('evaluates pure translation correctly in 4x4 matrix', () => {
    const doc = starterProject('trans');
    doc.rig.bones = {
      root: { translation: [12.5, -7.25, 4.0], rotation: [0, 0, 0] },
    };
    const p = pose(doc);
    expect(p.root[3]).toBeCloseTo(12.5);
    expect(p.root[7]).toBeCloseTo(-7.25);
    expect(p.root[11]).toBeCloseTo(4.0);
    expect(p.root[15]).toBe(1);
  });

  it('evaluates pure 90-degree rotations on X, Y, Z axes', () => {
    // 90 deg around X axis
    const docX = starterProject('rotX');
    docX.rig.bones = { root: { translation: [0, 0, 0], rotation: [90, 0, 0] } };
    const pX = pose(docX);
    const transformedY = matMulVec(pX.root, [0, 1, 0]);
    expect(transformedY[0]).toBeCloseTo(0);
    expect(transformedY[1]).toBeCloseTo(0);
    expect(transformedY[2]).toBeCloseTo(1); // Y rotates to +Z

    // 90 deg around Y axis
    const docY = starterProject('rotY');
    docY.rig.bones = { root: { translation: [0, 0, 0], rotation: [0, 90, 0] } };
    const pY = pose(docY);
    const transformedZ = matMulVec(pY.root, [0, 0, 1]);
    expect(transformedZ[0]).toBeCloseTo(1); // Z rotates to +X
    expect(transformedZ[1]).toBeCloseTo(0);
    expect(transformedZ[2]).toBeCloseTo(0);

    // 90 deg around Z axis
    const docZ = starterProject('rotZ');
    docZ.rig.bones = { root: { translation: [0, 0, 0], rotation: [0, 0, 90] } };
    const pZ = pose(docZ);
    const transformedX = matMulVec(pZ.root, [1, 0, 0]);
    expect(transformedX[0]).toBeCloseTo(0);
    expect(transformedX[1]).toBeCloseTo(1); // X rotates to +Y
    expect(transformedX[2]).toBeCloseTo(0);
  });

  it('preserves rotation matrix orthogonality and determinant = 1', () => {
    const testRotations: [number, number, number][] = [
      [15, 30, 45],
      [-45, 60, -120],
      [90, -45, 180],
      [0, 180, 0],
      [-175, 70, 179],
    ];

    for (const rot of testRotations) {
      const doc = starterProject('rot-ortho');
      doc.rig.bones = { root: { translation: [1, 2, 3], rotation: rot } };
      const p = pose(doc);
      const m = p.root;

      // Check column unit lengths
      const col0Len = Math.hypot(m[0], m[4], m[8]);
      const col1Len = Math.hypot(m[1], m[5], m[9]);
      const col2Len = Math.hypot(m[2], m[6], m[10]);
      expect(col0Len).toBeCloseTo(1.0, 5);
      expect(col1Len).toBeCloseTo(1.0, 5);
      expect(col2Len).toBeCloseTo(1.0, 5);

      // Check column dot products = 0 (orthogonality)
      const dot01 = m[0] * m[1] + m[4] * m[5] + m[8] * m[9];
      const dot02 = m[0] * m[2] + m[4] * m[6] + m[8] * m[10];
      const dot12 = m[1] * m[2] + m[5] * m[6] + m[9] * m[10];
      expect(dot01).toBeCloseTo(0.0, 5);
      expect(dot02).toBeCloseTo(0.0, 5);
      expect(dot12).toBeCloseTo(0.0, 5);

      // Check determinant = 1
      const det = rotDet3x3(m);
      expect(det).toBeCloseTo(1.0, 5);
    }
  });

  it('accumulates hierarchical parent-child transforms', () => {
    const doc = createHierarchyDoc();
    const p = pose(doc);

    // root is at [0, 10, 0]
    expect(p.root[3]).toBeCloseTo(0);
    expect(p.root[7]).toBeCloseTo(10);
    expect(p.root[11]).toBeCloseTo(0);

    // torso parent is root: local [0, 5, 0], so world is [0, 15, 0]
    expect(p.torso[3]).toBeCloseTo(0);
    expect(p.torso[7]).toBeCloseTo(15);
    expect(p.torso[11]).toBeCloseTo(0);

    // torso is rotated 90 around Y.
    // arm_left local translation is [2, 0, 0].
    // Under 90 deg Y-rotation, local +X [2, 0, 0] maps to world [0, 0, -2]!
    // World position of arm_left should be torso world [0, 15, 0] + [0, 0, -2] = [0, 15, -2].
    expect(p.arm_left[3]).toBeCloseTo(0);
    expect(p.arm_left[7]).toBeCloseTo(15);
    expect(p.arm_left[11]).toBeCloseTo(-2);

    // hand_left is child of arm_left with local [1, 0, 0] (further along rotated axis)
    // World position should be [0, 15, -3]
    expect(p.hand_left[3]).toBeCloseTo(0);
    expect(p.hand_left[7]).toBeCloseTo(15);
    expect(p.hand_left[11]).toBeCloseTo(-3);
  });
});

describe('Reparenting Math & Cycle Invariance (reparent)', () => {
  it('preserves exact world pose when changing bone parent', () => {
    const doc = createHierarchyDoc();
    const poseBefore = pose(doc);

    // Reparent arm_left from torso to root
    const updated = reparent(doc, 'arm_left', 'root');
    const poseAfter = pose(updated);

    for (let i = 0; i < 16; i++) {
      expect(poseAfter.arm_left[i]).toBeCloseTo(poseBefore.arm_left[i], 4);
      expect(poseAfter.hand_left[i]).toBeCloseTo(poseBefore.hand_left[i], 4);
    }
  });

  it('preserves exact world pose when unparenting to root', () => {
    const doc = createHierarchyDoc();
    const poseBefore = pose(doc);

    // Unparent torso (parent becomes null)
    const updated = reparent(doc, 'torso', null);
    const poseAfter = pose(updated);

    for (let i = 0; i < 16; i++) {
      expect(poseAfter.torso[i]).toBeCloseTo(poseBefore.torso[i], 4);
      expect(poseAfter.arm_left[i]).toBeCloseTo(poseBefore.arm_left[i], 4);
      expect(poseAfter.hand_left[i]).toBeCloseTo(poseBefore.hand_left[i], 4);
    }
    expect(updated.rig.bones.torso.parent).toBeUndefined();
  });

  it('rejects self-parenting cycle', () => {
    const doc = createHierarchyDoc();
    expect(() => reparent(doc, 'torso', 'torso')).toThrow(ProjectError);
    expect(() => reparent(doc, 'torso', 'torso')).toThrow(/parent cycle/);
  });

  it('rejects ancestor-to-descendant cycle (2-node cycle)', () => {
    const doc = createHierarchyDoc();
    // torso is parent of arm_left; reparenting torso to arm_left creates cycle
    expect(() => reparent(doc, 'torso', 'arm_left')).toThrow(ProjectError);
    expect(() => reparent(doc, 'torso', 'arm_left')).toThrow(/parent cycle/);
  });

  it('rejects deep ancestor-to-descendant cycle (multi-node cycle)', () => {
    const doc = createHierarchyDoc();
    // root -> torso -> arm_left -> hand_left; reparenting root to hand_left
    expect(() => reparent(doc, 'root', 'hand_left')).toThrow(ProjectError);
    expect(() => reparent(doc, 'root', 'hand_left')).toThrow(/parent cycle/);
  });

  it('rejects reparenting non-existent bone', () => {
    const doc = createHierarchyDoc();
    expect(() => reparent(doc, 'non_existent_bone', 'root')).toThrow(ProjectError);
    expect(() => reparent(doc, 'non_existent_bone', 'root')).toThrow(/unknown bone/);
  });
});
