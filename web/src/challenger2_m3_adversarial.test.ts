import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import {
  ProjectError,
  solveTwoBone,
  validateProject,
} from './engine';
import { starterProject } from './runtime';
import type { ProjectDocument } from './types';

describe('Challenger 2 Adversarial Stress Suite: Spring Bones & Physics Parameters', () => {
  it('accepts extreme boundary values for valid spring physics', () => {
    const doc = starterProject('spring_extremes');
    doc.rig.spring_bones = {
      root: {
        stiffness: 10000.0,
        damping: 1000.0,
        mass: 0.001,
        drag: 50.0,
        gravity: [100000.0, -100000.0, 50000.0],
        limit_angle: 180.0,
      },
    };
    expect(() => validateProject(doc)).not.toThrow();

    // limit_angle = 0.0 (strictly locked)
    (doc.rig.spring_bones as any).root.limit_angle = 0.0;
    expect(() => validateProject(doc)).not.toThrow();

    // limit_angle = null (unlimited)
    (doc.rig.spring_bones as any).root.limit_angle = null as any;
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('rejects invalid or unphysical spring parameters across all boundary conditions', () => {
    const doc = starterProject('invalid_spring');

    // Zero mass (must be strictly > 0)
    doc.rig.spring_bones = { root: { mass: 0 } as any };
    expect(() => validateProject(doc)).toThrow(/must be non-negative \(mass > 0\)/);

    // Negative mass
    doc.rig.spring_bones = { root: { mass: -0.5 } as any };
    expect(() => validateProject(doc)).toThrow(/must be non-negative \(mass > 0\)/);

    // Negative stiffness
    doc.rig.spring_bones = { root: { stiffness: -10 } as any };
    expect(() => validateProject(doc)).toThrow(/must be non-negative/);

    // Negative damping
    doc.rig.spring_bones = { root: { damping: -1 } as any };
    expect(() => validateProject(doc)).toThrow(/must be non-negative/);

    // Negative drag
    doc.rig.spring_bones = { root: { drag: -0.1 } as any };
    expect(() => validateProject(doc)).toThrow(/must be non-negative/);

    // Negative limit_angle
    doc.rig.spring_bones = { root: { limit_angle: -0.001 } as any };
    expect(() => validateProject(doc)).toThrow(/limit_angle must be a non-negative number/);

    // NaN values
    doc.rig.spring_bones = { root: { stiffness: NaN } as any };
    expect(() => validateProject(doc)).toThrow(/must be non-negative/);

    // Non-3D gravity vector
    doc.rig.spring_bones = { root: { gravity: [0, 1] } as any };
    expect(() => validateProject(doc)).toThrow(/must be a 3-number list/);
  });
});

describe('Challenger 2 Adversarial Stress Suite: Constraints & Angle Limits', () => {
  it('validates copy_rotation with full permutations of inverted axes and fractional influence', () => {
    const doc = starterProject('copy_rot_stress');
    doc.rig.bones.b1 = { parent: 'root', translation: [0, 1, 0] };
    doc.rig.bones.b2 = { parent: 'b1', translation: [0, 1, 0] };

    doc.rig.constraints = [
      {
        type: 'copy_rotation',
        name: 'cr_all_true_inverted',
        source: 'root',
        target: 'b1',
        influence: 0.333,
        axes: [true, true, true],
        invert: [true, true, true],
      },
      {
        type: 'copy_rotation',
        name: 'cr_single_axis',
        source: 'b1',
        target: 'b2',
        influence: 0.85,
        axes: [false, true, false],
        invert: [false, false, false],
      },
    ];
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('validates mirror constraint across all 6 plane definitions (yz, xz, xy, x, y, z)', () => {
    const doc = starterProject('mirror_stress');
    doc.rig.bones.left = { parent: 'root', translation: [2, 0, 0] };
    doc.rig.bones.right = { parent: 'root', translation: [-2, 0, 0] };

    const validPlanes = ['yz', 'xz', 'xy', 'x', 'y', 'z', 'YZ', 'XZ', 'XY'];
    for (const plane of validPlanes) {
      doc.rig.constraints = [
        {
          type: 'mirror',
          name: `mirror_${plane}`,
          source: 'left',
          target: 'right',
          plane,
          influence: 1.0,
        },
      ];
      expect(() => validateProject(doc)).not.toThrow();
    }

    // Invalid plane definition
    doc.rig.constraints = [
      {
        type: 'mirror',
        source: 'left',
        target: 'right',
        plane: 'invalid_axis_plane',
      },
    ];
    expect(() => validateProject(doc)).toThrow(/invalid plane/);
  });

  it('validates spline_spine with multi-bone chain, optional driver, and total_rotation', () => {
    const doc = starterProject('spline_stress');
    doc.rig.bones.v1 = { parent: 'root', translation: [0, 1, 0] };
    doc.rig.bones.v2 = { parent: 'v1', translation: [0, 1, 0] };
    doc.rig.bones.v3 = { parent: 'v2', translation: [0, 1, 0] };
    doc.rig.bones.v4 = { parent: 'v3', translation: [0, 1, 0] };
    doc.rig.bones.driver_bone = { parent: 'root', translation: [0, 5, 0] };

    doc.rig.constraints = [
      {
        type: 'spline_spine',
        name: 'spine_chain',
        bones: ['root', 'v1', 'v2', 'v3', 'v4'],
        driver: 'driver_bone',
        total_rotation: [15, 30, -45],
      },
    ];
    expect(() => validateProject(doc)).not.toThrow();

    // Reject empty bones list
    doc.rig.constraints = [
      {
        type: 'spline_spine',
        name: 'empty_spine',
        bones: [],
      },
    ];
    expect(() => validateProject(doc)).toThrow(/must have a non-empty bones list/);

    // Reject missing driver
    doc.rig.constraints = [
      {
        type: 'spline_spine',
        name: 'missing_driver',
        bones: ['root', 'v1'],
        driver: 'nonexistent_driver',
      },
    ];
    expect(() => validateProject(doc)).toThrow(/references missing driver bone/);
  });

  it('validates bone joint limits boundaries across all 3 axes', () => {
    const doc = starterProject('limits_stress');
    doc.rig.bones.root.limits = {
      pitch: [-180, 180],
      yaw: [-360, 360],
      roll: [0, 0],
    };
    expect(() => validateProject(doc)).not.toThrow();
  });
});

describe('Challenger 2 Adversarial Stress Suite: Procedural Animation & Multi-cycle Long Horizon', () => {
  it('validates all procedural sub-blocks with edge and boundary parameters', () => {
    const doc = starterProject('proc_stress');
    doc.animations.walk_epic = {
      frames: 60,
      fps: 60,
      loop: true,
      procedural: {
        gait: {
          speed: 5.0,
          stride_length: 12.0,
          stride_height: 5.0,
          hip_bounce: 2.0,
          arm_swing: 60.0,
          root_bone: 'root',
        },
        breathing: {
          rate: 1.5,
          intensity: 3.0,
          chest_bone: 'root',
        },
        lean: {
          velocity: [10.0, 0.0, 20.0],
          acceleration: [5.0, 0.0, -10.0],
          turn_rate: 3.14,
          landing_impact: 15.0,
          pitch_factor: 10.0,
          roll_factor: 10.0,
          banking_factor: 20.0,
          stiffness: 300.0,
          damping: 30.0,
          root_bone: 'root',
        },
        look_at: {
          target: [1000.0, 500.0, -1000.0],
          head_bone: 'root',
          max_angle: 180.0,
        },
      },
    };
    expect(() => validateProject(doc)).not.toThrow();
  });
});

describe('Challenger 2 Adversarial Stress Suite: Two-Bone IK Solver Boundary Singularities', () => {
  it('survives coincident root and target without NaN', () => {
    const root: [number, number, number] = [0, 0, 0];
    const target: [number, number, number] = [0, 0, 0];
    const pole: [number, number, number] = [0, 0, 1];
    const [joint, end] = solveTwoBone(root, target, 5, 5, pole);

    expect(Number.isFinite(joint[0])).toBe(true);
    expect(Number.isFinite(joint[1])).toBe(true);
    expect(Number.isFinite(joint[2])).toBe(true);
    expect(Number.isFinite(end[0])).toBe(true);
    expect(Number.isFinite(end[1])).toBe(true);
    expect(Number.isFinite(end[2])).toBe(true);
  });

  it('survives over-reach target far beyond bone lengths', () => {
    const root: [number, number, number] = [0, 0, 0];
    const target: [number, number, number] = [0, 1000, 0];
    const pole: [number, number, number] = [1, 0, 0];
    const [joint, end] = solveTwoBone(root, target, 2, 2, pole);

    expect(Number.isFinite(joint[0])).toBe(true);
    expect(Number.isFinite(joint[1])).toBe(true);
    expect(Number.isFinite(joint[2])).toBe(true);
    // End distance from root should be clamped close to l1 + l2 = 4
    const endDist = Math.hypot(end[0], end[1], end[2]);
    expect(endDist).toBeCloseTo(4.0, 3);
  });

  it('survives collinear pole vector and bone direction', () => {
    const root: [number, number, number] = [0, 0, 0];
    const target: [number, number, number] = [0, 4, 0];
    // Pole exactly on the line between root and target
    const pole: [number, number, number] = [0, 2, 0];
    const [joint, end] = solveTwoBone(root, target, 2.5, 2.5, pole);

    expect(Number.isFinite(joint[0])).toBe(true);
    expect(Number.isFinite(joint[1])).toBe(true);
    expect(Number.isFinite(joint[2])).toBe(true);
  });
});

describe('Challenger 2 Adversarial Stress Suite: YAML Roundtrip Lossless Fidelity', () => {
  it('preserves all spring physics, constraints, limits, and procedural configs through YAML serialization', () => {
    const doc = starterProject('full_feature_project');
    doc.rig.bones.chest = { parent: 'root', translation: [0, 3, 0] };
    doc.rig.bones.head = { parent: 'chest', translation: [0, 2, 0] };
    doc.rig.bones.arm_l = { parent: 'chest', translation: [2, 0, 0] };
    doc.rig.bones.arm_r = { parent: 'chest', translation: [-2, 0, 0] };

    doc.rig.spring_bones = {
      head: {
        stiffness: 160.0,
        damping: 14.5,
        mass: 1.25,
        drag: 0.12,
        gravity: [0.0, -9.81, 1.5],
        limit_angle: 40.0,
      },
    };

    doc.rig.bones.chest.limits = {
      pitch: [-30, 45],
      yaw: [-60, 60],
      roll: [-25, 25],
    };

    doc.rig.constraints = [
      {
        type: 'spline_spine',
        name: 'chest_spline',
        bones: ['root', 'chest', 'head'],
        total_rotation: [0, 45, 0],
      },
      {
        type: 'mirror',
        name: 'arm_mirror',
        source: 'arm_l',
        target: 'arm_r',
        plane: 'yz',
        influence: 0.9,
      },
      {
        type: 'copy_rotation',
        name: 'head_copy',
        source: 'root',
        target: 'head',
        influence: 0.5,
        axes: [true, false, true],
        invert: [false, true, false],
      },
    ];

    doc.animations.walk_cycle = {
      frames: 16,
      fps: 12,
      loop: true,
      bones: {},
      ik: {},
      procedural: {
        gait: {
          speed: 1.2,
          stride_length: 4.0,
          stride_height: 1.8,
          hip_bounce: 0.5,
          arm_swing: 30.0,
          root_bone: 'root',
        },
        breathing: {
          rate: 0.35,
          intensity: 1.1,
          chest_bone: 'chest',
        },
      },
    };

    expect(() => validateProject(doc)).not.toThrow();

    // Serialize to YAML
    const yamlString = yaml.dump(doc, { noRefs: true, lineWidth: -1 });
    expect(yamlString).toContain('spring_bones:');
    expect(yamlString).toContain('constraints:');
    expect(yamlString).toContain('spline_spine');
    expect(yamlString).toContain('copy_rotation');
    expect(yamlString).toContain('procedural:');

    // Parse back
    const restoredDoc = yaml.load(yamlString) as ProjectDocument;
    expect(() => validateProject(restoredDoc)).not.toThrow();

    // Verify deep equivalence
    expect((restoredDoc.rig.spring_bones as any)?.head.stiffness).toBe(160.0);
    expect((restoredDoc.rig.spring_bones as any)?.head.damping).toBe(14.5);
    expect((restoredDoc.rig.spring_bones as any)?.head.gravity).toEqual([0.0, -9.81, 1.5]);
    expect((restoredDoc.rig.constraints as any)?.length).toBe(3);
    expect((restoredDoc.rig.bones.chest as any).limits?.pitch).toEqual([-30, 45]);
    expect((restoredDoc.animations.walk_cycle as any).procedural?.gait?.speed).toBe(1.2);
  });
});
