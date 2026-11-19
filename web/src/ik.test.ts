import { describe, expect, it } from 'vitest';
import { solveTwoBone } from './engine';
import { browserRequest, starterProject } from './runtime';
import type { Vec3 } from './types';

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('Two-Bone Analytical IK Solver (solveTwoBone)', () => {
  it('solves standard reachable target with equal bone lengths', () => {
    const root: Vec3 = [0, 0, 0];
    const target: Vec3 = [0, 2, 0];
    const l1 = 2;
    const l2 = 2;
    const pole: Vec3 = [0, 0, 1];

    const [joint, end] = solveTwoBone(root, target, l1, l2, pole);

    // Root to joint must equal l1
    expect(dist(root, joint)).toBeCloseTo(l1, 4);

    // Joint to end must equal l2
    expect(dist(joint, end)).toBeCloseTo(l2, 4);

    // End must match target
    expect(end[0]).toBeCloseTo(target[0], 4);
    expect(end[1]).toBeCloseTo(target[1], 4);
    expect(end[2]).toBeCloseTo(target[2], 4);

    // Joint must bend in +Z direction (pole vector direction)
    expect(joint[2]).toBeGreaterThan(0);
  });

  it('aligns bending direction with inverted pole vector', () => {
    const root: Vec3 = [0, 0, 0];
    const target: Vec3 = [0, 2, 0];
    const l1 = 2;
    const l2 = 2;

    // Pole in -Z
    const [jointNegZ] = solveTwoBone(root, target, l1, l2, [0, 0, -1]);
    expect(jointNegZ[2]).toBeLessThan(0);

    // Pole in +X
    const [jointPosX] = solveTwoBone(root, target, l1, l2, [1, 0, 0]);
    expect(jointPosX[0]).toBeGreaterThan(0);
    expect(jointPosX[2]).toBeCloseTo(0, 4);
  });

  it('handles exact maximum extension reach (target distance = l1 + l2)', () => {
    const root: Vec3 = [0, 0, 0];
    const target: Vec3 = [0, 4, 0];
    const l1 = 2;
    const l2 = 2;
    const pole: Vec3 = [0, 0, 1];

    const [joint, end] = solveTwoBone(root, target, l1, l2, pole);

    expect(dist(root, joint)).toBeCloseTo(l1, 3);
    expect(dist(joint, end)).toBeCloseTo(l2, 3);
    expect(end[1]).toBeCloseTo(4, 3);
    expect(joint[0]).toBeCloseTo(0, 3);
    expect(joint[1]).toBeCloseTo(2, 3);
  });

  it('clamps gracefully when target is overextended beyond maximum reach', () => {
    const root: Vec3 = [0, 0, 0];
    const target: Vec3 = [0, 10, 0]; // Reach is 4, target is 10
    const l1 = 2;
    const l2 = 2;
    const pole: Vec3 = [0, 0, 1];

    const [joint, end] = solveTwoBone(root, target, l1, l2, pole);

    // Should not return NaN or Infinity
    expect(Number.isFinite(joint[0])).toBe(true);
    expect(Number.isFinite(joint[1])).toBe(true);
    expect(Number.isFinite(joint[2])).toBe(true);
    expect(Number.isFinite(end[0])).toBe(true);
    expect(Number.isFinite(end[1])).toBe(true);
    expect(Number.isFinite(end[2])).toBe(true);

    // Bone lengths still hold
    expect(dist(root, joint)).toBeCloseTo(l1, 3);
    expect(dist(joint, end)).toBeCloseTo(l2, 3);

    // Clamped total reach is near l1 + l2 = 4
    expect(dist(root, end)).toBeCloseTo(4, 3);
  });

  it('clamps gracefully when target is underextended closer than |l1 - l2|', () => {
    const root: Vec3 = [0, 0, 0];
    const target: Vec3 = [0, 1, 0]; // |5 - 2| = 3, target is 1
    const l1 = 5;
    const l2 = 2;
    const pole: Vec3 = [0, 0, 1];

    const [joint, end] = solveTwoBone(root, target, l1, l2, pole);

    expect(Number.isFinite(joint[0])).toBe(true);
    expect(Number.isFinite(joint[1])).toBe(true);
    expect(Number.isFinite(joint[2])).toBe(true);
    expect(dist(root, joint)).toBeCloseTo(l1, 3);
    expect(dist(joint, end)).toBeCloseTo(l2, 3);
    expect(dist(root, end)).toBeCloseTo(3, 3);
  });

  it('handles zero-distance singularity (target placed at root [0,0,0]) without NaN', () => {
    const root: Vec3 = [0, 0, 0];
    const target: Vec3 = [0, 0, 0];
    const l1 = 3;
    const l2 = 3;
    const pole: Vec3 = [0, 0, 1];

    const [joint, end] = solveTwoBone(root, target, l1, l2, pole);

    expect(Number.isFinite(joint[0])).toBe(true);
    expect(Number.isFinite(joint[1])).toBe(true);
    expect(Number.isFinite(joint[2])).toBe(true);
    expect(Number.isFinite(end[0])).toBe(true);
    expect(Number.isFinite(end[1])).toBe(true);
    expect(Number.isFinite(end[2])).toBe(true);
    expect(dist(root, joint)).toBeCloseTo(l1, 3);
  });

  it('handles collinear / degenerate pole vector aligned with target direction', () => {
    const root: Vec3 = [0, 0, 0];
    const target: Vec3 = [0, 3, 0];
    const l1 = 2;
    const l2 = 2;
    const collinearPole: Vec3 = [0, 1, 0]; // parallel to target - root

    const [joint, end] = solveTwoBone(root, target, l1, l2, collinearPole);

    expect(Number.isFinite(joint[0])).toBe(true);
    expect(Number.isFinite(joint[1])).toBe(true);
    expect(Number.isFinite(joint[2])).toBe(true);
    expect(dist(root, joint)).toBeCloseTo(l1, 3);
    expect(dist(joint, end)).toBeCloseTo(l2, 3);
  });

  it('handles zero pole vector [0,0,0] gracefully', () => {
    const root: Vec3 = [0, 0, 0];
    const target: Vec3 = [0, 3, 0];
    const l1 = 2;
    const l2 = 2;
    const zeroPole: Vec3 = [0, 0, 0];

    const [joint, end] = solveTwoBone(root, target, l1, l2, zeroPole);

    expect(Number.isFinite(joint[0])).toBe(true);
    expect(Number.isFinite(joint[1])).toBe(true);
    expect(Number.isFinite(joint[2])).toBe(true);
    expect(dist(root, joint)).toBeCloseTo(l1, 3);
    expect(dist(joint, end)).toBeCloseTo(l2, 3);
  });

  it('solves asymmetric bone lengths in 3D arbitrary space', () => {
    const root: Vec3 = [1, 2, -1];
    const target: Vec3 = [4, 6, 2];
    const l1 = 4.5;
    const l2 = 3.0;
    const pole: Vec3 = [0, 1, 0];

    const [joint, end] = solveTwoBone(root, target, l1, l2, pole);

    expect(dist(root, joint)).toBeCloseTo(l1, 3);
    expect(dist(joint, end)).toBeCloseTo(l2, 3);
    expect(end[0]).toBeCloseTo(target[0], 3);
    expect(end[1]).toBeCloseTo(target[1], 3);
    expect(end[2]).toBeCloseTo(target[2], 3);
  });

  it('solves across multiple 3D octants', () => {
    const octantTargets: Vec3[] = [
      [2, 2, 2],
      [-2, 2, 2],
      [2, -2, 2],
      [-2, -2, 2],
      [2, 2, -2],
      [-2, 2, -2],
      [2, -2, -2],
      [-2, -2, -2],
    ];

    const root: Vec3 = [0, 0, 0];
    const l1 = 2.5;
    const l2 = 2.5;
    const pole: Vec3 = [0, 1, 0];

    for (const target of octantTargets) {
      const [joint, end] = solveTwoBone(root, target, l1, l2, pole);
      expect(dist(root, joint)).toBeCloseTo(l1, 3);
      expect(dist(joint, end)).toBeCloseTo(l2, 3);
      expect(dist(end, target)).toBeCloseTo(0, 3);
    }
  });
});

import { setupTestEnvironment } from './test-helpers';

describe('IK Animation Drag Integration (browserRequest)', () => {
  it('records target and pole drag keyframes into document IK tracks', async () => {
    setupTestEnvironment();

    const doc = starterProject('ik_test');
    doc.rig.bones = {
      root: { part: 'part' },
      left_upper_leg: { parent: 'root' },
      left_lower_leg: { parent: 'left_upper_leg' },
      left_foot: { parent: 'left_lower_leg' },
    };
    doc.rig.ik_chains = {
      left_leg: { root: 'left_upper_leg', mid: 'left_lower_leg', end: 'left_foot' },
    };

    // Drag target
    const resTarget = await browserRequest('/api/rig/drag', {
      body: JSON.stringify({
        document: doc,
        kind: 'target',
        name: 'left_leg',
        clip: 'idle',
        frame: 3,
        screen: [48, 88],
        depth: 5,
        direction: 0,
      }),
    });
    const targetPayload = await resTarget.json();
    expect(targetPayload.document.animations.idle.ik.left_leg.target).toBeDefined();
    const targetKey = targetPayload.document.animations.idle.ik.left_leg.target[0];
    expect(targetKey.frame).toBe(3);
    expect(targetKey.interpolation).toBe('linear');
    expect(targetKey.value.length).toBe(3);

    // Drag pole
    const resPole = await browserRequest('/api/rig/drag', {
      body: JSON.stringify({
        document: targetPayload.document,
        kind: 'pole',
        name: 'left_leg',
        clip: 'idle',
        frame: 3,
        screen: [50, 80],
        depth: 2,
        direction: 0,
      }),
    });
    const polePayload = await resPole.json();
    expect(polePayload.document.animations.idle.ik.left_leg.pole).toBeDefined();
    const poleKey = polePayload.document.animations.idle.ik.left_leg.pole[0];
    expect(poleKey.frame).toBe(3);
    expect(poleKey.interpolation).toBe('linear');
  });
});
