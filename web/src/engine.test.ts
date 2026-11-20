import { describe, expect, it } from 'vitest';
import { metadata, pose, render, validateProject } from './engine';
import { starterProject } from './runtime';
import type { ProjectDocument } from './types';
import yaml from 'js-yaml';
import qio from '../../examples/qio.yaml?raw';


describe('Browser Project Contract & Backwards Compatibility', () => {
  it('validates the starter and keeps omitted animations backward compatible', () => {
    const d = starterProject('hero');
    delete d.export!.animations;
    expect(validateProject(d)).toBe(d);
    expect(Object.keys(metadata(d).animations)).toEqual(['idle']);
  });

  it('reports front/back silhouette mismatches', () => {
    const d = starterProject();
    d.parts.part.back = '....\n....\n....\n.xx.';
    expect(() => validateProject(d)).toThrow(/silhouettes differ/);
  });
});

describe('Animation Track Sampling & Interpolation Modes (pose)', () => {
  function createAnimDoc(): ProjectDocument {
    const doc = starterProject('anim_doc');
    doc.rig.bones = {
      root: { translation: [0, 0, 0], rotation: [0, 0, 0] },
      arm: { parent: 'root', translation: [0, 5, 0], rotation: [0, 0, 0] },
    };
    return doc;
  }

  it('samples exact keyframe matches', () => {
    const doc = createAnimDoc();
    doc.animations.test_clip = {
      frames: 10,
      fps: 10,
      loop: true,
      bones: {
        root: {
          translation: [
            { frame: 0, value: [0, 0, 0] },
            { frame: 5, value: [10, 20, 30] },
          ],
        },
      },
    };

    const p0 = pose(doc, 'test_clip', 0);
    expect(p0.root[3]).toBeCloseTo(0);
    expect(p0.root[7]).toBeCloseTo(0);
    expect(p0.root[11]).toBeCloseTo(0);

    const p5 = pose(doc, 'test_clip', 5);
    expect(p5.root[3]).toBeCloseTo(10);
    expect(p5.root[7]).toBeCloseTo(20);
    expect(p5.root[11]).toBeCloseTo(30);
  });

  it('interpolates linearly between keyframes (linear interpolation)', () => {
    const doc = createAnimDoc();
    doc.animations.test_clip = {
      frames: 10,
      fps: 10,
      loop: false,
      bones: {
        root: {
          translation: [
            { frame: 0, value: [0, 0, 0], interpolation: 'linear' },
            { frame: 4, value: [20, 40, 60] },
          ],
        },
      },
    };

    // Frame 2 is halfway (t = 0.5)
    const p2 = pose(doc, 'test_clip', 2);
    expect(p2.root[3]).toBeCloseTo(10, 3);
    expect(p2.root[7]).toBeCloseTo(20, 3);
    expect(p2.root[11]).toBeCloseTo(30, 3);

    // Frame 1 is 1/4 (t = 0.25)
    const p1 = pose(doc, 'test_clip', 1);
    expect(p1.root[3]).toBeCloseTo(5, 3);
    expect(p1.root[7]).toBeCloseTo(10, 3);
    expect(p1.root[11]).toBeCloseTo(15, 3);
  });

  it('holds preceding keyframe value when interpolation is step', () => {
    const doc = createAnimDoc();
    doc.animations.test_clip = {
      frames: 10,
      fps: 10,
      loop: false,
      bones: {
        root: {
          translation: [
            { frame: 0, value: [10, 10, 10], interpolation: 'step' },
            { frame: 6, value: [50, 50, 50] },
          ],
        },
      },
    };

    // Before frame 6, value should stay at [10, 10, 10]
    for (let f = 0; f < 6; f++) {
      const p = pose(doc, 'test_clip', f);
      expect(p.root[3]).toBeCloseTo(10);
      expect(p.root[7]).toBeCloseTo(10);
      expect(p.root[11]).toBeCloseTo(10);
    }

    // At frame 6, jumps to [50, 50, 50]
    const p6 = pose(doc, 'test_clip', 6);
    expect(p6.root[3]).toBeCloseTo(50);
  });

  it('interpolates with cubic smoothstep curve when interpolation is smooth', () => {
    const doc = createAnimDoc();
    doc.animations.test_clip = {
      frames: 10,
      fps: 10,
      loop: false,
      bones: {
        root: {
          translation: [
            { frame: 0, value: [0, 0, 0], interpolation: 'smooth' },
            { frame: 4, value: [100, 0, 0] },
          ],
        },
      },
    };

    // At halfway (t = 0.5), smoothstep t^2*(3 - 2t) = 0.25 * 2 = 0.5, so value = 50
    const p2 = pose(doc, 'test_clip', 2);
    expect(p2.root[3]).toBeCloseTo(50, 3);

    // At 1/4 (t = 0.25), linear would be 25, but smoothstep is (0.25)^2*(3 - 0.5) = 0.0625 * 2.5 = 0.15625 -> 15.625
    const p1 = pose(doc, 'test_clip', 1);
    expect(p1.root[3]).toBeCloseTo(15.625, 3);
  });

  it('interpolates across loop boundary when loop is true', () => {
    const doc = createAnimDoc();
    doc.animations.test_clip = {
      frames: 8,
      fps: 10,
      loop: true,
      bones: {
        root: {
          translation: [
            { frame: 2, value: [10, 0, 0], interpolation: 'linear' },
            { frame: 6, value: [50, 0, 0], interpolation: 'linear' },
          ],
        },
      },
    };

    // Frame 0 is between frame 6 and wrapped frame 2 (frame 2 + 8 = frame 10).
    // Segment from frame 6 to frame 10 (length 4). Frame 0 is position 8.
    // t = (8 - 6) / (10 - 6) = 2 / 4 = 0.5.
    // Value = 50 * 0.5 + 10 * 0.5 = 30.
    const p0 = pose(doc, 'test_clip', 0);
    expect(p0.root[3]).toBeCloseTo(30, 3);
  });

  it('clamps to boundary keyframes when loop is false', () => {
    const doc = createAnimDoc();
    doc.animations.test_clip = {
      frames: 10,
      fps: 10,
      loop: false,
      bones: {
        root: {
          translation: [
            { frame: 2, value: [10, 0, 0] },
            { frame: 6, value: [50, 0, 0] },
          ],
        },
      },
    };

    // Before first keyframe (frame 0) -> holds frame 2 value (10)
    const p0 = pose(doc, 'test_clip', 0);
    expect(p0.root[3]).toBeCloseTo(10);

    // After last keyframe (frame 8) -> holds frame 6 value (50)
    const p8 = pose(doc, 'test_clip', 8);
    expect(p8.root[3]).toBeCloseTo(50);
  });
});

describe('Metadata & Atlas Generation (metadata)', () => {
  it('generates multi-direction atlas dimensions and frame coordinates', () => {
    const doc = starterProject('atlas_test');
    doc.animations = {
      walk: { frames: 4, fps: 8, loop: true },
      jump: { frames: 6, fps: 12, loop: false },
    };
    doc.export = {
      name: 'hero_atlas',
      size: [64, 64],
      origin: [32, 56],
      directions: [0, 90, 180, 270],
      animations: ['walk', 'jump'],
    };

    const meta = metadata(doc);
    expect(meta.image).toBe('hero_atlas.png');
    expect(meta.frame_size).toEqual({ w: 64, h: 64 });
    expect(meta.coordinate_system.atlas_origin).toBe('top-left');

    // Max frames across animations is 6, so cols = 6. Width = 6 * 64 = 384
    expect(meta.size.w).toBe(6 * 64);
    // 2 animations * 4 directions = 8 rows. Height = 8 * 64 = 512
    expect(meta.size.h).toBe(8 * 64);

    // Verify walk animation structure
    const walk = meta.animations.walk;
    expect(walk.fps).toBe(8);
    expect(walk.frame_duration_ms).toBeCloseTo(125);
    expect(walk.loop).toBe(true);
    expect(walk.directions.length).toBe(4);
    expect(walk.directions[0].angle).toBe(0);
    expect(walk.directions[0].frames.length).toBe(4);
    expect(walk.directions[0].frames[0].rect).toEqual({ x: 0, y: 0, w: 64, h: 64 });
    expect(walk.directions[0].frames[0].pivot).toEqual({ x: 32, y: 56 });
  });
});

describe('Two-Bone IK Solver & Translational Invariance (solveTwoBone)', () => {
  it('guarantees translational invariance when root, target, and pole are shifted by constant vector', () => {
    const root0: [number, number, number] = [0, 0, 0];
    const target0: [number, number, number] = [0, -10, 0];
    const pole0: [number, number, number] = [0, -5, 5];
    const l1 = 6;
    const l2 = 6;

    const [j0, e0] = solveTwoBone(root0, target0, l1, l2, pole0);

    const offset: [number, number, number] = [100, 50, 20];
    const root1: [number, number, number] = [root0[0] + offset[0], root0[1] + offset[1], root0[2] + offset[2]];
    const target1: [number, number, number] = [target0[0] + offset[0], target0[1] + offset[1], target0[2] + offset[2]];
    const pole1: [number, number, number] = [pole0[0] + offset[0], pole0[1] + offset[1], pole0[2] + offset[2]];

    const [j1, e1] = solveTwoBone(root1, target1, l1, l2, pole1);

    expect(j1[0]).toBeCloseTo(j0[0] + offset[0], 4);
    expect(j1[1]).toBeCloseTo(j0[1] + offset[1], 4);
    expect(j1[2]).toBeCloseTo(j0[2] + offset[2], 4);

    expect(e1[0]).toBeCloseTo(e0[0] + offset[0], 4);
    expect(e1[1]).toBeCloseTo(e0[1] + offset[1], 4);
    expect(e1[2]).toBeCloseTo(e0[2] + offset[2], 4);
  });

  it('handles collinear pole vector with 3D cross product fallback without NaN', () => {
    const root: [number, number, number] = [0, 0, 0];
    const target: [number, number, number] = [0, 0, 5]; // Along +Z
    const pole: [number, number, number] = [0, 0, 2]; // Collinear along +Z

    const [joint, end] = solveTwoBone(root, target, 3, 3, pole);

    expect(Number.isFinite(joint[0])).toBe(true);
    expect(Number.isFinite(joint[1])).toBe(true);
    expect(Number.isFinite(joint[2])).toBe(true);
    expect(Number.isFinite(end[0])).toBe(true);
    expect(Number.isFinite(end[1])).toBe(true);
    expect(Number.isFinite(end[2])).toBe(true);

    const len1 = Math.hypot(joint[0] - root[0], joint[1] - root[1], joint[2] - root[2]);
    expect(len1).toBeCloseTo(3, 4);
  });

  it('handles zero-length bone without zero-division or NaN', () => {
    const root: [number, number, number] = [1, 2, 3];
    const target: [number, number, number] = [1, 2, 7];
    const pole: [number, number, number] = [1, 5, 3];

    const [joint, end] = solveTwoBone(root, target, 0, 4, pole);

    expect(Number.isFinite(joint[0])).toBe(true);
    expect(Number.isFinite(joint[1])).toBe(true);
    expect(Number.isFinite(joint[2])).toBe(true);
    expect(joint[0]).toBeCloseTo(root[0], 4);
    expect(joint[1]).toBeCloseTo(root[1], 4);
    expect(joint[2]).toBeCloseTo(root[2], 4);
  });
});

describe('Full 2-Bone IK Pose Solving (pose & overlay)', () => {
  function createIKDoc(): ProjectDocument {
    const doc = starterProject('ik_rig_doc');
    doc.rig.bones = {
      root: { part: 'part', translation: [0, 0, 0], rotation: [0, 0, 0] },
      thigh: { parent: 'root', translation: [0, 0, 0], rotation: [0, 0, 0] },
      shin: { parent: 'thigh', translation: [0, -5, 0], rotation: [0, 0, 0] },
      foot: { parent: 'shin', translation: [0, -5, 0], rotation: [0, 0, 0] },
    };
    doc.rig.ik_chains = {
      leg: { root: 'thigh', mid: 'shin', end: 'foot' },
    };
    return doc;
  }

  it('solves 2-bone IK chain and moves end effector to target in pose()', () => {
    const doc = createIKDoc();
    const targetPos: [number, number, number] = [0, -8, 2];

    doc.animations.walk = {
      frames: 4,
      fps: 10,
      loop: false,
      bones: {},
      ik: {
        leg: {
          target: [{ frame: 0, value: targetPos }],
          pole: [{ frame: 0, value: [0, -4, 5] }],
          weight: [{ frame: 0, value: 1.0 }],
        },
      },
    };

    const evaluated = pose(doc, 'walk', 0);
    const footWorld = [evaluated.foot[3], evaluated.foot[7], evaluated.foot[11]];

    expect(footWorld[0]).toBeCloseTo(targetPos[0], 2);
    expect(footWorld[1]).toBeCloseTo(targetPos[1], 2);
    expect(footWorld[2]).toBeCloseTo(targetPos[2], 2);
  });

  it('blends IK with FK via weight parameter in pose()', () => {
    const doc = createIKDoc();
    const targetPos: [number, number, number] = [0, -8, 2];

    // FK pose (weight = 0)
    doc.animations.fk = {
      frames: 1,
      fps: 10,
      loop: false,
      bones: {},
      ik: {
        leg: {
          target: [{ frame: 0, value: targetPos }],
          weight: [{ frame: 0, value: 0.0 }],
        },
      },
    };
    const fkPose = pose(doc, 'fk', 0);
    const fkFootY = fkPose.foot[7]; // Initially at 0 - 5 - 5 = -10

    // Partial IK (weight = 0.5)
    doc.animations.half = {
      frames: 1,
      fps: 10,
      loop: false,
      bones: {},
      ik: {
        leg: {
          target: [{ frame: 0, value: targetPos }],
          weight: [{ frame: 0, value: 0.5 }],
        },
      },
    };
    const halfPose = pose(doc, 'half', 0);
    const halfFootY = halfPose.foot[7];

    // Full IK (weight = 1.0)
    doc.animations.full = {
      frames: 1,
      fps: 10,
      loop: false,
      bones: {},
      ik: {
        leg: {
          target: [{ frame: 0, value: targetPos }],
          weight: [{ frame: 0, value: 1.0 }],
        },
      },
    };
    const fullPose = pose(doc, 'full', 0);
    const fullFootY = fullPose.foot[7];

    expect(fkFootY).toBeCloseTo(-10, 2);
    expect(fullFootY).toBeCloseTo(-8, 2);
    expect(halfFootY).toBeGreaterThan(fkFootY);
    expect(halfFootY).toBeLessThan(fullFootY);
  });

  it('populates overlay with projected bones and active IK chain handles', () => {
    const doc = createIKDoc();
    doc.animations.walk = {
      frames: 4,
      fps: 10,
      loop: false,
      bones: {},
      ik: {
        leg: {
          target: [{ frame: 0, value: [0, -8, 2] }],
          pole: [{ frame: 0, value: [0, -4, 5] }],
        },
      },
    };

    const g = overlay(doc, 'walk', 0, 0);
    expect(g.width).toBe(96);
    expect(g.height).toBe(96);
    expect(g.bones.length).toBe(4);

    expect(g.chains.length).toBe(1);
    const legChain = g.chains[0];
    expect(legChain.name).toBe('leg');
    expect(legChain.root).toBe('thigh');
    expect(legChain.mid).toBe('shin');
    expect(legChain.end).toBe('foot');
    expect(legChain.color).toBeDefined();

    expect(legChain.target).toBeDefined();
    expect(legChain.target.x).toBeCloseTo(48, 1);
    expect(legChain.target.y).toBeCloseTo(88 - (-8 * 3), 1); // 88 + 24 = 112

    expect(legChain.pole).toBeDefined();
    expect(legChain.pole.depth).toBeCloseTo(5, 1);
  });
});

import { autoRig, browserRequest } from './runtime';
import { solveTwoBone, overlay } from './engine';
import { setupTestEnvironment } from './test-helpers';

describe('Runtime Rest-Mode Joint Drag & Autorig Integration', () => {
  it('computes parent inverse transform when dragging child bone in rest mode', async () => {
    setupTestEnvironment();

    const doc = starterProject('drag_test');
    doc.rig.bones = {
      root: { part: 'part', translation: [10, 20, 0], rotation: [0, 0, 0] },
      arm: { parent: 'root', translation: [0, 0, 0], rotation: [0, 0, 0] },
    };

    // Drag child 'arm' in rest mode to world position [15, 25, 0]
    // Since origin is [48, 88], scale is 3, direction is 0:
    // screen x = 48 + 15*3 = 93, screen y = 88 - 25*3 = 13
    const res = await browserRequest('/api/rig/drag', {
      body: JSON.stringify({
        document: doc,
        kind: 'joint',
        name: 'arm',
        mode: 'rest',
        screen: [48 + 15 * 3, 88 - 25 * 3],
        depth: 0,
        direction: 0,
      }),
    });

    const payload = await res.json();
    expect(payload.document).toBeDefined();
    const armTrans = payload.document.rig.bones.arm.translation;

    // Expected local translation = world [15, 25, 0] - parent [10, 20, 0] = [5, 5, 0]
    expect(armTrans[0]).toBeCloseTo(5, 2);
    expect(armTrans[1]).toBeCloseTo(5, 2);
    expect(armTrans[2]).toBeCloseTo(0, 2);
  });

  it('runs autorig with humanoid and quadruped presets via autoRig client method', async () => {
    setupTestEnvironment();

    const doc = starterProject('autorig_test');
    doc.parts = {
      torso: { pivot: [1.5, 0, 1.5], front: '....\n.xx.\n.xx.', back: '....\n.xx.\n.xx.', side: '....\n.xx.\n.xx.' },
      head: { pivot: [1.5, 0, 1.5], front: '....\n.xx.\n.xx.', back: '....\n.xx.\n.xx.', side: '....\n.xx.\n.xx.' },
      left_arm: { pivot: [1.5, 0, 1.5], front: '....\n.xx.\n.xx.', back: '....\n.xx.\n.xx.', side: '....\n.xx.\n.xx.' },
      right_arm: { pivot: [1.5, 0, 1.5], front: '....\n.xx.\n.xx.', back: '....\n.xx.\n.xx.', side: '....\n.xx.\n.xx.' },
      left_leg: { pivot: [1.5, 0, 1.5], front: '....\n.xx.\n.xx.', back: '....\n.xx.\n.xx.', side: '....\n.xx.\n.xx.' },
      right_leg: { pivot: [1.5, 0, 1.5], front: '....\n.xx.\n.xx.', back: '....\n.xx.\n.xx.', side: '....\n.xx.\n.xx.' },
    };

    const humanoid = await autoRig(doc, 'humanoid');
    expect(humanoid.rig.bones.root).toBeDefined();
    expect(humanoid.rig.bones.torso).toBeDefined();
    expect(humanoid.rig.bones.left_upper_leg).toBeDefined();
    expect(humanoid.rig.ik_chains.left_leg).toBeDefined();

    const quadruped = await autoRig(doc, 'quadruped');
    expect(quadruped.rig.bones.front_left_upper_leg).toBeDefined();
    expect(quadruped.rig.ik_chains.front_left_leg).toBeDefined();
  });

  it('rejects invalid autorig preset with ProjectError', async () => {
    setupTestEnvironment();
    const doc = starterProject('autorig_err');
    await expect(autoRig(doc, 'invalid_alien_preset')).rejects.toThrow(/unknown autorig preset/);
  });
});


describe('Voxel-grid parts (qio example)', () => {
  it('validates the qio example', () => {
    expect(() => validateProject(yaml.load(qio) as ProjectDocument)).not.toThrow();
  });

  it('renders qio with non-transparent pixels', () => {
    setupTestEnvironment();
    const doc = validateProject(yaml.load(qio) as ProjectDocument);
    // The test canvas is a mock without pixel data: record the filled squares instead.
    let opaque = 0;
    const ctx: any = {
      clearRect() {},
      fillStyle: '',
      fillRect() {
        const alpha = /rgba\(\d+,\d+,\d+,([\d.]+)\)/.exec(ctx.fillStyle);
        if (alpha && Number(alpha[1]) > 0) opaque++;
      },
    };
    const doc2: any = document;
    const create = doc2.createElement;
    doc2.createElement = (tag: string) =>
      tag === 'canvas' ? { width: 0, height: 0, getContext: () => ctx } : create(tag);
    try {
      render(doc, 'idle', 0, 0);
    } finally {
      doc2.createElement = create;
    }
    expect(opaque).toBeGreaterThan(0);
  });
});
