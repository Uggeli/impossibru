import { describe, it, expect } from 'vitest';
import {
  euler,
  eulerFrom,
  inverseRigid,
  rotFromTo,
  quatFromMatrix3,
  matrix3FromQuat,
  slerpMatrix3,
  solveTwoBone,
  reparent,
  pose,
  validateProject,
  ProjectError,
  vNorm,
  vCross,
  vDot,
  vLen,
  vSub,
  vAdd,
  vScale,
  mul,
  mv,
  mul3,
  transpose3,
} from './engine';
import { reconcileSilhouette } from './canvas';
import type { ProjectDocument, Vec3 } from './types';

const createBaseTestDoc = (): ProjectDocument => ({
  palette: {
    '0': '#000000',
    '1': '#ffffff',
    r: '#ff0000',
    g: '#00ff00',
    b: '#0000ff',
  },
  parts: {
    torso: {
      front: 'rr\nrr',
      back: 'rr\nrr',
      side: 'rr\nrr',
    },
    head: {
      front: 'gg\ngg',
      back: 'gg\ngg',
      side: 'gg\ngg',
    },
    arm_l: {
      front: 'bb\nbb',
      back: 'bb\nbb',
      side: 'bb\nbb',
    },
    forearm_l: {
      front: 'bb\nbb',
      back: 'bb\nbb',
      side: 'bb\nbb',
    },
    thigh_l: {
      front: '11\n11',
      back: '11\n11',
      side: '11\n11',
    },
    shin_l: {
      front: '11\n11',
      back: '11\n11',
      side: '11\n11',
    },
    foot_l: {
      front: '11\n11',
      back: '11\n11',
      side: '11\n11',
    },
  },
  rig: {
    bones: {
      root: { translation: [0, 8, 0], rotation: [0, 0, 0] },
      torso: { parent: 'root', part: 'torso', translation: [0, 0, 0] },
      head: { parent: 'torso', part: 'head', translation: [0, 4, 0] },
      arm_l: { parent: 'torso', part: 'arm_l', translation: [3, 2, 0] },
      forearm_l: { parent: 'arm_l', part: 'forearm_l', translation: [0, -3, 0] },
      thigh_l: { parent: 'root', part: 'thigh_l', translation: [2, -1, 0] },
      shin_l: { parent: 'thigh_l', part: 'shin_l', translation: [0, -4, 0] },
      foot_l: { parent: 'shin_l', part: 'foot_l', translation: [0, -4, 0] },
    },
    ik_chains: {
      leg_l: { root: 'thigh_l', mid: 'shin_l', end: 'foot_l' },
    },
  },
  animations: {
    idle: {
      frames: 8,
      fps: 8,
      loop: true,
      bones: {
        root: {
          translation: [
            { frame: 0, value: [0, 0, 0] },
            { frame: 4, value: [0, 1, 0] },
            { frame: 7, value: [0, 0, 0] },
          ],
        },
      },
      ik: {
        leg_l: {
          target: [
            { frame: 0, value: [2, 0, 0] },
            { frame: 4, value: [2, 1, 1] },
          ],
          pole: [{ frame: 0, value: [2, 0, 5] }],
        },
      },
    },
  },
  export: {
    name: 'adv_hero_ts',
    size: [32, 32],
    scale: 1,
    origin: [16, 16],
    directions: [0, 90, 180, 270],
    animations: ['idle'],
    background: [0, 0, 0, 0],
  },
});

describe('Milestone 5 Phase 2 Challenger 1: Adversarial Engine Math & IK Solver', () => {
  it('handles exact antiparallel and parallel vector rotations in rotFromTo without NaN', () => {
    // Exact parallel
    const rIdent = rotFromTo([1, 0, 0], [1, 0, 0]);
    expect(rIdent).toHaveLength(9);
    expect(rIdent[0]).toBeCloseTo(1, 5);
    expect(rIdent[4]).toBeCloseTo(1, 5);
    expect(rIdent[8]).toBeCloseTo(1, 5);

    // Exact antiparallel vectors across primary axes
    const axes: Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [-1, 0, 0],
      [0, -1, 0],
      [0, 0, -1],
    ];

    for (const axis of axes) {
      const negAxis: Vec3 = [-axis[0], -axis[1], -axis[2]];
      const r = rotFromTo(axis, negAxis);
      // All entries must be finite
      expect(r.every((v) => Number.isFinite(v))).toBe(true);

      // Verify orthogonality: R * R^T = I
      const r_t = transpose3(r);
      const prod = mul3(r, r_t);
      expect(prod[0]).toBeCloseTo(1, 4);
      expect(prod[4]).toBeCloseTo(1, 4);
      expect(prod[8]).toBeCloseTo(1, 4);
      expect(prod[1]).toBeCloseTo(0, 4);
      expect(prod[2]).toBeCloseTo(0, 4);
    }
  });

  it('handles gimbal lock and extreme angle roundtrips via euler and eulerFrom', () => {
    // Gimbal lock singular conditions (pitch = 90 deg and -90 deg)
    for (const pitch of [90, -90]) {
      const mat = euler([0, pitch, 35]);
      const extracted = eulerFrom(mat);
      expect(extracted.every((v) => Number.isFinite(v))).toBe(true);

      // Reconstructed matrix must equal original matrix
      const recon = euler(extracted);
      for (let i = 0; i < 16; i++) {
        expect(recon[i]).toBeCloseTo(mat[i], 3);
      }
    }

    // Huge angle values (wrap-around)
    const matHuge = euler([360000, -720000, 1080000]);
    const extractedHuge = eulerFrom(matHuge);
    expect(extractedHuge[0]).toBeCloseTo(0, 4);
    expect(extractedHuge[1]).toBeCloseTo(0, 4);
    expect(extractedHuge[2]).toBeCloseTo(0, 4);
  });

  it('guarantees quaternion matrix conversions and SLERP stability under edge cases', () => {
    const rotMats = [
      euler([0, 0, 0]),
      euler([180, 0, 0]),
      euler([0, 180, 0]),
      euler([0, 0, 180]),
      euler([75, -45, 120]),
    ];

    for (const m of rotMats) {
      const r3 = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
      const q = quatFromMatrix3(r3);
      expect(q.every((v) => Number.isFinite(v))).toBe(true);
      const qLen = Math.hypot(...q);
      expect(qLen).toBeCloseTo(1.0, 5);

      const r3Recon = matrix3FromQuat(q);
      for (let i = 0; i < 9; i++) {
        expect(r3Recon[i]).toBeCloseTo(r3[i], 4);
      }
    }

    // SLERP with boundary t values
    const mA = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const mB = matrix3FromQuat(quatFromMatrix3([0, 1, 0, -1, 0, 0, 0, 0, 1]));

    const s0 = slerpMatrix3(mA, mB, 0.0);
    expect(s0).toEqual(mA);

    const s1 = slerpMatrix3(mA, mB, 1.0);
    expect(s1).toEqual(mB);

    const sMid = slerpMatrix3(mA, mB, 0.5);
    expect(sMid.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('evaluates 2-bone IK under extreme reach, zero lengths, and collinear poles', () => {
    const root: Vec3 = [0, 10, 0];
    const l1 = 4.0;
    const l2 = 4.0;

    // Overextension (target distance = 1e6)
    const targetFar: Vec3 = [0, -1000000, 0];
    const pole: Vec3 = [0, 0, 5];
    const [jointFar, endFar] = solveTwoBone(root, targetFar, l1, l2, pole);

    expect(jointFar.every((v) => Number.isFinite(v))).toBe(true);
    expect(endFar.every((v) => Number.isFinite(v))).toBe(true);
    expect(vLen(vSub(jointFar, root))).toBeCloseTo(l1, 3);
    expect(vLen(vSub(endFar, jointFar))).toBeCloseTo(l2, 3);
    // End is clamped to reach limit (l1 + l2 - 1e-6)
    expect(vLen(vSub(endFar, root))).toBeCloseTo(l1 + l2 - 1e-6, 3);

    // Target coincident with root (distance 0)
    const [jointCoincident, endCoincident] = solveTwoBone(root, root, l1, l2, pole);
    expect(jointCoincident.every((v) => Number.isFinite(v))).toBe(true);
    expect(endCoincident.every((v) => Number.isFinite(v))).toBe(true);
    expect(vLen(vSub(jointCoincident, root))).toBeCloseTo(l1, 3);

    // Zero length bones
    const [jZero, eZero] = solveTwoBone(root, [0, 6, 0], 0, 0, pole);
    expect(jZero.every((v) => Number.isFinite(v))).toBe(true);
    expect(eZero.every((v) => Number.isFinite(v))).toBe(true);

    // Pole collinear with target direction
    const targetCollinear: Vec3 = [0, 5, 0];
    const poleCollinear: Vec3 = [0, 15, 0];
    const [jCol, eCol] = solveTwoBone(root, targetCollinear, l1, l2, poleCollinear);
    expect(jCol.every((v) => Number.isFinite(v))).toBe(true);
    expect(eCol.every((v) => Number.isFinite(v))).toBe(true);
    expect(vLen(vSub(jCol, root))).toBeCloseTo(l1, 3);
    expect(vLen(vSub(eCol, jCol))).toBeCloseTo(l2, 3);
  });
});

describe('Milestone 5 Phase 2 Challenger 1: Degenerate Voxel Meshes & Silhouette Parity', () => {
  it('validates silhouette parity reconciliation on single-voxel and asymmetric grids', () => {
    // 1x1 grid matching
    const rec1 = reconcileSilhouette(['x'], ['x'], 'x');
    expect(rec1).toEqual(['x']);

    // 1x1 grid mismatched: front has 'x', back has '.' -> copies front 'x'
    const rec2 = reconcileSilhouette(['x'], ['.'], 'k');
    expect(rec2).toEqual(['x']);

    // When front has '.', back has 'x' -> reconciled becomes '.'
    const rec3 = reconcileSilhouette(['.'], ['x'], 'k');
    expect(rec3).toEqual(['.']);

    // Multi-row reconciliation copies front silhouette pattern
    const front = ['xx', '..', 'xx'];
    const mismatchedBack = ['..', 'xx', '..'];
    const repaired = reconcileSilhouette(front, mismatchedBack, 'r');
    expect(repaired).toEqual(['xx', '..', 'xx']);
  });

  it('validates project document compilation on minimal 1x1x1 and flat slice models', () => {
    const doc = createBaseTestDoc();
    doc.parts = {
      tiny: {
        front: 'r',
        back: 'r',
        side: 'r',
      },
      slice: {
        front: 'ggggg',
        back: 'ggggg',
        side: 'ggggg',
      },
    };
    doc.rig.bones = {
      root: { part: 'tiny', translation: [0, 0, 0] },
      slice_bone: { parent: 'root', part: 'slice', translation: [0, 2, 0] },
    };
    delete doc.rig.ik_chains.leg_l;
    doc.animations.idle.ik = {};

    expect(() => validateProject(doc)).not.toThrow();
    const evaluatedPose = pose(doc);
    expect(evaluatedPose.root).toHaveLength(16);
    expect(evaluatedPose.slice_bone).toHaveLength(16);
  });
});

describe('Milestone 5 Phase 2 Challenger 1: Bone Reparenting & Constraint Edge Cases', () => {
  it('blocks cyclic bone reparenting hierarchies with ProjectError', () => {
    const doc = createBaseTestDoc();

    // Try to parent root to its descendant head (root -> torso -> head)
    expect(() => reparent(doc, 'root', 'head')).toThrowError(/parent cycle/);

    // Try to parent torso to head (torso -> head)
    expect(() => reparent(doc, 'torso', 'head')).toThrowError(/parent cycle/);

    // Try to parent thigh_l to foot_l (thigh_l -> shin_l -> foot_l)
    expect(() => reparent(doc, 'thigh_l', 'foot_l')).toThrowError(/parent cycle/);

    // Unknown bone
    expect(() => reparent(doc, 'ghost_bone', 'root')).toThrowError(/unknown bone/);
  });

  it('computes valid inverse transformations during reparenting', () => {
    const doc = createBaseTestDoc();
    // Valid reparent: move head under root directly
    const updated = reparent(doc, 'head', 'root');
    expect(updated.rig.bones.head.parent).toBe('root');
    expect(() => validateProject(updated)).not.toThrow();

    // Pose evaluation remains consistent
    const evaluatedPose = pose(updated);
    expect(evaluatedPose.head).toBeDefined();
    expect(evaluatedPose.head.every((v) => Number.isFinite(v))).toBe(true);
  });
});
