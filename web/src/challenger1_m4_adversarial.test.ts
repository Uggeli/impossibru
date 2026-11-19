import { describe, it, expect } from 'vitest';
import {
  pose,
  validateProject,
  ProjectError,
  euler,
  extractR3,
  mat4FromR3T,
  mul,
  vSub,
  vLen,
} from './engine';
import { starterProject } from './runtime';
import { setupTestEnvironment } from './test-helpers';
setupTestEnvironment();

import { cleanAnimationTracks } from './app';
import type { ProjectDocument, Vec3 } from './types';

function createComplexProject(): ProjectDocument {
  const doc = starterProject('complex_rig_test');
  doc.rig.bones = {
    root: { translation: [0, 10, 0], rotation: [0, 0, 0] },
    spine: { parent: 'root', translation: [0, 4, 0], rotation: [0, 0, 0] },
    chest: { parent: 'spine', translation: [0, 4, 0], rotation: [0, 0, 0] },
    head: { parent: 'chest', translation: [0, 4, 0], rotation: [0, 0, 0] },
    leaf_accessory: { parent: 'head', translation: [0, 2, 0], rotation: [0, 0, 0] },
    // Left leg
    hip_l: { parent: 'root', translation: [2, -2, 0], rotation: [0, 0, 0] },
    knee_l: { parent: 'hip_l', translation: [0, -4, 0], rotation: [0, 0, 0] },
    foot_l: { parent: 'knee_l', translation: [0, -4, 0], rotation: [0, 0, 0] },
    // Right leg
    hip_r: { parent: 'root', translation: [-2, -2, 0], rotation: [0, 0, 0] },
    knee_r: { parent: 'hip_r', translation: [0, -4, 0], rotation: [0, 0, 0] },
    foot_r: { parent: 'knee_r', translation: [0, -4, 0], rotation: [0, 0, 0] },
  };
  doc.rig.ik_chains = {
    leg_l: { root: 'hip_l', mid: 'knee_l', end: 'foot_l' },
    leg_r: { root: 'hip_r', mid: 'knee_r', end: 'foot_r' },
  };
  doc.animations = {
    walk: {
      frames: 16,
      fps: 12,
      loop: true,
      bones: {
        root: {
          translation: [
            { frame: 0, value: [0, 0, 0], interpolation: 'linear' },
            { frame: 8, value: [0, 1, 0], interpolation: 'smooth' },
            { frame: 15, value: [0, 0, 0], interpolation: 'linear' },
          ],
          rotation: [
            { frame: 0, value: [0, 0, 0], interpolation: 'linear' },
            { frame: 8, value: [0, 15, 0], interpolation: 'smooth' },
          ],
        },
        spine: {
          rotation: [
            { frame: 0, value: [5, 0, 0], interpolation: 'linear' },
            { frame: 8, value: [-5, 0, 0], interpolation: 'smooth' },
          ],
        },
        leaf_accessory: {
          rotation: [
            { frame: 0, value: [0, 0, 0], interpolation: 'step' },
            { frame: 8, value: [10, 0, 0], interpolation: 'step' },
          ],
        },
      },
      ik: {
        leg_l: {
          target: [
            { frame: 0, value: [2, 0, 2], interpolation: 'linear' },
            { frame: 8, value: [2, 2, -2], interpolation: 'smooth' },
            { frame: 15, value: [2, 0, 2], interpolation: 'linear' },
          ],
          pole: [
            { frame: 0, value: [2, 0, 5], interpolation: 'linear' },
            { frame: 8, value: [2, 1, 5], interpolation: 'smooth' },
          ],
          weight: [
            { frame: 0, value: 1.0, interpolation: 'linear' },
            { frame: 8, value: 0.8, interpolation: 'smooth' },
          ],
        },
        leg_r: {
          target: [
            { frame: 0, value: [-2, 2, -2], interpolation: 'smooth' },
            { frame: 8, value: [-2, 0, 2], interpolation: 'linear' },
          ],
          weight: [
            { frame: 0, value: 1.0, interpolation: 'linear' },
          ],
        },
      },
    },
    single_frame: {
      frames: 1,
      fps: 10,
      loop: true,
      bones: {
        root: {
          translation: [{ frame: 0, value: [1, 2, 3], interpolation: 'linear' }],
        },
      },
      ik: {},
    },
  };
  doc.export = {
    size: [96, 96],
    scale: 3,
  };
  return doc;
}

describe('Challenger 1 Adversarial: Keyframe Deletion and Track Pruning Stress Suite', () => {
  it('iterative keyframe deletion across bone and IK tracks leaves document valid at every single step', () => {
    const doc = createComplexProject();
    expect(() => validateProject(doc)).not.toThrow();

    const walk = doc.animations.walk;

    // Step 1: Delete keyframe 1 from root.translation (leaving 2 keys)
    walk.bones.root.translation.splice(1, 1);
    cleanAnimationTracks(doc);
    expect(walk.bones.root.translation.length).toBe(2);
    expect(() => validateProject(doc)).not.toThrow();

    // Step 2: Delete keyframe 0 and 1 from root.translation (leaving 0 keys -> pruned)
    walk.bones.root.translation.splice(0, 2);
    cleanAnimationTracks(doc);
    expect(walk.bones.root.translation).toBeUndefined();
    expect(walk.bones.root.rotation).toBeDefined(); // rotation remains
    expect(() => validateProject(doc)).not.toThrow();

    // Step 3: Delete all keys from root.rotation (pruning root entirely from walk.bones)
    walk.bones.root.rotation.splice(0, walk.bones.root.rotation.length);
    cleanAnimationTracks(doc);
    expect(walk.bones.root).toBeUndefined();
    expect(() => validateProject(doc)).not.toThrow();

    // Step 4: Delete target keys from leg_l (target pruned, pole & weight preserved)
    walk.ik.leg_l.target.splice(0, walk.ik.leg_l.target.length);
    cleanAnimationTracks(doc);
    expect(walk.ik.leg_l.target).toBeUndefined();
    expect(walk.ik.leg_l.pole).toBeDefined();
    expect(walk.ik.leg_l.weight).toBeDefined();
    expect(() => validateProject(doc)).not.toThrow();

    // Step 5: Delete pole keys from leg_l (pole pruned, weight preserved)
    walk.ik.leg_l.pole.splice(0, walk.ik.leg_l.pole.length);
    cleanAnimationTracks(doc);
    expect(walk.ik.leg_l.pole).toBeUndefined();
    expect(walk.ik.leg_l.weight).toBeDefined();
    expect(() => validateProject(doc)).not.toThrow();

    // Step 6: Delete weight keys from leg_l (leg_l pruned entirely from walk.ik)
    walk.ik.leg_l.weight.splice(0, walk.ik.leg_l.weight.length);
    cleanAnimationTracks(doc);
    expect(walk.ik.leg_l).toBeUndefined();
    expect(walk.ik.leg_r).toBeDefined(); // leg_r remains
    expect(() => validateProject(doc)).not.toThrow();

    // Step 7: Delete all remaining bone tracks and ik tracks
    delete walk.bones.spine;
    delete walk.bones.leaf_accessory;
    delete walk.ik.leg_r;
    cleanAnimationTracks(doc);
    expect(walk.bones).toEqual({});
    expect(walk.ik).toEqual({});
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('unpruned empty arrays trigger validateProject ProjectError, and cleanAnimationTracks cures it', () => {
    const doc = createComplexProject();
    const walk = doc.animations.walk;

    // Force an empty array directly without cleanAnimationTracks
    walk.bones.spine.rotation = [];
    expect(() => validateProject(doc)).toThrow(ProjectError);
    expect(() => validateProject(doc)).toThrow(/must be a non-empty keyframe list/);

    // Force an empty IK array
    walk.bones.spine.rotation = [{ frame: 0, value: [0, 0, 0], interpolation: 'linear' }];
    walk.ik.leg_r.target = [];
    expect(() => validateProject(doc)).toThrow(ProjectError);
    expect(() => validateProject(doc)).toThrow(/must be a non-empty keyframe list/);

    // Run cleanAnimationTracks and verify cure
    cleanAnimationTracks(doc);
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('verifies bone deletion is unblocked after track pruning for leaf bones, but respects structural invariants', () => {
    const doc = createComplexProject();

    // Helper simulating deleteBone blocker check in app.ts:2499-2508
    const checkDeleteBoneBlocks = (name: string): string[] => {
      const children = Object.entries(doc.rig.bones)
        .filter(([, b]) => b.parent === name)
        .map(([n]) => n);
      const tracks = Object.entries(doc.animations)
        .filter(([, c]) => c.bones?.[name])
        .map(([n]) => n);
      const chains = Object.entries(doc.rig.ik_chains || {})
        .filter(([, c]) => [c.root, c.mid, c.end].includes(name))
        .map(([n]) => n);
      const blocks: string[] = [];
      if (children.length) blocks.push('children: ' + children.join(', '));
      if (tracks.length) blocks.push('animation tracks: ' + tracks.join(', '));
      if (chains.length) blocks.push('IK chains: ' + chains.join(', '));
      return blocks;
    };

    // Before pruning: leaf_accessory has animation tracks in walk
    let leafBlocks = checkDeleteBoneBlocks('leaf_accessory');
    expect(leafBlocks).toContain('animation tracks: walk');

    // Prune leaf_accessory keyframes
    doc.animations.walk.bones.leaf_accessory.rotation = [];
    cleanAnimationTracks(doc);

    // After pruning: leaf_accessory has no blocks and can be safely deleted!
    leafBlocks = checkDeleteBoneBlocks('leaf_accessory');
    expect(leafBlocks.length).toBe(0);
    delete doc.rig.bones.leaf_accessory;
    expect(() => validateProject(doc)).not.toThrow();

    // Structural guard check: spine has children (chest) and root has children
    const spineBlocks = checkDeleteBoneBlocks('spine');
    expect(spineBlocks.some((b) => b.startsWith('children:'))).toBe(true);

    // Structural guard check: foot_l has IK chain leg_l
    const footBlocks = checkDeleteBoneBlocks('foot_l');
    expect(footBlocks.some((b) => b.startsWith('IK chains:'))).toBe(true);
  });

  it('verifies IK chain deletion is unblocked after IK track pruning', () => {
    const doc = createComplexProject();

    const checkDeleteChainBlocks = (name: string): string[] => {
      return Object.entries(doc.animations)
        .filter(([, c]) => c.ik?.[name])
        .map(([n]) => n);
    };

    // Before pruning: leg_l has IK tracks in walk
    let chainBlocks = checkDeleteChainBlocks('leg_l');
    expect(chainBlocks).toContain('walk');

    // Empty all tracks in leg_l
    doc.animations.walk.ik.leg_l.target = [];
    doc.animations.walk.ik.leg_l.pole = [];
    doc.animations.walk.ik.leg_l.weight = [];
    cleanAnimationTracks(doc);

    // After pruning: leg_l has no IK tracks in any animation clip
    chainBlocks = checkDeleteChainBlocks('leg_l');
    expect(chainBlocks.length).toBe(0);

    // Deleting IK chain leaves document valid
    delete doc.rig.ik_chains.leg_l;
    expect(() => validateProject(doc)).not.toThrow();
  });
});

describe('Challenger 1 Adversarial: Interpolation Modes, Extreme Frame Counts & Looping Suite', () => {
  it('handles 1-frame clips seamlessly in pose evaluation and loop boundaries without division by zero', () => {
    const doc = createComplexProject();
    const clip1 = doc.animations.single_frame;
    expect(clip1.frames).toBe(1);

    // Evaluate pose at frame 0 with loop=true
    clip1.loop = true;
    const pose1Loop = pose(doc, 'single_frame', 0);
    expect(pose1Loop.root[3]).toBeCloseTo(1, 5);
    expect(pose1Loop.root[7]).toBeCloseTo(12, 5); // base 10 + trans 2
    expect(pose1Loop.root[11]).toBeCloseTo(3, 5);
    // Ensure all matrix entries are finite and non-NaN
    for (const mat of Object.values(pose1Loop)) {
      expect(mat.every((v) => Number.isFinite(v) && !Number.isNaN(v))).toBe(true);
    }

    // Evaluate pose at frame 0 with loop=false
    clip1.loop = false;
    const pose1NoLoop = pose(doc, 'single_frame', 0);
    expect(pose1NoLoop.root[3]).toBeCloseTo(1, 5);
    for (const mat of Object.values(pose1NoLoop)) {
      expect(mat.every((v) => Number.isFinite(v) && !Number.isNaN(v))).toBe(true);
    }
  });

  it('handles 1000-frame clips with extreme frame indices and compares linear vs smooth vs step', () => {
    const doc = createComplexProject();
    doc.animations.huge_clip = {
      frames: 1000,
      fps: 60,
      loop: true,
      bones: {
        root: {
          translation: [
            { frame: 0, value: [0, 0, 0], interpolation: 'linear' },
            { frame: 999, value: [999, 0, 0], interpolation: 'linear' },
          ],
          rotation: [
            { frame: 0, value: [0, 0, 0], interpolation: 'step' },
            { frame: 999, value: [90, 0, 0], interpolation: 'step' },
          ],
        },
      },
      ik: {},
    };

    expect(() => validateProject(doc)).not.toThrow();

    // Frame 0: translation [0, 10, 0], rotation 0
    const p0 = pose(doc, 'huge_clip', 0);
    expect(p0.root[3]).toBeCloseTo(0, 4);

    // Frame 500: linear translation = 500
    const p500 = pose(doc, 'huge_clip', 500);
    expect(p500.root[3]).toBeCloseTo(500, 4);
    // Step rotation at frame 500 should still be frame 0 value (identity)
    expect(p500.root[0]).toBeCloseTo(1, 4);
    expect(p500.root[5]).toBeCloseTo(1, 4);

    // Test Smooth interpolation on huge clip
    doc.animations.huge_clip.bones.root.translation = [
      { frame: 0, value: [0, 0, 0], interpolation: 'smooth' },
      { frame: 1000 - 1, value: [1000, 0, 0], interpolation: 'smooth' },
    ];
    // At t = 0.5 (frame 499.5 in continuous or frame 500 -> t = 500/999)
    const t500 = 500 / 999;
    const smoothT500 = t500 * t500 * (3 - 2 * t500);
    const expectedX = 1000 * smoothT500;
    const pSmooth = pose(doc, 'huge_clip', 500);
    expect(pSmooth.root[3]).toBeCloseTo(expectedX, 3);
  });

  it('correctly evaluates loop boundary wrapping when keyframes do not touch frame 0 or L-1', () => {
    const doc = createComplexProject();
    doc.animations.wrap_test = {
      frames: 10,
      fps: 10,
      loop: true,
      bones: {
        root: {
          translation: [
            { frame: 2, value: [20, 0, 0], interpolation: 'linear' },
            { frame: 8, value: [80, 0, 0], interpolation: 'linear' },
          ],
        },
      },
      ik: {},
    };

    // Total distance wrapped between frame 8 and frame 2 is (10 - 8) + 2 = 4 frames.
    // Frame 8: 80
    // Frame 9: 1 frame after 8 (t = 1/4 = 0.25) -> 80 + 0.25*(20 - 80) = 65
    // Frame 0: 2 frames after 8 (t = 2/4 = 0.50) -> 80 + 0.50*(20 - 80) = 50
    // Frame 1: 3 frames after 8 (t = 3/4 = 0.75) -> 80 + 0.75*(20 - 80) = 35
    // Frame 2: 20
    const p9 = pose(doc, 'wrap_test', 9);
    expect(p9.root[3]).toBeCloseTo(65, 4);

    const p0 = pose(doc, 'wrap_test', 0);
    expect(p0.root[3]).toBeCloseTo(50, 4);

    const p1 = pose(doc, 'wrap_test', 1);
    expect(p1.root[3]).toBeCloseTo(35, 4);

    const p2 = pose(doc, 'wrap_test', 2);
    expect(p2.root[3]).toBeCloseTo(20, 4);

    // Change to Smooth interpolation on wrapped segment
    doc.animations.wrap_test.bones.root.translation = [
      { frame: 2, value: [20, 0, 0], interpolation: 'smooth' },
      { frame: 8, value: [80, 0, 0], interpolation: 'smooth' },
    ];
    // Frame 9: t = 0.25 -> smooth t = 0.25*0.25*(3 - 0.5) = 0.0625 * 2.5 = 0.15625
    // Expected = 80 + 0.15625 * (20 - 80) = 80 - 9.375 = 70.625
    const p9Smooth = pose(doc, 'wrap_test', 9);
    expect(p9Smooth.root[3]).toBeCloseTo(70.625, 4);

    // Frame 0: t = 0.50 -> smooth t = 0.50*0.50*(3 - 1.0) = 0.25 * 2.0 = 0.50
    // Expected = 80 + 0.50 * (20 - 80) = 50.0
    const p0Smooth = pose(doc, 'wrap_test', 0);
    expect(p0Smooth.root[3]).toBeCloseTo(50.0, 4);

    // Frame 1: t = 0.75 -> smooth t = 0.75*0.75*(3 - 1.5) = 0.5625 * 1.5 = 0.84375
    // Expected = 80 + 0.84375 * (20 - 80) = 80 - 50.625 = 29.375
    const p1Smooth = pose(doc, 'wrap_test', 1);
    expect(p1Smooth.root[3]).toBeCloseTo(29.375, 4);

    // Change to Step interpolation on wrapped segment
    doc.animations.wrap_test.bones.root.translation = [
      { frame: 2, value: [20, 0, 0], interpolation: 'step' },
      { frame: 8, value: [80, 0, 0], interpolation: 'step' },
    ];
    // Frame 8 is left key with step, so frame 9, 0, 1 all hold frame 8 value (80)
    expect(pose(doc, 'wrap_test', 9).root[3]).toBeCloseTo(80, 4);
    expect(pose(doc, 'wrap_test', 0).root[3]).toBeCloseTo(80, 4);
    expect(pose(doc, 'wrap_test', 1).root[3]).toBeCloseTo(80, 4);
    expect(pose(doc, 'wrap_test', 2).root[3]).toBeCloseTo(20, 4);
  });

  it('single keyframe tracks return exact authored value across all frames regardless of loop mode', () => {
    const doc = createComplexProject();
    doc.animations.single_key = {
      frames: 8,
      fps: 10,
      loop: true,
      bones: {
        root: {
          translation: [{ frame: 5, value: [42, 13, 99], interpolation: 'linear' }],
        },
      },
      ik: {},
    };

    for (let f = 0; f < 8; f++) {
      // Base root translation is [0, 10, 0] + [42, 13, 99] = [42, 23, 99]
      const p = pose(doc, 'single_key', f);
      expect(p.root[3]).toBeCloseTo(42, 4);
      expect(p.root[7]).toBeCloseTo(23, 4);
      expect(p.root[11]).toBeCloseTo(99, 4);
    }

    // Now test with loop: false
    doc.animations.single_key.loop = false;
    for (let f = 0; f < 8; f++) {
      const p = pose(doc, 'single_key', f);
      expect(p.root[3]).toBeCloseTo(42, 4);
      expect(p.root[7]).toBeCloseTo(23, 4);
      expect(p.root[11]).toBeCloseTo(99, 4);
    }
  });

  it('track muting fallback adheres to exact mathematical rest pose and FK evaluation', () => {
    const doc = createComplexProject();
    const walk = doc.animations.walk;

    // 1. Calculate unmuted pose at frame 8
    const pUnmuted = pose(doc, 'walk', 8);

    // 2. Mute root bone completely
    const pMutedRoot = pose(doc, 'walk', 8, new Set(['root']));
    // Rest root translation is [0, 10, 0], rest rotation is [0, 0, 0] (identity)
    expect(pMutedRoot.root[3]).toBeCloseTo(0, 5);
    expect(pMutedRoot.root[7]).toBeCloseTo(10, 5);
    expect(pMutedRoot.root[11]).toBeCloseTo(0, 5);
    expect(pMutedRoot.root[0]).toBeCloseTo(1, 5);
    expect(pMutedRoot.root[5]).toBeCloseTo(1, 5);
    expect(pMutedRoot.root[10]).toBeCloseTo(1, 5);

    // 3. Mute leg_l IK chain completely -> FK fallback
    const pMutedIK = pose(doc, 'walk', 8, new Set(['leg_l']));
    // Compare against pure FK (document with empty IK)
    const docFK = JSON.parse(JSON.stringify(doc));
    delete docFK.animations.walk.ik.leg_l;
    const pFK = pose(docFK, 'walk', 8);
    for (let i = 0; i < 16; i++) {
      expect(pMutedIK.foot_l[i]).toBeCloseTo(pFK.foot_l[i], 5);
      expect(pMutedIK.knee_l[i]).toBeCloseTo(pFK.knee_l[i], 5);
      expect(pMutedIK.hip_l[i]).toBeCloseTo(pFK.hip_l[i], 5);
    }
    // With root rotation [0, 15, 0] at frame 8:
    // hip_l X is 2 * cos(15 deg) = 1.93185, Z is -2 * sin(15 deg) = -0.5176
    expect(pMutedIK.foot_l[3]).toBeCloseTo(2 * Math.cos((15 * Math.PI) / 180), 4);
    expect(pMutedIK.foot_l[7]).toBeCloseTo(1, 4); // Root 10 + 1 (root trans) - 2 - 4 - 4 = 1
    expect(pMutedIK.foot_l[11]).toBeCloseTo(-2 * Math.sin((15 * Math.PI) / 180), 4);

    // Muting both root rotation and leg_l IK yields exact unrotated rest position [2, 1, 0]
    const pMutedRootRotAndIK = pose(doc, 'walk', 8, new Set(['root.rotation', 'leg_l']));
    expect(pMutedRootRotAndIK.foot_l[3]).toBeCloseTo(2, 4);
    expect(pMutedRootRotAndIK.foot_l[7]).toBeCloseTo(1, 4);
    expect(pMutedRootRotAndIK.foot_l[11]).toBeCloseTo(0, 4);

    // 4. Mute only leg_l.pole -> solver uses default pole [0, 0, 1] without NaN
    const pMutedPole = pose(doc, 'walk', 8, new Set(['leg_l.pole']));
    expect(pMutedPole.foot_l.every((v) => Number.isFinite(v) && !Number.isNaN(v))).toBe(true);

    // 5. Mute only leg_l.weight -> solver uses default weight 1.0
    const pMutedWeight = pose(doc, 'walk', 8, new Set(['leg_l.weight']));
    expect(pMutedWeight.foot_l.every((v) => Number.isFinite(v) && !Number.isNaN(v))).toBe(true);
  });
});
