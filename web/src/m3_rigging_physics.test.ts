import { describe, expect, it } from 'vitest';
import {
  metadata,
  ProjectError,
  reparent,
  validateProject
} from './engine';
import {
  autoRig,
  autorigProjectFallback,
  browserRequest,
  starterProject
} from './runtime';
import { setupTestEnvironment } from './test-helpers';
import type { ProjectDocument } from './types';

describe('Milestone 3: Autorig Pipeline & Presets', () => {
  it('autorigs humanoid character with body hierarchy and IK chains', () => {
    const doc = starterProject('hero');
    doc.palette = { 'x': '#3a7d44', '#': '#ffffff' };
    doc.parts = {
      torso: {
        dimensions: [4, 6, 4],
        front: '####\n####\n####\n####\n####\n####',
        side: '####\n####\n####\n####\n####\n####',
        back: '####\n####\n####\n####\n####\n####',
        offset: [0, 6, 0]
      },
      head: {
        dimensions: [4, 4, 4],
        front: '####\n####\n####\n####',
        side: '####\n####\n####\n####',
        back: '####\n####\n####\n####',
        offset: [0, 12, 0]
      },
      left_leg: {
        dimensions: [2, 6, 2],
        front: '##\n##\n##\n##\n##\n##',
        side: '##\n##\n##\n##\n##\n##',
        back: '##\n##\n##\n##\n##\n##',
        offset: [-2, 0, 0]
      },
      right_leg: {
        dimensions: [2, 6, 2],
        front: '##\n##\n##\n##\n##\n##',
        side: '##\n##\n##\n##\n##\n##',
        back: '##\n##\n##\n##\n##\n##',
        offset: [2, 0, 0]
      }
    };

    const rigged = autorigProjectFallback(doc, 'humanoid');
    expect(rigged.rig).toBeDefined();
    expect(rigged.rig.bones).toBeDefined();
    expect(Object.keys(rigged.rig.bones).length).toBeGreaterThanOrEqual(4);
    expect(validateProject(rigged)).toBe(rigged);
  });

  it('autorigs quadruped character with 4 legs and chains', () => {
    const doc = starterProject('quad');
    doc.palette = { 'x': '#3a7d44', '#': '#ffffff' };
    doc.parts = {
      body: {
        dimensions: [4, 4, 8],
        front: '####\n####\n####\n####',
        side: '########\n########\n########\n########',
        back: '####\n####\n####\n####',
        offset: [0, 4, 0]
      }
    };

    const rigged = autorigProjectFallback(doc, 'quadruped');
    expect(rigged.rig.bones).toBeDefined();
    expect(validateProject(rigged)).toBe(rigged);
  });

  it('autorigs creature character with creature preset', () => {
    const doc = starterProject('creature');
    const rigged = autorigProjectFallback(doc, 'creature');
    expect(rigged.rig.bones).toBeDefined();
    expect(validateProject(rigged)).toBe(rigged);
  });

  it('autoRig runtime client function works with browserRequest offline fallback', async () => {
    setupTestEnvironment();
    const doc = starterProject('offline_hero');
    const result = await autoRig(doc, 'humanoid', browserRequest);
    expect(result).toBeDefined();
    expect(result.rig?.bones).toBeDefined();
  });
});

describe('Milestone 3: Spring Physics Schema & Validation', () => {
  it('validates rig-level spring_bones configuration', () => {
    const doc = starterProject('spring_hero');
    doc.rig.spring_bones = {
      root: {
        stiffness: 120.0,
        damping: 15.0,
        mass: 1.5,
        drag: 0.2,
        gravity: [0.0, -9.81, 0.0],
        limit_angle: 45.0
      }
    };
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('validates bone-level spring configuration', () => {
    const doc = starterProject('bone_spring');
    doc.rig.bones.root.spring = {
      stiffness: 80.0,
      damping: 8.0,
      mass: 0.5,
      drag: 0.05,
      gravity: [0.0, -9.81, 0.0],
      limit_angle: 30.0
    };
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('rejects spring configuration with negative mass or parameters', () => {
    const doc = starterProject('bad_spring');
    doc.rig.spring_bones = {
      root: {
        stiffness: -10,
        damping: 10,
        mass: 1,
        drag: 0.1
      }
    };
    expect(() => validateProject(doc)).toThrow(/must be non-negative/);

    (doc.rig.spring_bones as any).root.stiffness = 100;
    (doc.rig.spring_bones as any).root.mass = 0; // mass must be > 0
    expect(() => validateProject(doc)).toThrow(/must be non-negative \(mass > 0\)/);
  });

  it('rejects spring configuration with negative limit_angle', () => {
    const doc = starterProject('bad_angle');
    doc.rig.spring_bones = {
      root: {
        stiffness: 100,
        damping: 10,
        mass: 1,
        drag: 0.1,
        limit_angle: -5
      }
    };
    expect(() => validateProject(doc)).toThrow(/limit_angle must be a non-negative number/);
  });

  it('rejects spring_bones referencing nonexistent bones', () => {
    const doc = starterProject('missing_bone_spring');
    doc.rig.spring_bones = {
      nonexistent_bone: {
        stiffness: 100,
        damping: 10,
        mass: 1,
        drag: 0.1
      }
    };
    expect(() => validateProject(doc)).toThrow(/references missing bone 'nonexistent_bone'/);
  });
});

describe('Milestone 3: Rig Constraints & Angle Limits Schema', () => {
  it('validates copy_rotation constraint', () => {
    const doc = starterProject('copy_rot');
    doc.rig.bones.child = { translation: [0, 2, 0], parent: 'root' };
    doc.rig.constraints = [
      {
        type: 'copy_rotation',
        name: 'copy_rot_1',
        source: 'root',
        target: 'child',
        influence: 0.8,
        axes: [true, true, false],
        invert: [false, false, false]
      }
    ];
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('validates mirror constraint', () => {
    const doc = starterProject('mirror_test');
    doc.rig.bones.left_arm = { translation: [-2, 2, 0], parent: 'root' };
    doc.rig.bones.right_arm = { translation: [2, 2, 0], parent: 'root' };
    doc.rig.constraints = [
      {
        type: 'mirror',
        name: 'mirror_arms',
        source: 'left_arm',
        target: 'right_arm',
        plane: 'yz',
        influence: 1.0
      }
    ];
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('validates spline_spine constraint', () => {
    const doc = starterProject('spline_test');
    doc.rig.bones.b1 = { translation: [0, 1, 0], parent: 'root' };
    doc.rig.bones.b2 = { translation: [0, 2, 0], parent: 'b1' };
    doc.rig.bones.b3 = { translation: [0, 3, 0], parent: 'b2' };
    doc.rig.constraints = [
      {
        type: 'spline_spine',
        name: 'spine_curve',
        bones: ['root', 'b1', 'b2', 'b3'],
        driver: 'b3',
        total_rotation: [0, 30, 0]
      }
    ];
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('rejects constraints referencing missing bones or invalid mirror planes', () => {
    const doc = starterProject('bad_constr');
    doc.rig.constraints = [
      {
        type: 'copy_rotation',
        source: 'root',
        target: 'missing_bone'
      }
    ];
    expect(() => validateProject(doc)).toThrow(/references missing source or target bone/);

    doc.rig.bones.child = { translation: [0, 1, 0], parent: 'root' };
    doc.rig.constraints = [
      {
        type: 'mirror',
        source: 'root',
        target: 'child',
        plane: 'invalid_plane'
      }
    ];
    expect(() => validateProject(doc)).toThrow(/invalid plane/);
  });

  it('validates bone joint limits', () => {
    const doc = starterProject('limits_test');
    doc.rig.bones.root.limits = {
      pitch: [-45, 45],
      yaw: [-60, 60],
      roll: [-30, 30]
    };
    expect(() => validateProject(doc)).not.toThrow();
  });
});

describe('Milestone 3: Procedural Animation Schema & Validation', () => {
  it('validates animation clips with complete procedural blocks (gait, breathing, lean, look_at)', () => {
    const doc = starterProject('proc_anim');
    doc.animations.walk_proc = {
      frames: 12,
      fps: 12,
      loop: true,
      procedural: {
        gait: {
          speed: 1.2,
          stride_length: 4.5,
          stride_height: 2.0,
          hip_bounce: 0.6,
          arm_swing: 30.0,
          root_bone: 'root'
        },
        breathing: {
          rate: 0.3,
          intensity: 1.0,
          chest_bone: 'root'
        },
        lean: {
          pitch_factor: 6.0,
          roll_factor: 4.0,
          banking_factor: 8.0,
          turn_rate: 0.1,
          velocity: [0, 0, 1.5],
          acceleration: [0, 0, 0.5]
        },
        look_at: {
          target: [5, 10, 15],
          head_bone: 'root',
          max_angle: 60.0
        }
      }
    };
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('rejects invalid non-mapping procedural blocks', () => {
    const doc = starterProject('bad_proc');
    doc.animations.idle.procedural = 'not_a_mapping' as any;
    expect(() => validateProject(doc)).toThrow(/procedural must be a mapping/);
  });
});

describe('Milestone 3: Hierarchy Operations & Reparenting Stability', () => {
  it('reparents child bone while preserving world transform accurately', () => {
    const doc = starterProject('reparent_test');
    doc.rig.bones.torso = { translation: [0, 4, 0], parent: 'root' };
    doc.rig.bones.arm = { translation: [2, 1, 0], parent: 'root' };

    // Reparent arm under torso
    const reparented = reparent(doc, 'arm', 'torso');
    expect(reparented.rig.bones.arm.parent).toBe('torso');
    // In local space of torso (which was at [0, 4, 0]), arm (which was at [2, 1, 0] under root) should be [2, -3, 0]
    expect(reparented.rig.bones.arm.translation[0]).toBeCloseTo(2, 4);
    expect(reparented.rig.bones.arm.translation[1]).toBeCloseTo(-3, 4);
    expect(reparented.rig.bones.arm.translation[2]).toBeCloseTo(0, 4);
  });

  it('prevents parenting cycles during reparenting', () => {
    const doc = starterProject('cycle_test');
    doc.rig.bones.a = { translation: [0, 1, 0], parent: 'root' };
    doc.rig.bones.b = { translation: [0, 1, 0], parent: 'a' };
    doc.rig.bones.c = { translation: [0, 1, 0], parent: 'b' };

    // Attempting to make a a child of c creates a cycle: a -> b -> c -> a
    expect(() => reparent(doc, 'a', 'c')).toThrow(/parent cycle/);
    // Self parenting
    expect(() => reparent(doc, 'a', 'a')).toThrow(/parent cycle/);
  });
});
