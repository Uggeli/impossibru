import { describe, it, expect } from 'vitest';
import {
  pose,
  validateProject,
  ProjectError,
} from './engine';
import {
  starterProject,
} from './runtime';
import { setupTestEnvironment } from './test-helpers';
setupTestEnvironment();

import { cleanAnimationTracks } from './app';
import type { ProjectDocument } from './types';

describe('Milestone 4: Keyframe Deletion & Schema Safety', () => {
  it('cleanAnimationTracks removes empty track arrays and empty bone/ik containers', () => {
    const doc = starterProject('clean_test');
    const clip = doc.animations.idle;

    // Simulate empty track arrays and empty bone/ik objects
    clip.bones = {
      root: {
        translation: [], // empty track array
        rotation: [{ frame: 0, value: [0, 0, 0], interpolation: 'linear' }]
      },
      spine: {
        rotation: [] // will become empty bone object
      }
    };
    clip.ik = {
      leg_chain: {
        target: [] // empty ik track
      }
    };

    cleanAnimationTracks(doc);

    // root.translation should be pruned, root.rotation retained
    expect(clip.bones.root.translation).toBeUndefined();
    expect(clip.bones.root.rotation).toBeDefined();

    // spine had only empty tracks, so spine bone entry should be pruned
    expect(clip.bones.spine).toBeUndefined();

    // leg_chain had only empty tracks, so leg_chain ik entry should be pruned
    expect(clip.ik.leg_chain).toBeUndefined();

    // Project should pass validation without throwing "must be a non-empty keyframe list"
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('prunes tracks on keyframe deletion so deleting the last keyframe does not corrupt schema', () => {
    const doc = starterProject('prune_test');
    const clip = doc.animations.idle;

    clip.bones = {
      root: {
        translation: [{ frame: 0, value: [1, 2, 3], interpolation: 'linear' }]
      }
    };

    // Before deletion: valid
    expect(() => validateProject(doc)).not.toThrow();

    // Simulate deleting the only keyframe
    clip.bones.root.translation.splice(0, 1);
    expect(clip.bones.root.translation.length).toBe(0);

    // Prune tracks
    cleanAnimationTracks(doc);

    expect(clip.bones.root).toBeUndefined();
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('prunes IK tracks when all IK keyframes are deleted', () => {
    const doc = starterProject('ik_prune_test');
    doc.rig.ik_chains = {
      leg: { root: 'hip', mid: 'knee', end: 'foot' }
    };
    doc.rig.bones.hip = { translation: [0, 0, 0] };
    doc.rig.bones.knee = { parent: 'hip', translation: [0, -4, 0] };
    doc.rig.bones.foot = { parent: 'knee', translation: [0, -4, 0] };

    const clip = doc.animations.idle;
    clip.ik = {
      leg: {
        target: [{ frame: 0, value: [0, -8, 0], interpolation: 'linear' }],
        weight: [{ frame: 0, value: 1.0, interpolation: 'linear' }]
      }
    };

    expect(() => validateProject(doc)).not.toThrow();

    // Delete target keyframe
    clip.ik.leg.target.splice(0, 1);
    cleanAnimationTracks(doc);

    expect(clip.ik.leg.target).toBeUndefined();
    expect(clip.ik.leg.weight).toBeDefined();
    expect(() => validateProject(doc)).not.toThrow();

    // Delete weight keyframe
    clip.ik.leg.weight.splice(0, 1);
    cleanAnimationTracks(doc);

    expect(clip.ik.leg).toBeUndefined();
    expect(() => validateProject(doc)).not.toThrow();
  });
});

describe('Milestone 4: Track Interpolation & Looping', () => {
  it('correctly evaluates linear, smooth, and step interpolation modes', () => {
    const doc = starterProject('interp_test');
    const clip = doc.animations.idle;
    clip.frames = 11;
    clip.loop = false;

    // Linear translation from [0,0,0] at frame 0 to [10,20,30] at frame 10
    // Step rotation at frame 0 [0,0,0] -> frame 10 [90,90,90]
    // Smooth translation on spine
    clip.bones = {
      root: {
        translation: [
          { frame: 0, value: [0, 0, 0], interpolation: 'linear' },
          { frame: 10, value: [10, 20, 30], interpolation: 'linear' }
        ],
        rotation: [
          { frame: 0, value: [0, 0, 0], interpolation: 'step' },
          { frame: 10, value: [90, 0, 0], interpolation: 'step' }
        ]
      }
    };

    // Frame 5: Linear translation should be [5, 10, 15]
    const p5 = pose(doc, 'idle', 5);
    expect(p5.root[3]).toBeCloseTo(5, 4);
    expect(p5.root[7]).toBeCloseTo(10, 4);
    expect(p5.root[11]).toBeCloseTo(15, 4);

    // Frame 5: Step rotation should hold frame 0 value [0,0,0]
    // In rest/0 rotation, matrix diagonal is 1
    expect(p5.root[0]).toBeCloseTo(1, 4);
    expect(p5.root[5]).toBeCloseTo(1, 4);
    expect(p5.root[10]).toBeCloseTo(1, 4);

    // Test Smooth interpolation (Hermite cubic 3t^2 - 2t^3)
    clip.bones.root.translation = [
      { frame: 0, value: [0, 0, 0], interpolation: 'smooth' },
      { frame: 10, value: [10, 0, 0], interpolation: 'smooth' }
    ];

    // At t = 0.25 (frame 2.5 in continuous, or frame 2 -> t=0.2):
    // For frame 2 (t = 0.2): smooth t = 0.2 * 0.2 * (3 - 0.4) = 0.04 * 2.6 = 0.104
    // Position = 10 * 0.104 = 1.04
    const p2 = pose(doc, 'idle', 2);
    expect(p2.root[3]).toBeCloseTo(1.04, 3);

    // At frame 5 (t = 0.5): smooth t = 0.25 * 2 = 0.5 -> Position = 5.0
    const pSmooth5 = pose(doc, 'idle', 5);
    expect(pSmooth5.root[3]).toBeCloseTo(5.0, 4);

    // At frame 8 (t = 0.8): smooth t = 0.64 * (3 - 1.6) = 0.64 * 1.4 = 0.896
    // Position = 10 * 0.896 = 8.96
    const p8 = pose(doc, 'idle', 8);
    expect(p8.root[3]).toBeCloseTo(8.96, 3);
  });

  it('evaluates loop boundary wrapping across clip boundary', () => {
    const doc = starterProject('loop_test');
    const clip = doc.animations.idle;
    clip.frames = 8;
    clip.loop = true;

    // Keys at frame 2 (value: 20) and frame 6 (value: 60)
    clip.bones = {
      root: {
        translation: [
          { frame: 2, value: [20, 0, 0], interpolation: 'linear' },
          { frame: 6, value: [60, 0, 0], interpolation: 'linear' }
        ]
      }
    };

    // With loop: true and frames: 8:
    // Distance between frame 6 and frame 2 wrapped is (8 - 6) + 2 = 4 frames.
    // At frame 0: 2 frames after frame 6 wrapped -> exactly halfway between 60 and 20 -> value 40!
    const p0 = pose(doc, 'idle', 0);
    expect(p0.root[3]).toBeCloseTo(40, 4);

    // At frame 7: 1 frame after frame 6 wrapped (t = 0.25 from 60 to 20) -> value 50!
    const p7 = pose(doc, 'idle', 7);
    expect(p7.root[3]).toBeCloseTo(50, 4);

    // At frame 1: 3 frames after frame 6 wrapped (t = 0.75 from 60 to 20) -> value 30!
    const p1 = pose(doc, 'idle', 1);
    expect(p1.root[3]).toBeCloseTo(30, 4);
  });

  it('clamps without wrapping when loop is false', () => {
    const doc = starterProject('noloop_test');
    const clip = doc.animations.idle;
    clip.frames = 8;
    clip.loop = false;

    clip.bones = {
      root: {
        translation: [
          { frame: 2, value: [20, 0, 0], interpolation: 'linear' },
          { frame: 6, value: [60, 0, 0], interpolation: 'linear' }
        ]
      }
    };

    // At frame 0: clamps to frame 2 value (20)
    const p0 = pose(doc, 'idle', 0);
    expect(p0.root[3]).toBeCloseTo(20, 4);

    // At frame 7: clamps to frame 6 value (60)
    const p7 = pose(doc, 'idle', 7);
    expect(p7.root[3]).toBeCloseTo(60, 4);
  });
});

describe('Milestone 4: Track Muting in Engine Pose Evaluation', () => {
  it('falls back to rest pose when translation or rotation track is muted', () => {
    const doc = starterProject('mute_test');
    doc.rig.bones.root.translation = [0, 5, 0];
    doc.rig.bones.root.rotation = [0, 0, 0];

    const clip = doc.animations.idle;
    clip.bones = {
      root: {
        translation: [{ frame: 0, value: [10, 20, 30], interpolation: 'linear' }],
        rotation: [{ frame: 0, value: [45, 0, 0], interpolation: 'linear' }]
      }
    };

    // Unmuted pose: translation is [0+10, 5+20, 0+30] = [10, 25, 30]
    const pUnmuted = pose(doc, 'idle', 0);
    expect(pUnmuted.root[3]).toBeCloseTo(10, 4);
    expect(pUnmuted.root[7]).toBeCloseTo(25, 4);
    expect(pUnmuted.root[11]).toBeCloseTo(30, 4);

    // Mute root.translation
    const mutedT = new Set(['root.translation']);
    const pMutedT = pose(doc, 'idle', 0, mutedT);
    // Translation falls back to rest pose [0, 5, 0]
    expect(pMutedT.root[3]).toBeCloseTo(0, 4);
    expect(pMutedT.root[7]).toBeCloseTo(5, 4);
    expect(pMutedT.root[11]).toBeCloseTo(0, 4);
    // Rotation remains animated (45 deg)
    expect(pMutedT.root[5]).toBeCloseTo(Math.cos(Math.PI / 4), 4);

    // Mute root.rotation
    const mutedR = new Set(['root.rotation']);
    const pMutedR = pose(doc, 'idle', 0, mutedR);
    // Translation is animated
    expect(pMutedR.root[3]).toBeCloseTo(10, 4);
    // Rotation falls back to rest pose [0, 0, 0] (identity R3)
    expect(pMutedR.root[0]).toBeCloseTo(1, 4);
    expect(pMutedR.root[5]).toBeCloseTo(1, 4);
    expect(pMutedR.root[10]).toBeCloseTo(1, 4);

    // Mute entire root bone
    const mutedBone = new Set(['root']);
    const pMutedBone = pose(doc, 'idle', 0, mutedBone);
    expect(pMutedBone.root[3]).toBeCloseTo(0, 4);
    expect(pMutedBone.root[7]).toBeCloseTo(5, 4);
    expect(pMutedBone.root[0]).toBeCloseTo(1, 4);
  });

  it('falls back to FK when IK target or chain is muted', () => {
    const doc = starterProject('mute_ik_test');
    doc.rig.bones.hip = { translation: [0, 0, 0] };
    doc.rig.bones.knee = { parent: 'hip', translation: [0, -4, 0] };
    doc.rig.bones.foot = { parent: 'knee', translation: [0, -4, 0] };
    doc.rig.ik_chains = {
      leg: { root: 'hip', mid: 'knee', end: 'foot' }
    };

    const clip = doc.animations.idle;
    clip.ik = {
      leg: {
        target: [{ frame: 0, value: [2, -6, 2], interpolation: 'linear' }],
        weight: [{ frame: 0, value: 1.0, interpolation: 'linear' }]
      }
    };

    const pSolved = pose(doc, 'idle', 0);
    // In solved pose, knee/foot are transformed towards target
    const solvedFootY = pSolved.foot[7];

    // Mute leg.target
    const pMutedTarget = pose(doc, 'idle', 0, new Set(['leg.target']));
    // FK rest foot Y is -8
    expect(pMutedTarget.foot[7]).toBeCloseTo(-8, 4);
    expect(pMutedTarget.foot[7]).not.toBeCloseTo(solvedFootY, 2);

    // Mute entire leg chain
    const pMutedChain = pose(doc, 'idle', 0, new Set(['leg']));
    expect(pMutedChain.foot[7]).toBeCloseTo(-8, 4);
  });
});
