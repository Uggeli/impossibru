import { describe, expect, it } from 'vitest';
import {
  solveTwoBone,
  rotFromTo,
  pose,
  mul3,
  transpose3,
  extractR3,
  euler,
  eulerFrom,
  slerpMatrix3,
  quatFromMatrix3,
  matrix3FromQuat,
  vNorm,
  vLen,
  vSub,
  vAdd,
  vScale,
  vDot,
  vCross,
} from './engine';
import type { ProjectDocument, Vec3 } from './types';
import { starterProject } from './runtime';

function dist(a: Vec3 | number[], b: Vec3 | number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('Adversarial IK Challenge: Extreme Spatial Offsets & Translational Invariance (TS)', () => {
  it('preserves exact relative geometry under massive spatial translations', () => {
    const offsets: Vec3[] = [
      [1000, -500, 250],
      [1e6, -1e6, 1e6],
      [-1e8, 1e8, 0],
      [1e10, -1e10, 5e9],
    ];

    const baseCases: {
      root: Vec3;
      target: Vec3;
      l1: number;
      l2: number;
      pole: Vec3;
    }[] = [
      {
        root: [0, 0, 0],
        target: [1, 3, 2],
        l1: 2.5,
        l2: 3.0,
        pole: [0, 1, 0],
      },
      {
        root: [1, 2, 3],
        target: [4, 5, 6],
        l1: 4.0,
        l2: 4.0,
        pole: [0, 0, 1],
      },
      {
        root: [-5, 10, -2],
        target: [3, -1, 4],
        l1: 10.0,
        l2: 8.0,
        pole: [1, -1, 1],
      },
    ];

    for (const { root: root0, target: target0, l1, l2, pole: pole0 } of baseCases) {
      const [j0, e0] = solveTwoBone(root0, target0, l1, l2, pole0);
      const relJ0 = vSub(j0, root0);
      const relE0 = vSub(e0, root0);

      for (const off of offsets) {
        const root = vAdd(root0, off);
        const target = vAdd(target0, off);
        const pole = vAdd(pole0, off);

        const [j, e] = solveTwoBone(root, target, l1, l2, pole);
        const relJ = vSub(j, root);
        const relE = vSub(e, root);

        expect(dist(relJ, relJ0)).toBeLessThan(1e-4);
        expect(dist(relE, relE0)).toBeLessThan(1e-4);
      }
    }
  });
});

describe('Adversarial IK Challenge: Collinear Targets and Degenerate Pole Vectors (TS)', () => {
  it('solves cleanly without NaN across all 3D primary and diagonal axes with parallel/anti-parallel poles', () => {
    const axes: Vec3[] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
      vNorm([1, 1, 1]) as Vec3,
      vNorm([-1, 2, -2]) as Vec3,
    ];

    const root: Vec3 = [5, -3, 2];
    const l1 = 3.0;
    const l2 = 3.0;
    const reach = 4.0;

    for (const axis of axes) {
      const target = vAdd(root, vScale(axis, reach));

      // Parallel pole (k > 0)
      for (const k of [0.5, 1.0, 5.0, 100.0]) {
        const poleParallel = vAdd(root, vScale(axis, k));
        const [j, e] = solveTwoBone(root, target, l1, l2, poleParallel);
        expect(Number.isFinite(j[0]) && Number.isFinite(j[1]) && Number.isFinite(j[2])).toBe(true);
        expect(Number.isFinite(e[0]) && Number.isFinite(e[1]) && Number.isFinite(e[2])).toBe(true);
        expect(dist(root, j)).toBeCloseTo(l1, 3);
        expect(dist(j, e)).toBeCloseTo(l2, 3);
        expect(dist(e, target)).toBeCloseTo(0, 3);
      }

      // Anti-parallel pole (k < 0)
      for (const k of [-0.5, -1.0, -5.0]) {
        const poleAntiparallel = vAdd(root, vScale(axis, k));
        const [j, e] = solveTwoBone(root, target, l1, l2, poleAntiparallel);
        expect(Number.isFinite(j[0]) && Number.isFinite(j[1]) && Number.isFinite(j[2])).toBe(true);
        expect(Number.isFinite(e[0]) && Number.isFinite(e[1]) && Number.isFinite(e[2])).toBe(true);
        expect(dist(root, j)).toBeCloseTo(l1, 3);
        expect(dist(j, e)).toBeCloseTo(l2, 3);
      }

      // Zero pole at root
      const poleZero = [...root] as Vec3;
      const [j, e] = solveTwoBone(root, target, l1, l2, poleZero);
      expect(Number.isFinite(j[0]) && Number.isFinite(j[1]) && Number.isFinite(j[2])).toBe(true);
      expect(Number.isFinite(e[0]) && Number.isFinite(e[1]) && Number.isFinite(e[2])).toBe(true);
      expect(dist(root, j)).toBeCloseTo(l1, 3);
      expect(dist(j, e)).toBeCloseTo(l2, 3);
    }
  });
});

describe('Adversarial IK Challenge: Reach Boundaries & Extension Clamping (TS)', () => {
  it('handles massive overextension and underextension boundaries without NaN', () => {
    const root: Vec3 = [0, 0, 0];
    const pole: Vec3 = [0, 0, 1];
    const dirVec: Vec3 = [0, 1, 0];

    // 1. Overextension l1=3, l2=3
    const l1 = 3.0,
      l2 = 3.0;
    for (const d of [6.0, 6.00001, 10.0, 100.0, 10000.0]) {
      const target = vAdd(root, vScale(dirVec, d));
      const [j, e] = solveTwoBone(root, target, l1, l2, pole);
      expect(Number.isFinite(j[0]) && Number.isFinite(j[1]) && Number.isFinite(j[2])).toBe(true);
      expect(Number.isFinite(e[0]) && Number.isFinite(e[1]) && Number.isFinite(e[2])).toBe(true);
      expect(dist(root, j)).toBeCloseTo(l1, 3);
      expect(dist(j, e)).toBeCloseTo(l2, 3);
      expect(dist(root, e)).toBeCloseTo(Math.min(d, l1 + l2 - 1e-6), 3);
    }

    // 2. Underextension l1=5, l2=2
    for (const d of [3.0, 2.99999, 1.5, 0.5, 0.001]) {
      const target = vAdd(root, vScale(dirVec, d));
      const [j, e] = solveTwoBone(root, target, 5.0, 2.0, pole);
      expect(Number.isFinite(j[0]) && Number.isFinite(j[1]) && Number.isFinite(j[2])).toBe(true);
      expect(Number.isFinite(e[0]) && Number.isFinite(e[1]) && Number.isFinite(e[2])).toBe(true);
      expect(dist(root, j)).toBeCloseTo(5.0, 3);
      expect(dist(j, e)).toBeCloseTo(2.0, 3);
      expect(dist(root, e)).toBeCloseTo(Math.max(Math.abs(5 - 2) + 1e-6, d), 3);
    }

    // 3. Underextension l1=2, l2=5
    for (const d of [3.0, 2.99999, 1.5, 0.5, 0.001]) {
      const target = vAdd(root, vScale(dirVec, d));
      const [j, e] = solveTwoBone(root, target, 2.0, 5.0, pole);
      expect(Number.isFinite(j[0]) && Number.isFinite(j[1]) && Number.isFinite(j[2])).toBe(true);
      expect(Number.isFinite(e[0]) && Number.isFinite(e[1]) && Number.isFinite(e[2])).toBe(true);
      expect(dist(root, j)).toBeCloseTo(2.0, 3);
      expect(dist(j, e)).toBeCloseTo(5.0, 3);
      expect(dist(root, e)).toBeCloseTo(Math.max(Math.abs(2 - 5) + 1e-6, d), 3);
    }
  });
});

describe('Adversarial IK Challenge: Zero-Length Segments & Coincident Target (TS)', () => {
  it('handles zero-length bone segments and target==root without throwing or NaN', () => {
    const root: Vec3 = [10, 20, 30];
    const pole: Vec3 = [10, 20, 31];

    // l1 = 0, l2 = 5
    const [j1, e1] = solveTwoBone(root, [10, 24, 30], 0.0, 5.0, pole);
    expect(Number.isFinite(j1[0]) && Number.isFinite(j1[1]) && Number.isFinite(j1[2])).toBe(true);
    expect(dist(root, j1)).toBeCloseTo(0.0, 3);

    // l1 = 5, l2 = 0
    const [j2, e2] = solveTwoBone(root, [10, 24, 30], 5.0, 0.0, pole);
    expect(Number.isFinite(j2[0]) && Number.isFinite(j2[1]) && Number.isFinite(j2[2])).toBe(true);
    expect(dist(root, j2)).toBeCloseTo(5.0, 3);

    // l1 = 0, l2 = 0
    const [j3, e3] = solveTwoBone(root, [10, 24, 30], 0.0, 0.0, pole);
    expect(Number.isFinite(j3[0]) && Number.isFinite(j3[1]) && Number.isFinite(j3[2])).toBe(true);

    // Coincident root & target (distance 0)
    const [j4, e4] = solveTwoBone(root, root, 3.0, 3.0, pole);
    expect(Number.isFinite(j4[0]) && Number.isFinite(j4[1]) && Number.isFinite(j4[2])).toBe(true);
    expect(dist(root, j4)).toBeCloseTo(3.0, 3);
  });
});

describe('Adversarial IK Challenge: rotFromTo Singularity and Orthogonality (TS)', () => {
  it('preserves rotation properties, determinant +1, and maps vectors correctly across all angles', () => {
    const testCases: [Vec3, Vec3][] = [
      [[1, 0, 0], [1, 0, 0]],      // Identity
      [[1, 0, 0], [-1, 0, 0]],     // 180 deg X
      [[0, 1, 0], [0, -1, 0]],     // 180 deg Y
      [[0, 0, 1], [0, 0, -1]],     // 180 deg Z
      [[1, 0, 0], [0, 1, 0]],      // 90 deg
      [[1, 1, 1], [-1, -1, -1]],   // 180 deg diagonal
      [[0, 1, 0], [1e-7, -1, 0]],  // Near 180 deg
      [[0, 1, 0], [1e-7, 1, 0]],   // Near 0 deg
    ];

    for (let i = 0; i < 50; i++) {
      testCases.push([
        [Math.sin(i * 1.7), Math.cos(i * 2.3), Math.sin(i * 3.1)],
        [Math.cos(i * 1.1), Math.sin(i * 2.9), Math.cos(i * 3.7)],
      ]);
    }

    for (const [a, b] of testCases) {
      const R = rotFromTo(a, b);
      for (const val of R) {
        expect(Number.isFinite(val)).toBe(true);
      }

      // Check R * R^T = I
      const Rt = transpose3(R);
      const identity = mul3(R, Rt);
      expect(identity[0]).toBeCloseTo(1, 4);
      expect(identity[1]).toBeCloseTo(0, 4);
      expect(identity[2]).toBeCloseTo(0, 4);
      expect(identity[3]).toBeCloseTo(0, 4);
      expect(identity[4]).toBeCloseTo(1, 4);
      expect(identity[5]).toBeCloseTo(0, 4);
      expect(identity[6]).toBeCloseTo(0, 4);
      expect(identity[7]).toBeCloseTo(0, 4);
      expect(identity[8]).toBeCloseTo(1, 4);

      // Check determinant = +1
      const det =
        R[0] * (R[4] * R[8] - R[5] * R[7]) -
        R[1] * (R[3] * R[8] - R[5] * R[6]) +
        R[2] * (R[3] * R[7] - R[4] * R[6]);
      expect(det).toBeCloseTo(1, 4);

      // Check R * na = nb
      const na = vNorm(a);
      const nb = vNorm(b);
      const transformed: Vec3 = [
        R[0] * na[0] + R[1] * na[1] + R[2] * na[2],
        R[3] * na[0] + R[4] * na[1] + R[5] * na[2],
        R[6] * na[0] + R[7] * na[1] + R[8] * na[2],
      ];
      expect(dist(transformed, nb)).toBeLessThan(1e-4);
    }
  });
});
