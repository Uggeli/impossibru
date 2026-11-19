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
import type { ProjectDocument, Key } from './types';

describe('Challenger 2 Unit Suite: Keyframe Sorting, Track Pruning & Data Invariants', () => {
  it('strictly maintains ascending frame order and uniqueness during complex retimes and overwrites', () => {
    const doc = starterProject('retime_invariants');
    const clip = doc.animations.idle;
    clip.frames = 16;

    // Set 5 keyframes
    clip.bones = {
      root: {
        rotation: [
          { frame: 1, value: [10, 0, 0], interpolation: 'linear' },
          { frame: 4, value: [40, 0, 0], interpolation: 'linear' },
          { frame: 7, value: [70, 0, 0], interpolation: 'linear' },
          { frame: 10, value: [100, 0, 0], interpolation: 'linear' },
          { frame: 14, value: [140, 0, 0], interpolation: 'linear' },
        ]
      }
    };

    const track = clip.bones.root.rotation;

    // Helper to simulate retime logic identical to app.ts pointer release
    function retime(keys: Key<any>[], srcFrame: number, dstFrame: number) {
      const srcIdx = keys.findIndex(k => k.frame === srcFrame);
      if (srcIdx < 0) return;
      const keyToMove = keys[srcIdx];
      const dstIdx = keys.findIndex(k => k.frame === dstFrame);
      if (dstIdx >= 0) {
        keys.splice(dstIdx, 1);
      }
      keyToMove.frame = dstFrame;
      keys.sort((a, b) => a.frame - b.frame);
    }

    // 1. Move frame 14 to frame 0 (extreme boundary move backward)
    retime(track, 14, 0);
    expect(track.map(k => k.frame)).toEqual([0, 1, 4, 7, 10]);
    for (let i = 0; i < track.length - 1; i++) {
      expect(track[i].frame).toBeLessThan(track[i + 1].frame);
    }

    // 2. Move frame 0 to frame 15 (extreme boundary move forward)
    retime(track, 0, 15);
    expect(track.map(k => k.frame)).toEqual([1, 4, 7, 10, 15]);

    // 3. Move frame 1 onto frame 7 (collision overwrite in middle)
    retime(track, 1, 7);
    expect(track.map(k => k.frame)).toEqual([4, 7, 10, 15]);
    expect(track.find(k => k.frame === 7)?.value).toEqual([10, 0, 0]); // Replaced with moved key's value

    // 4. Move frame 15 onto frame 4 (collision overwrite across multiple existing keys)
    retime(track, 15, 4);
    expect(track.map(k => k.frame)).toEqual([4, 7, 10]);
    expect(track.find(k => k.frame === 4)?.value).toEqual([140, 0, 0]);

    // 5. Successive shifts
    retime(track, 10, 9);
    retime(track, 7, 8);
    retime(track, 4, 6);
    expect(track.map(k => k.frame)).toEqual([6, 8, 9]);

    // Validate project schema stays 100% valid throughout
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('validates multi-track simultaneous pruning across bones, ik, translations, rotations, targets, poles, weights', () => {
    const doc = starterProject('deep_prune_stress');
    doc.rig.bones.b1 = { parent: 'root', translation: [1, 0, 0] };
    doc.rig.bones.b2 = { parent: 'b1', translation: [1, 0, 0] };
    doc.rig.ik_chains = {
      arm: { root: 'root', mid: 'b1', end: 'b2' }
    };

    const clip = doc.animations.idle;
    clip.bones = {
      root: { translation: [], rotation: [{ frame: 0, value: [0, 0, 0], interpolation: 'linear' }] },
      b1: { translation: [], rotation: [] },
      b2: { translation: [{ frame: 0, value: [1, 1, 1], interpolation: 'step' }] }
    };
    clip.ik = {
      arm: { target: [], pole: [], weight: [] }
    };

    cleanAnimationTracks(doc);

    // root.translation pruned, root.rotation preserved
    expect(clip.bones.root.translation).toBeUndefined();
    expect(clip.bones.root.rotation).toBeDefined();

    // b1 empty bone object completely pruned
    expect(clip.bones.b1).toBeUndefined();

    // b2 translation preserved
    expect(clip.bones.b2.translation).toBeDefined();

    // arm ik container completely pruned
    expect(clip.ik.arm).toBeUndefined();

    expect(() => validateProject(doc)).not.toThrow();
  });
});

describe('Challenger 2 Unit Suite: Sampling & Looping Edge Cases', () => {
  it('correctly handles sampling with 1-keyframe track across all frames', () => {
    const doc = starterProject('single_key_sample');
    const clip = doc.animations.idle;
    clip.frames = 10;
    clip.bones = {
      root: {
        translation: [{ frame: 5, value: [12, 34, 56], interpolation: 'smooth' }]
      }
    };

    // For any frame 0..9, single keyframe must return its value without crash or NaN
    for (let f = 0; f < 10; f++) {
      const p = pose(doc, 'idle', f);
      expect(p.root[3]).toBeCloseTo(12, 4);
      expect(p.root[7]).toBeCloseTo(34, 4);
      expect(p.root[11]).toBeCloseTo(56, 4);
    }
  });

  it('correctly samples wrap-around with keyframes at extreme boundaries 0 and L-1', () => {
    const doc = starterProject('boundary_sample');
    const clip = doc.animations.idle;
    clip.frames = 10;
    clip.loop = true;

    clip.bones = {
      root: {
        translation: [
          { frame: 0, value: [0, 0, 0], interpolation: 'linear' },
          { frame: 9, value: [90, 0, 0], interpolation: 'linear' }
        ]
      }
    };

    // Frame 0 = 0
    expect(pose(doc, 'idle', 0).root[3]).toBeCloseTo(0, 4);

    // Frame 9 = 90
    expect(pose(doc, 'idle', 9).root[3]).toBeCloseTo(90, 4);

    // Mid frames 1..8 linear from 0 to 90
    expect(pose(doc, 'idle', 1).root[3]).toBeCloseTo(10, 4);
    expect(pose(doc, 'idle', 5).root[3]).toBeCloseTo(50, 4);
    expect(pose(doc, 'idle', 8).root[3]).toBeCloseTo(80, 4);
  });

  it('handles non-looping track with frame queries outside keyframe range without NaN', () => {
    const doc = starterProject('non_looping_clamping');
    const clip = doc.animations.idle;
    clip.frames = 20;
    clip.loop = false;

    clip.bones = {
      root: {
        translation: [
          { frame: 6, value: [100, 200, 300], interpolation: 'linear' },
          { frame: 12, value: [400, 500, 600], interpolation: 'linear' }
        ]
      }
    };

    // Frame 0..5 clamp to frame 6
    for (let f = 0; f <= 6; f++) {
      const p = pose(doc, 'idle', f);
      expect(p.root[3]).toBeCloseTo(100, 4);
      expect(p.root[7]).toBeCloseTo(200, 4);
      expect(p.root[11]).toBeCloseTo(300, 4);
    }

    // Frame 12..19 clamp to frame 12
    for (let f = 12; f < 20; f++) {
      const p = pose(doc, 'idle', f);
      expect(p.root[3]).toBeCloseTo(400, 4);
      expect(p.root[7]).toBeCloseTo(500, 4);
      expect(p.root[11]).toBeCloseTo(600, 4);
    }

    // Midpoint frame 9: [250, 350, 450]
    const p9 = pose(doc, 'idle', 9);
    expect(p9.root[3]).toBeCloseTo(250, 4);
    expect(p9.root[7]).toBeCloseTo(350, 4);
    expect(p9.root[11]).toBeCloseTo(450, 4);
  });
});
