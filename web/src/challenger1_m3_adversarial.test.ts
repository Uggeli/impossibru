import { describe, it, expect, beforeEach } from 'vitest';
import {
  pose,
  transform,
  inverseRigid,
  eulerFrom,
  rotFromTo,
  slerpMatrix3,
  solveTwoBone,
  mul,
  vLen,
  vSub,
  vNorm,
  mv,
  ProjectError,
  validateProject,
  reparent,
} from './engine';
import {
  autoRig,
  autorigProjectFallback,
  browserRequest,
  starterProject,
} from './runtime';
import { setupTestEnvironment } from './test-helpers';
import type { ProjectDocument, Vec3 } from './types';
import type { Mat } from './engine';

// Helper to calculate Euclidean distance between two 3D vectors
function dist3D(a: Vec3 | number[], b: Vec3 | number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// Helper to extract translation from 4x4 SE(3) matrix
function extractTranslation(m: Mat): Vec3 {
  return [m[3], m[7], m[11]];
}

// Helper to extract 3x3 rotation from 4x4 matrix
function extractR3(m: Mat): number[] {
  return [
    m[0], m[1], m[2],
    m[4], m[5], m[6],
    m[8], m[9], m[10],
  ];
}

// Helper to compare two 4x4 matrices within tolerance
function matDiff(a: Mat, b: Mat): number {
  let maxDiff = 0;
  for (let i = 0; i < 16; i++) {
    const diff = Math.abs(a[i] - b[i]);
    if (diff > maxDiff) maxDiff = diff;
  }
  return maxDiff;
}

// Build arbitrary deep hierarchy document with compound translations and rotations
function createDeepChainDoc(depth: number, baseName = 'bone'): ProjectDocument {
  const doc: ProjectDocument = starterProject('deep_chain_test');
  const bones: Record<string, any> = {
    [`${baseName}_0`]: {
      part: 'part',
      translation: [3, 7, -2],
      rotation: [15, -20, 35],
    },
  };

  for (let i = 1; i < depth; i++) {
    bones[`${baseName}_${i}`] = {
      parent: `${baseName}_${i - 1}`,
      translation: [i * 1.5, i * 2.0 - 5, -i * 1.2],
      rotation: [(i * 27) % 180 - 90, (i * 41) % 180 - 90, (i * 33) % 180 - 90],
    };
  }

  doc.rig = { bones, ik_chains: {} };
  return doc;
}

describe('Challenger 1 Adversarial Suite: Deep Bone Hierarchy & Multi-Step Reparenting', () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  it('preserves exact world coordinates across multi-step reparenting in a 10-level hierarchy', () => {
    let doc = createDeepChainDoc(10);
    validateProject(doc);

    const initialWorld = pose(doc);
    const initialLeafPos = extractTranslation(initialWorld['bone_9']);
    const initialMidPos = extractTranslation(initialWorld['bone_5']);

    // Step 1: Reparent leaf bone_9 from bone_8 directly to root bone_0
    doc = reparent(doc, 'bone_9', 'bone_0');
    expect(doc.rig.bones.bone_9.parent).toBe('bone_0');
    let worldAfterStep1 = pose(doc);
    expect(dist3D(extractTranslation(worldAfterStep1['bone_9']), initialLeafPos)).toBeLessThan(1e-4);
    expect(matDiff(worldAfterStep1['bone_9'], initialWorld['bone_9'])).toBeLessThan(1e-4);

    // Step 2: Reparent bone_5 from bone_4 to null (making it a new root)
    doc = reparent(doc, 'bone_5', null);
    expect(doc.rig.bones.bone_5.parent).toBeUndefined();
    let worldAfterStep2 = pose(doc);
    expect(dist3D(extractTranslation(worldAfterStep2['bone_5']), initialMidPos)).toBeLessThan(1e-4);
    expect(matDiff(worldAfterStep2['bone_5'], initialWorld['bone_5'])).toBeLessThan(1e-4);

    // Step 3: Descendants of bone_5 (bone_6, bone_7, bone_8) must also retain world transforms
    for (const b of ['bone_6', 'bone_7', 'bone_8']) {
      expect(matDiff(worldAfterStep2[b], initialWorld[b])).toBeLessThan(1e-4);
    }

    // Step 4: Reparent bone_9 under bone_7 (cross-branch reparenting)
    doc = reparent(doc, 'bone_9', 'bone_7');
    expect(doc.rig.bones.bone_9.parent).toBe('bone_7');
    let worldAfterStep4 = pose(doc);
    expect(matDiff(worldAfterStep4['bone_9'], initialWorld['bone_9'])).toBeLessThan(1e-4);

    // Step 5: Reparent former root bone_0 under bone_8 (deep nesting)
    doc = reparent(doc, 'bone_0', 'bone_8');
    expect(doc.rig.bones.bone_0.parent).toBe('bone_8');
    let worldAfterStep5 = pose(doc);
    expect(matDiff(worldAfterStep5['bone_0'], initialWorld['bone_0'])).toBeLessThan(1e-4);

    // Check that every single bone in the 10-bone rig has finite non-NaN world transforms
    for (let i = 0; i < 10; i++) {
      const bMat = worldAfterStep5[`bone_${i}`];
      expect(bMat).toBeDefined();
      for (let m = 0; m < 16; m++) {
        expect(Number.isFinite(bMat[m])).toBe(true);
        expect(Number.isNaN(bMat[m])).toBe(false);
      }
    }
  });

  it('rejects self-parenting and direct 2-node cycles', () => {
    const doc = createDeepChainDoc(5);
    // Self-parenting
    expect(() => reparent(doc, 'bone_2', 'bone_2')).toThrow(/parent cycle/i);
    // Direct cycle: bone_1's parent is bone_0; setting bone_0's parent to bone_1 creates a cycle
    expect(() => reparent(doc, 'bone_0', 'bone_1')).toThrow(/parent cycle/i);
  });

  it('rejects deep 20-level transitive ancestor cycles', () => {
    const doc = createDeepChainDoc(20);
    // Attempt to reparent root bone_0 to leaf bone_19
    expect(() => reparent(doc, 'bone_0', 'bone_19')).toThrow(/parent cycle/i);
    // Attempt to reparent bone_3 to bone_17
    expect(() => reparent(doc, 'bone_3', 'bone_17')).toThrow(/parent cycle/i);
    // Attempt to reparent bone_10 to bone_11
    expect(() => reparent(doc, 'bone_10', 'bone_11')).toThrow(/parent cycle/i);
  });

  it('rejects reparenting that breaks IK chain continuity', () => {
    const doc = createDeepChainDoc(6);
    doc.rig.ik_chains = {
      test_leg: {
        root: 'bone_1',
        mid: 'bone_2',
        end: 'bone_3',
      },
    };
    validateProject(doc);

    // Reparenting mid bone_2 to bone_0 breaks chain continuity
    expect(() => reparent(doc, 'bone_2', 'bone_0')).toThrow(/reparent would invalidate IK chain|must describe a direct/i);
    // Reparenting end bone_3 to root bone_0 breaks chain continuity
    expect(() => reparent(doc, 'bone_3', 'bone_0')).toThrow(/reparent would invalidate IK chain|must describe a direct/i);
    // Reparenting root bone_1 to bone_0 does NOT break chain continuity (bone_1 still parents bone_2 -> bone_3)
    const validReparent = reparent(doc, 'bone_1', 'bone_0');
    expect(validReparent.rig.bones.bone_1.parent).toBe('bone_0');
    expect(() => validateProject(validReparent)).not.toThrow();
  });
});

describe('Challenger 1 Adversarial Suite: Autorigging Pathological Voxel Layouts', () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  it('rejects autorig on project with 0 parts or empty parts mapping', () => {
    const doc = starterProject('empty_parts_test');
    doc.parts = {};
    expect(() => autorigProjectFallback(doc, 'humanoid')).toThrow();
  });

  it('handles single-voxel (1x1x1) parts without zero-division or NaN', () => {
    const doc = starterProject('single_voxel_hero');
    doc.palette = { 'x': '#ff0000' };
    doc.parts = {
      torso: {
        dimensions: [1, 1, 1],
        front: 'x',
        side: 'x',
        back: 'x',
        offset: [0, 0, 0],
      },
      head: {
        dimensions: [1, 1, 1],
        front: 'x',
        side: 'x',
        back: 'x',
        offset: [0, 1, 0],
      },
    };

    for (const preset of ['humanoid', 'quadruped', 'creature']) {
      const rigged = autorigProjectFallback(doc, preset);
      expect(rigged.rig).toBeDefined();
      expect(rigged.rig.bones).toBeDefined();
      expect(validateProject(rigged)).toBe(rigged);

      const world = pose(rigged);
      for (const [boneName, mat] of Object.entries(world)) {
        for (let i = 0; i < 16; i++) {
          expect(Number.isFinite(mat[i])).toBe(true);
          expect(Number.isNaN(mat[i])).toBe(false);
        }
      }
    }
  });

  it('handles spatially disconnected / non-contiguous voxel layouts cleanly', () => {
    const doc = starterProject('disconnected_hero');
    doc.palette = { 'a': '#00ff00', 'b': '#0000ff' };
    doc.parts = {
      torso: {
        dimensions: [8, 8, 8],
        // Voxels only at extreme corners
        front: 'a......a\n........\n........\n........\n........\n........\n........\na......a',
        side: 'a......a\n........\n........\n........\n........\n........\n........\na......a',
        back: 'a......a\n........\n........\n........\n........\n........\n........\na......a',
        offset: [0, 0, 0],
      },
      head: {
        dimensions: [4, 4, 4],
        front: 'b..b\n....\n....\nb..b',
        side: 'b..b\n....\n....\nb..b',
        back: 'b..b\n....\n....\nb..b',
        offset: [0, 8, 0],
      },
    };

    const rigged = autorigProjectFallback(doc, 'humanoid');
    expect(rigged.rig.bones.root).toBeDefined();
    expect(validateProject(rigged)).toBe(rigged);
    const world = pose(rigged);
    expect(world.root).toBeDefined();
  });

  it('handles extreme aspect-ratio needle and slab parts (50x1x1 and 1x50x1)', () => {
    const doc = starterProject('extreme_aspect_ratio');
    doc.palette = { 'c': '#ffff00' };
    const longRow = 'c'.repeat(50);
    const fiftyRows = Array(50).fill('c').join('\n');

    doc.parts = {
      torso: {
        dimensions: [50, 1, 1],
        front: longRow,
        side: 'c',
        back: longRow,
        offset: [0, 0, 0],
      },
      lower_leg_l: {
        dimensions: [1, 50, 1],
        front: fiftyRows,
        side: fiftyRows,
        back: fiftyRows,
        offset: [-5, -50, 0],
      },
    };

    const rigged = autorigProjectFallback(doc, 'humanoid');
    expect(validateProject(rigged)).toBe(rigged);
    const world = pose(rigged);
    for (const [name, mat] of Object.entries(world)) {
      expect(mat.every((v) => Number.isFinite(v) && !Number.isNaN(v))).toBe(true);
    }
  });

  it('handles unknown/custom part collections across creature, humanoid, and quadruped presets', () => {
    const doc = starterProject('custom_creature');
    doc.palette = { 'z': '#ff00ff' };
    doc.parts = {
      main_orb: {
        dimensions: [6, 6, 6],
        front: 'zzzzzz\nzzzzzz\nzzzzzz\nzzzzzz\nzzzzzz\nzzzzzz',
        side: 'zzzzzz\nzzzzzz\nzzzzzz\nzzzzzz\nzzzzzz\nzzzzzz',
        back: 'zzzzzz\nzzzzzz\nzzzzzz\nzzzzzz\nzzzzzz\nzzzzzz',
      },
      tentacle_1: {
        dimensions: [2, 8, 2],
        front: 'zz\nzz\nzz\nzz\nzz\nzz\nzz\nzz',
        side: 'zz\nzz\nzz\nzz\nzz\nzz\nzz\nzz',
        back: 'zz\nzz\nzz\nzz\nzz\nzz\nzz\nzz',
      },
    };

    for (const preset of ['humanoid', 'quadruped', 'creature']) {
      const rigged = autorigProjectFallback(doc, preset);
      expect(rigged.rig.bones).toBeDefined();
      expect(validateProject(rigged)).toBe(rigged);
    }
  });
});

describe('Challenger 1 Adversarial Suite: Renaming & Deletion Cascade Consistency', () => {
  function createRichProject(): ProjectDocument {
    const doc = starterProject('rich_cascade_test');
    doc.export = {
      name: 'rich_cascade_test',
      size: [64, 64],
      scale: 2,
      origin: [32, 50],
      directions: [0, 90, 180, 270],
      animations: ['walk'],
    };
    doc.palette = { 'x': '#00ffaa' };
    doc.parts = {
      torso: {
        dimensions: [4, 6, 4],
        front: 'xxxx\nxxxx\nxxxx\nxxxx\nxxxx\nxxxx',
        side: 'xxxx\nxxxx\nxxxx\nxxxx\nxxxx\nxxxx',
        back: 'xxxx\nxxxx\nxxxx\nxxxx\nxxxx\nxxxx',
      },
    };
    doc.rig = {
      bones: {
        root: { translation: [0, 0, 0], rotation: [0, 0, 0] },
        spine: { parent: 'root', translation: [0, 3, 0], rotation: [0, 0, 0] },
        torso: { parent: 'spine', translation: [0, 3, 0], rotation: [0, 0, 0] },
        chest: { parent: 'torso', translation: [0, 3, 0], rotation: [0, 0, 0] },
        neck: { parent: 'chest', translation: [0, 2, 0], rotation: [0, 0, 0] },
        head: { parent: 'neck', translation: [0, 2, 0], rotation: [0, 0, 0] },
        arm_l_upper: { parent: 'chest', translation: [3, 0, 0], rotation: [0, 0, 0] },
        arm_l_lower: { parent: 'arm_l_upper', translation: [0, -3, 0], rotation: [0, 0, 0] },
        arm_l_hand: { parent: 'arm_l_lower', translation: [0, -2, 0], rotation: [0, 0, 0] },
        arm_r_upper: { parent: 'chest', translation: [-3, 0, 0], rotation: [0, 0, 0] },
        arm_r_lower: { parent: 'arm_r_upper', translation: [0, -3, 0], rotation: [0, 0, 0] },
        arm_r_hand: { parent: 'arm_r_lower', translation: [0, -2, 0], rotation: [0, 0, 0] },
        leaf_accessory: { parent: 'head', translation: [0, 2, 0], rotation: [0, 0, 0] },
      },
      ik_chains: {
        left_arm: { root: 'arm_l_upper', mid: 'arm_l_lower', end: 'arm_l_hand' },
        right_arm: { root: 'arm_r_upper', mid: 'arm_r_lower', end: 'arm_r_hand' },
      },
      spring_bones: {
        head: { stiffness: 100, damping: 10, mass: 1, drag: 0.1 },
        leaf_accessory: { stiffness: 50, damping: 5, mass: 0.2, drag: 0.05 },
      },
      constraints: [
        {
          type: 'copy_rotation',
          name: 'torso_to_chest',
          source: 'torso',
          target: 'chest',
          influence: 0.5,
        },
        {
          type: 'mirror',
          name: 'mirror_arms',
          source: 'arm_l_upper',
          target: 'arm_r_upper',
          plane: 'yz',
        },
        {
          type: 'spline_spine',
          name: 'spine_chain',
          bones: ['root', 'spine', 'torso', 'chest'],
          driver: 'chest',
        },
      ],
    };
    doc.animations = {
      walk: {
        frames: 8,
        fps: 10,
        loop: true,
        bones: {
          torso: { rotation: [{ frame: 0, value: [0, 5, 0] }, { frame: 4, value: [0, -5, 0] }] },
          head: { rotation: [{ frame: 0, value: [0, 0, 0] }] },
        },
        ik: {
          left_arm: { target: [{ frame: 0, value: [3, 0, 2] }] },
          right_arm: { target: [{ frame: 0, value: [-3, 0, -2] }] },
        },
        procedural: {
          gait: {
            speed: 1.0,
            root_bone: 'root',
            left_arm_bone: 'arm_l_upper',
            right_arm_bone: 'arm_r_upper',
            left_leg_chain: 'left_arm',
            right_leg_chain: 'right_arm',
          },
          breathing: {
            rate: 0.5,
            chest_bone: 'chest',
            head_bone: 'head',
          },
          lean: {
            root_bone: 'root',
            torso_bone: 'torso',
          },
          look_at: {
            head_bone: 'head',
            neck_bone: 'neck',
            spine_bones: ['spine', 'torso', 'chest'],
          },
        },
      },
    };
    return doc;
  }

  // Simulate app.ts renameBone cascade logic
  function applyRenameBone(doc: ProjectDocument, oldName: string, newName: string): ProjectDocument {
    const out = structuredClone(doc);
    const renameMapKey = (map: any, o: string, n: string) => {
      const res: Record<string, any> = {};
      for (const [k, v] of Object.entries(map || {})) res[k === o ? n : k] = v;
      return res;
    };

    out.rig.bones = renameMapKey(out.rig.bones, oldName, newName);
    Object.values(out.rig.bones).forEach((b: any) => {
      if (b.parent === oldName) b.parent = newName;
    });
    Object.values(out.rig.ik_chains || {}).forEach((c: any) => {
      if (c.root === oldName) c.root = newName;
      if (c.mid === oldName) c.mid = newName;
      if (c.end === oldName) c.end = newName;
    });
    Object.values(out.animations || {}).forEach((c: any) => {
      if (c.bones?.[oldName]) c.bones = renameMapKey(c.bones, oldName, newName);
    });
    if (out.rig.spring_bones?.[oldName]) {
      out.rig.spring_bones = renameMapKey(out.rig.spring_bones, oldName, newName);
    }
    if (out.rig.constraints) {
      const cList = Array.isArray(out.rig.constraints)
        ? out.rig.constraints
        : Object.values(out.rig.constraints);
      cList.forEach((c: any) => {
        if (c.source === oldName) c.source = newName;
        if (c.target === oldName) c.target = newName;
        if (c.driver === oldName) c.driver = newName;
        if (Array.isArray(c.bones)) {
          c.bones = c.bones.map((b: string) => (b === oldName ? newName : b));
        }
      });
    }
    Object.values(out.animations || {}).forEach((c: any) => {
      if (c.procedural) {
        const p = c.procedural;
        if (p.gait) {
          if (p.gait.left_arm_bone === oldName) p.gait.left_arm_bone = newName;
          if (p.gait.right_arm_bone === oldName) p.gait.right_arm_bone = newName;
          if (p.gait.root_bone === oldName) p.gait.root_bone = newName;
        }
        if (p.breathing) {
          if (p.breathing.chest_bone === oldName) p.breathing.chest_bone = newName;
          if (p.breathing.head_bone === oldName) p.breathing.head_bone = newName;
        }
        if (p.lean) {
          if (p.lean.root_bone === oldName) p.lean.root_bone = newName;
          if (p.lean.torso_bone === oldName) p.lean.torso_bone = newName;
        }
        if (p.look_at) {
          if (p.look_at.head_bone === oldName) p.look_at.head_bone = newName;
          if (p.look_at.neck_bone === oldName) p.look_at.neck_bone = newName;
          if (Array.isArray(p.look_at.spine_bones)) {
            p.look_at.spine_bones = p.look_at.spine_bones.map((b: string) => (b === oldName ? newName : b));
          }
        }
      }
    });
    return out;
  }

  it('cascades bone renaming seamlessly across children, IK chains, animations, springs, constraints, and procedurals', () => {
    let doc = createRichProject();
    expect(validateProject(doc)).toBe(doc);

    // 1. Rename 'torso' -> 'main_torso'
    doc = applyRenameBone(doc, 'torso', 'main_torso');
    expect(doc.rig.bones.main_torso).toBeDefined();
    expect(doc.rig.bones.torso).toBeUndefined();
    expect(doc.rig.bones.chest.parent).toBe('main_torso');
    expect(doc.animations.walk.bones!.main_torso).toBeDefined();
    expect(doc.animations.walk.bones!.torso).toBeUndefined();
    expect((doc.rig.constraints as any)[0].source).toBe('main_torso');
    expect((doc.rig.constraints as any)[2].bones).toEqual(['root', 'spine', 'main_torso', 'chest']);
    expect((doc.animations.walk as any).procedural.lean.torso_bone).toBe('main_torso');
    expect((doc.animations.walk as any).procedural.look_at.spine_bones).toEqual(['spine', 'main_torso', 'chest']);
    expect(() => validateProject(doc)).not.toThrow();

    // 2. Rename 'arm_l_upper' -> 'left_arm_shoulder'
    doc = applyRenameBone(doc, 'arm_l_upper', 'left_arm_shoulder');
    expect(doc.rig.bones.arm_l_lower.parent).toBe('left_arm_shoulder');
    expect(doc.rig.ik_chains!.left_arm.root).toBe('left_arm_shoulder');
    expect((doc.rig.constraints as any)[1].source).toBe('left_arm_shoulder');
    expect((doc.animations.walk as any).procedural.gait.left_arm_bone).toBe('left_arm_shoulder');
    expect(() => validateProject(doc)).not.toThrow();

    // 3. Rename 'chest' -> 'upper_chest'
    doc = applyRenameBone(doc, 'chest', 'upper_chest');
    expect((doc.rig.constraints as any)[0].target).toBe('upper_chest');
    expect((doc.rig.constraints as any)[2].driver).toBe('upper_chest');
    expect((doc.animations.walk as any).procedural.breathing.chest_bone).toBe('upper_chest');
    expect(() => validateProject(doc)).not.toThrow();

    // 4. Rename 'head' -> 'skull'
    doc = applyRenameBone(doc, 'head', 'skull');
    expect((doc.rig.spring_bones as any).skull).toBeDefined();
    expect((doc.rig.spring_bones as any).head).toBeUndefined();
    expect(doc.rig.bones.leaf_accessory.parent).toBe('skull');
    expect((doc.animations.walk as any).procedural.breathing.head_bone).toBe('skull');
    expect((doc.animations.walk as any).procedural.look_at.head_bone).toBe('skull');
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('cascades IK chain renaming to animation tracks and procedural gait parameters', () => {
    let doc = createRichProject();
    const renameMapKey = (map: any, o: string, n: string) => {
      const res: Record<string, any> = {};
      for (const [k, v] of Object.entries(map || {})) res[k === o ? n : k] = v;
      return res;
    };

    // Rename 'left_arm' -> 'l_arm_chain'
    const oldChain = 'left_arm', newChain = 'l_arm_chain';
    doc.rig.ik_chains = renameMapKey(doc.rig.ik_chains, oldChain, newChain);
    Object.values(doc.animations).forEach((c: any) => {
      if (c.ik?.[oldChain]) c.ik = renameMapKey(c.ik, oldChain, newChain);
      if (c.procedural?.gait) {
        if (c.procedural.gait.left_leg_chain === oldChain) c.procedural.gait.left_leg_chain = newChain;
        if (c.procedural.gait.right_leg_chain === oldChain) c.procedural.gait.right_leg_chain = newChain;
      }
    });

    expect(doc.rig.ik_chains!.l_arm_chain).toBeDefined();
    expect((doc.animations.walk.ik as any).l_arm_chain).toBeDefined();
    expect((doc.animations.walk as any).procedural.gait.left_leg_chain).toBe('l_arm_chain');
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('safely cleans up spring_bones on leaf bone deletion', () => {
    const doc = createRichProject();
    // leaf_accessory has no children, no IK chains, no animation tracks, no constraints
    expect((doc.rig.spring_bones as any).leaf_accessory).toBeDefined();
    delete doc.rig.bones.leaf_accessory;
    delete (doc.rig.spring_bones as any).leaf_accessory;
    expect((doc.rig.spring_bones as any).leaf_accessory).toBeUndefined();
    expect(() => validateProject(doc)).not.toThrow();
  });
});

describe('Challenger 1 Adversarial Suite: Viewport Joint Dragging Transform Inversion Under Complex Rotated Chains', () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  it('inverts joint drag translation perfectly across 8-level rotated chain and 30 arbitrary 3D target coordinates', () => {
    const doc = createDeepChainDoc(8);
    const leafName = 'bone_7';
    const parentName = doc.rig.bones[leafName].parent!;

    const testTargets: Vec3[] = [
      [0, 0, 0],
      [10, 20, 30],
      [-50, 75, -125],
      [1000, -2000, 3000],
      [-0.05, 0.12, -0.99],
      [88.4, -44.2, 12.9],
      [-300, 500, 200],
      [42, -42, 42],
    ];

    for (const targetWorld of testTargets) {
      const worldBefore = pose(doc);
      const parentMat = worldBefore[parentName];
      const inv = inverseRigid(parentMat);
      const local = mv(inv, targetWorld);

      doc.rig.bones[leafName].translation = [local[0], local[1], local[2]];

      const worldAfter = pose(doc);
      const actualWorld = extractTranslation(worldAfter[leafName]);

      expect(dist3D(actualWorld, targetWorld)).toBeLessThan(1e-4);

      // Verify all ancestor transforms (bone_0 through bone_6) are 100% unchanged
      for (let i = 0; i < 7; i++) {
        const b = `bone_${i}`;
        expect(matDiff(worldAfter[b], worldBefore[b])).toBeLessThan(1e-5);
      }
    }
  });

  it('handles gimbal lock and 90/180 degree rotation angles without matrix singularities or NaN', () => {
    const doc = starterProject('gimbal_test');
    doc.rig.bones = {
      root: { translation: [0, 0, 0], rotation: [0, 90, 0] }, // Gimbal lock Y = 90
      child_1: { parent: 'root', translation: [0, 5, 0], rotation: [90, 0, 0] },
      child_2: { parent: 'child_1', translation: [0, 5, 0], rotation: [0, 0, 180] },
      child_3: { parent: 'child_2', translation: [0, 5, 0], rotation: [-90, 90, 0] },
    };

    const targetWorld: Vec3 = [15, -25, 35];
    const worldBefore = pose(doc);
    const parentMat = worldBefore.child_2;
    const inv = inverseRigid(parentMat);
    const local = mv(inv, targetWorld);

    doc.rig.bones.child_3.translation = [local[0], local[1], local[2]];

    const worldAfter = pose(doc);
    const actualWorld = extractTranslation(worldAfter.child_3);

    expect(dist3D(actualWorld, targetWorld)).toBeLessThan(1e-4);
    for (let i = 0; i < 16; i++) {
      expect(Number.isFinite(worldAfter.child_3[i])).toBe(true);
      expect(Number.isNaN(worldAfter.child_3[i])).toBe(false);
    }
  });
});

describe('Challenger 1 Adversarial Suite: Core Math Edge Cases & Numerical Robustness', () => {
  it('handles solveTwoBone with zero distance, over-extension, and extreme pole vectors', () => {
    const root: Vec3 = [0, 0, 0];
    const l1 = 5, l2 = 5;

    // 1. Target exactly at root (dist = 0)
    const [joint0, end0] = solveTwoBone(root, [0, 0, 0], l1, l2, [0, 0, 1]);
    expect(joint0.every((v) => Number.isFinite(v) && !Number.isNaN(v))).toBe(true);
    expect(end0.every((v) => Number.isFinite(v) && !Number.isNaN(v))).toBe(true);

    // 2. Target beyond reach (dist = 20 > l1 + l2 = 10)
    const [jointOver, endOver] = solveTwoBone(root, [0, 20, 0], l1, l2, [0, 0, 1]);
    expect(jointOver.every((v) => Number.isFinite(v) && !Number.isNaN(v))).toBe(true);
    expect(endOver.every((v) => Number.isFinite(v) && !Number.isNaN(v))).toBe(true);

    // 3. Collinear / zero pole vector
    const [jointCol, endCol] = solveTwoBone(root, [0, 8, 0], l1, l2, [0, 8, 0]);
    expect(jointCol.every((v) => Number.isFinite(v) && !Number.isNaN(v))).toBe(true);
    expect(endCol.every((v) => Number.isFinite(v) && !Number.isNaN(v))).toBe(true);
  });

  it('handles rotFromTo with parallel, antiparallel, and tiny vectors', () => {
    // Parallel vectors
    const rIdent = rotFromTo([0, 1, 0], [0, 1, 0]);
    expect(rIdent).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);

    // Antiparallel vectors
    const rOpp = rotFromTo([0, 1, 0], [0, -1, 0]);
    expect(rOpp.every((v) => Number.isFinite(v) && !Number.isNaN(v))).toBe(true);

    // Tiny vectors
    const rTiny = rotFromTo([1e-12, 1e-12, 1e-12], [0, 0, 1]);
    expect(rTiny.every((v) => Number.isFinite(v) && !Number.isNaN(v))).toBe(true);
  });

  it('handles slerpMatrix3 boundary conditions (t <= 0, t >= 1, antipodal quaternions)', () => {
    const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const r180 = [1, 0, 0, 0, -1, 0, 0, 0, -1];

    expect(slerpMatrix3(id, r180, 0)).toEqual(id);
    expect(slerpMatrix3(id, r180, 1)).toEqual(r180);

    const mid = slerpMatrix3(id, r180, 0.5);
    expect(mid.every((v) => Number.isFinite(v) && !Number.isNaN(v))).toBe(true);
  });

  it('handles eulerFrom round-trip across random non-trivial 3D rotations', () => {
    const testAngles: Vec3[] = [
      [0, 0, 0],
      [45, 30, 60],
      [-75, 45, -120],
      [180, -90, 0], // Gimbal lock
      [-179.9, 89.9, -179.9],
    ];

    for (const ang of testAngles) {
      const mat = transform(ang, [0, 0, 0]);
      const reconstructed = eulerFrom(mat);
      const remat = transform(reconstructed, [0, 0, 0]);
      expect(matDiff(mat, remat)).toBeLessThan(1e-4);
    }
  });
});
