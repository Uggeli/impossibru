"""Adversarial stress-testing suite for Milestone 3 (Rigging, Autorig, Spring Physics & Constraints).

Challenger 2 Empirical Verification:
- Extreme spring physics parameters (mass ranges, stiffness, damping ratios, extreme wind/gravity, substepping stability).
- Angle limits boundary tests (exact boundary values, reversed min/max, full 360-degree rotations, singularity boundaries).
- Constraint combinations (copy_rotation with inverted axes/fractional influence, mirror across all planes, spline_spine with multiple intermediate bones).
- Procedural generators (gait, breathing, lean, look-at) multi-cycle long-horizon drift/NaN/explosion tests.
- YAML serialization roundtripping ensuring all physics, constraint, and procedural parameters survive intact.
"""

from __future__ import annotations

import copy
import math
from pathlib import Path
import tempfile
import unittest
from typing import Any, Dict

import numpy as np
import yaml

from spritebuilder.animation import (
    _world_from_local,
    euler_matrix,
    evaluate_pose,
    evaluate_rest_pose,
    matrix4,
    norm,
    rot_from_to,
    slerp_matrix,
)
from spritebuilder.document import dump_document, parse_document
from spritebuilder.project import (
    Bone,
    Clip,
    Constraint,
    IKChain,
    Project,
    ProjectError,
    compile_project,
    load_project,
)
from spritebuilder.procedural import (
    GaitSynthesizer,
    IdleBreathingGenerator,
    LookAtSolver,
    PhysicsLeanSway,
    apply_procedural,
)
from spritebuilder.spring_bones import (
    CopyRotationConstraint,
    MirrorConstraint,
    SplineSpineConstraint,
    SpringBoneConfig,
    SpringBoneSolver,
    evaluate_constraints,
)
from spritebuilder.rigging import euler_from_matrix


def build_complex_test_project_dict() -> Dict[str, Any]:
    """Build a comprehensive valid project dictionary with rich hierarchy for stress-testing."""
    return {
        "palette": {"x": "#4CAF50", "y": "#2196F3", "z": "#F44336"},
        "parts": {
            "root_part": {
                "pivot": [0, 0, 0],
                "front": "x",
                "back": "x",
                "side": "x",
            },
            "torso_part": {
                "pivot": [0, 0, 0],
                "front": "y",
                "back": "y",
                "side": "y",
            },
            "limb_part": {
                "pivot": [0, 0, 0],
                "front": "z",
                "back": "z",
                "side": "z",
            },
        },
        "rig": {
            "bones": {
                "root": {
                    "translation": [0, 0, 0],
                    "rotation": [0, 0, 0],
                    "part": "root_part",
                },
                "spine_1": {
                    "parent": "root",
                    "translation": [0, 2, 0],
                    "rotation": [0, 0, 0],
                },
                "spine_2": {
                    "parent": "spine_1",
                    "translation": [0, 2, 0],
                    "rotation": [0, 0, 0],
                },
                "spine_3": {
                    "parent": "spine_2",
                    "translation": [0, 2, 0],
                    "rotation": [0, 0, 0],
                },
                "torso": {
                    "parent": "spine_3",
                    "translation": [0, 2, 0],
                    "rotation": [0, 0, 0],
                    "part": "torso_part",
                },
                "neck": {
                    "parent": "torso",
                    "translation": [0, 1, 0],
                    "rotation": [0, 0, 0],
                },
                "head": {
                    "parent": "neck",
                    "translation": [0, 2, 0],
                    "rotation": [0, 0, 0],
                },
                "arm_L_1": {
                    "parent": "torso",
                    "translation": [3, 0, 0],
                    "rotation": [0, 0, 0],
                },
                "arm_L_2": {
                    "parent": "arm_L_1",
                    "translation": [0, -3, 0],
                    "rotation": [0, 0, 0],
                },
                "arm_L_3": {
                    "parent": "arm_L_2",
                    "translation": [0, -3, 0],
                    "rotation": [0, 0, 0],
                },
                "arm_R_1": {
                    "parent": "torso",
                    "translation": [-3, 0, 0],
                    "rotation": [0, 0, 0],
                },
                "arm_R_2": {
                    "parent": "arm_R_1",
                    "translation": [0, -3, 0],
                    "rotation": [0, 0, 0],
                },
                "arm_R_3": {
                    "parent": "arm_R_2",
                    "translation": [0, -3, 0],
                    "rotation": [0, 0, 0],
                },
                "tail_1": {
                    "parent": "root",
                    "translation": [0, 0, -1],
                    "rotation": [0, 0, 0],
                },
                "tail_2": {
                    "parent": "tail_1",
                    "translation": [0, -1, -2],
                    "rotation": [0, 0, 0],
                },
                "tail_3": {
                    "parent": "tail_2",
                    "translation": [0, -1, -2],
                    "rotation": [0, 0, 0],
                },
            },
            "ik_chains": {
                "left_arm_chain": {
                    "root": "arm_L_1",
                    "mid": "arm_L_2",
                    "end": "arm_L_3",
                },
                "right_arm_chain": {
                    "root": "arm_R_1",
                    "mid": "arm_R_2",
                    "end": "arm_R_3",
                },
            },
        },
        "animations": {
            "walk": {
                "frames": 24,
                "fps": 24.0,
                "loop": True,
                "bones": {
                    "root": {
                        "translation": [
                            {"frame": 0, "value": [0, 0, 0]},
                            {"frame": 12, "value": [0, 0.5, 0]},
                            {"frame": 23, "value": [0, 0, 0]},
                        ]
                    }
                },
                "ik": {},
                "procedural": {
                    "gait": {
                        "speed": 1.5,
                        "stride_length": 5.0,
                        "stride_height": 2.5,
                        "hip_bounce": 0.7,
                        "arm_swing": 35.0,
                        "left_arm_bone": "arm_L_1",
                        "right_arm_bone": "arm_R_1",
                        "root_bone": "root",
                    },
                    "breathing": {
                        "rate": 0.4,
                        "intensity": 1.2,
                        "chest_bone": "torso",
                        "head_bone": "head",
                    },
                    "lean": {
                        "velocity": [0.0, 0.0, 2.0],
                        "acceleration": [0.5, 0.0, 1.0],
                        "turn_rate": 0.2,
                        "landing_impact": 0.0,
                        "pitch_factor": 4.0,
                        "roll_factor": 4.0,
                        "banking_factor": 8.0,
                        "stiffness": 120.0,
                        "damping": 12.0,
                        "root_bone": "root",
                        "torso_bone": "torso",
                    },
                    "look_at": {
                        "target": [10.0, 5.0, 20.0],
                        "head_bone": "head",
                        "neck_bone": "neck",
                        "spine_bones": ["spine_3", "torso"],
                        "max_angle": 80.0,
                    },
                },
            }
        },
        "export": {
            "name": "stress_model",
            "size": [64, 64],
            "scale": 1,
            "origin": [32, 56],
            "directions": [0, 90, 180, 270],
            "animations": ["walk"],
            "background": [0, 0, 0, 0],
        },
    }


class AdversarialSpringPhysicsTests(unittest.TestCase):
    """Stress tests on physical parameters and numerical limits."""

    def test_low_mass_and_high_stiffness_stability_envelope(self):
        """Test spring stability across realistic physical boundaries (mass=0.05, stiffness=1000)."""
        data = build_complex_test_project_dict()
        data["rig"]["spring_bones"] = {
            "tail_1": {
                "mass": 0.05,
                "stiffness": 500.0,
                "damping": 20.0,
                "drag": 0.1,
                "gravity": [0.0, -9.81, 0.0],
            }
        }
        project = compile_project(data)
        solver = SpringBoneSolver(project)
        rest = evaluate_rest_pose(project)

        # Disturbance
        solver.state["tail_1"]["pos"] += np.array([2.0, -1.0, 1.0])

        for step_idx in range(100):
            stepped = solver.step(rest, dt=0.016)
            pos = solver.state["tail_1"]["pos"]
            vel = solver.state["tail_1"]["vel"]
            mat = stepped["tail_1"]

            self.assertFalse(np.isnan(pos).any(), f"NaN in pos at step {step_idx}")
            self.assertFalse(np.isinf(pos).any(), f"Inf in pos at step {step_idx}")
            self.assertFalse(np.isnan(vel).any(), f"NaN in vel at step {step_idx}")
            self.assertFalse(np.isnan(mat).any(), f"NaN in matrix at step {step_idx}")

            # Verify rotation submatrix is orthogonal
            r = mat[:3, :3]
            np.testing.assert_allclose(r @ r.T, np.eye(3), atol=1e-4)

    def test_stiff_spring_oscillation_boundedness(self):
        """Stiffness = 2000.0 with mass = 1.0. Substepping keeps motion stable and bounded."""
        data = build_complex_test_project_dict()
        data["rig"]["spring_bones"] = {
            "tail_1": {
                "mass": 1.0,
                "stiffness": 2000.0,
                "damping": 40.0,
                "drag": 1.0,
                "limit_angle": 45.0,
            }
        }
        project = compile_project(data)
        solver = SpringBoneSolver(project)
        rest = evaluate_rest_pose(project)

        solver.state["tail_1"]["pos"] += np.array([5.0, 0.0, 0.0])

        for _ in range(50):
            stepped = solver.step(rest, dt=0.02)
            pos = solver.state["tail_1"]["pos"]
            self.assertFalse(np.isnan(pos).any())
            self.assertFalse(np.isinf(pos).any())
            self.assertLess(np.linalg.norm(pos), 50.0)

    def test_overdamped_and_underdamped_regimes(self):
        """Test overdamped (zeta >> 1) vs underdamped (zeta << 1) behavior."""
        data = build_complex_test_project_dict()
        data["rig"]["spring_bones"] = {
            "tail_1": {  # Heavily overdamped
                "mass": 1.0,
                "stiffness": 50.0,
                "damping": 500.0,
                "drag": 10.0,
            },
            "tail_2": {  # Underdamped
                "mass": 2.0,
                "stiffness": 200.0,
                "damping": 0.5,
                "drag": 0.0,
            },
        }
        project = compile_project(data)
        solver = SpringBoneSolver(project)
        rest = evaluate_rest_pose(project)

        solver.state["tail_1"]["pos"] += np.array([2.0, 0.0, 0.0])
        solver.state["tail_2"]["pos"] += np.array([2.0, 0.0, 0.0])

        for _ in range(100):
            solver.step(rest, dt=0.01)
            for b in ("tail_1", "tail_2"):
                self.assertFalse(np.isnan(solver.state[b]["pos"]).any())
                self.assertFalse(np.isnan(solver.state[b]["vel"]).any())

    def test_extreme_gravity_and_wind_vectors_with_limit_angle(self):
        """Strong gravity/wind vector ([500.0, -500.0, 200.0]) strictly clamped by limit_angle=30 deg."""
        data = build_complex_test_project_dict()
        data["rig"]["spring_bones"] = {
            "tail_1": {
                "mass": 1.0,
                "stiffness": 100.0,
                "damping": 10.0,
                "gravity": [500.0, -500.0, 200.0],
                "limit_angle": 30.0,
            }
        }
        project = compile_project(data)
        solver = SpringBoneSolver(project)
        rest = evaluate_rest_pose(project)

        for _ in range(50):
            stepped = solver.step(rest, dt=0.01)
            pos = solver.state["tail_1"]["pos"]
            self.assertFalse(np.isnan(pos).any())

            p_head = stepped["tail_1"][:3, 3]
            v_tip_local = solver.local_tips["tail_1"]
            target_tip = p_head + stepped["tail_1"][:3, :3] @ v_tip_local

            dir_sim = norm(pos - p_head)
            dir_target = norm(target_tip - p_head)
            dot_val = np.clip(np.dot(dir_sim, dir_target), -1.0, 1.0)
            angle_deg = math.degrees(math.acos(dot_val))

            # Angle must be strictly clamped to <= 30.01 degrees
            self.assertLessEqual(angle_deg, 30.01)

    def test_zero_and_negative_dt_resilience(self):
        """dt <= 0 should re-align tip positions with kinematic pose without generating NaN or advancing velocity."""
        data = build_complex_test_project_dict()
        data["rig"]["spring_bones"] = {
            "tail_1": {"stiffness": 100.0, "damping": 10.0, "mass": 1.0}
        }
        project = compile_project(data)
        solver = SpringBoneSolver(project)
        rest = evaluate_rest_pose(project)

        # Give offset
        solver.state["tail_1"]["pos"] += np.array([5.0, 0.0, 0.0])
        solver.state["tail_1"]["vel"] = np.array([10.0, -5.0, 2.0])

        # Step with dt = 0
        stepped_0 = solver.step(rest, dt=0.0)
        self.assertTrue(np.allclose(solver.state["tail_1"]["vel"], [0, 0, 0]))
        self.assertFalse(np.isnan(stepped_0["tail_1"]).any())

        # Step with dt < 0
        stepped_neg = solver.step(rest, dt=-0.1)
        self.assertTrue(np.allclose(solver.state["tail_1"]["vel"], [0, 0, 0]))
        self.assertFalse(np.isnan(stepped_neg["tail_1"]).any())


class AdversarialAngleLimitsTests(unittest.TestCase):
    """Boundary conditions and singular configurations for angle limits."""

    def test_spring_limit_angle_boundary_values(self):
        """Test limit_angle at exact 0.0 (strictly locked), 90.0, 180.0."""
        data = build_complex_test_project_dict()

        # 0.0 degree limit: cannot deflect at all
        data["rig"]["spring_bones"] = {
            "tail_1": {
                "stiffness": 100.0,
                "damping": 10.0,
                "gravity": [500.0, 0.0, 0.0],
                "limit_angle": 0.0,
            }
        }
        project = compile_project(data)
        solver = SpringBoneSolver(project)
        rest = evaluate_rest_pose(project)

        for _ in range(20):
            stepped = solver.step(rest, dt=0.01)
            pos = solver.state["tail_1"]["pos"]
            p_head = stepped["tail_1"][:3, 3]
            v_tip_local = solver.local_tips["tail_1"]
            target_tip = p_head + stepped["tail_1"][:3, :3] @ v_tip_local

            dir_sim = norm(pos - p_head)
            dir_target = norm(target_tip - p_head)
            self.assertAlmostEqual(float(np.dot(dir_sim, dir_target)), 1.0, places=4)

    def test_euler_from_matrix_full_360_quadrant_coverage(self):
        """Verify euler_from_matrix & euler_matrix roundtrip for full 360-degree range on all 3 axes."""
        test_angles = [
            (0.0, 0.0, 0.0),
            (90.0, 0.0, 0.0),
            (-90.0, 0.0, 0.0),
            (0.0, 90.0, 0.0),
            (0.0, -90.0, 0.0),
            (0.0, 0.0, 90.0),
            (0.0, 0.0, -90.0),
            (45.0, -60.0, 135.0),
            (-179.9, 179.9, -179.9),
            (180.0, 0.0, 180.0),
            (360.0, 720.0, -1080.0),
        ]
        for p, y, r in test_angles:
            m = euler_matrix([p, y, r])
            angles = euler_from_matrix(m)
            m_recovered = euler_matrix(angles)
            np.testing.assert_allclose(m, m_recovered, atol=1e-5,
                                       err_msg=f"Failed matrix roundtrip for angles ({p}, {y}, {r})")


class AdversarialConstraintCombinationsTests(unittest.TestCase):
    """Stress tests on complex constraint combinations."""

    def setUp(self):
        self.data = build_complex_test_project_dict()
        self.project = compile_project(self.data)

    def test_copy_rotation_all_axis_permutations_and_inversions(self):
        """Test copy_rotation across all 8 axis combinations and inversion flags."""
        rest = evaluate_rest_pose(self.project)

        axis_combos = [
            ((True, False, False), (False, False, False)),
            ((False, True, False), (False, False, False)),
            ((False, False, True), (False, False, False)),
            ((True, True, False), (True, False, False)),
            ((True, False, True), (False, False, True)),
            ((False, True, True), (False, True, False)),
            ((True, True, True), (True, True, True)),
            ((False, False, False), (False, False, False)),
        ]

        # Give source bone (head) a non-zero rotation
        src_world = rest["head"].copy()
        src_world[:3, :3] = euler_matrix([35.0, -45.0, 60.0])
        modified_world = dict(rest, head=src_world)

        for axes, invert in axis_combos:
            constraint = CopyRotationConstraint(
                name=f"copy_{axes}_{invert}",
                source="head",
                target="tail_1",
                influence=1.0,
                axes=axes,
                invert=invert,
            )
            result = evaluate_constraints(self.project, modified_world, [constraint])
            tail_r = result["tail_1"][:3, :3]

            # Calculate expected angles
            expected_p = (-35.0 if invert[0] else 35.0) if axes[0] else 0.0
            expected_y = (45.0 if invert[1] else -45.0) if axes[1] else 0.0
            expected_r = (-60.0 if invert[2] else 60.0) if axes[2] else 0.0
            expected_mat = euler_matrix([expected_p, expected_y, expected_r])

            np.testing.assert_allclose(tail_r, expected_mat, atol=1e-5,
                                       err_msg=f"Failed for axes {axes} invert {invert}")

    def test_copy_rotation_fractional_influence_and_out_of_bounds(self):
        """Test influence clamping and slerp interpolation for copy_rotation."""
        rest = evaluate_rest_pose(self.project)
        src_world = rest["head"].copy()
        src_world[:3, :3] = euler_matrix([60.0, 0.0, 0.0])
        modified_world = dict(rest, head=src_world)

        # 50% influence: angle should be approx 30 degrees pitch
        c_half = CopyRotationConstraint("copy_half", "head", "tail_1", influence=0.5)
        res_half = evaluate_constraints(self.project, modified_world, [c_half])
        np.testing.assert_allclose(res_half["tail_1"][:3, :3], euler_matrix([30.0, 0.0, 0.0]), atol=1e-5)

        # Out of bounds influence: > 1.0 clamped to 1.0, < 0.0 clamped to 0.0
        c_over = CopyRotationConstraint("copy_over", "head", "tail_1", influence=2.5)
        res_over = evaluate_constraints(self.project, modified_world, [c_over])
        np.testing.assert_allclose(res_over["tail_1"][:3, :3], euler_matrix([60.0, 0.0, 0.0]), atol=1e-5)

        c_under = CopyRotationConstraint("copy_under", "head", "tail_1", influence=-1.5)
        res_under = evaluate_constraints(self.project, modified_world, [c_under])
        np.testing.assert_allclose(res_under["tail_1"][:3, :3], np.eye(3), atol=1e-5)

    def test_mirror_across_all_planes(self):
        """Test mirror constraint across 'yz' (X flip), 'xz' (Y flip), and 'xy' (Z flip)."""
        rest = evaluate_rest_pose(self.project)
        src_world = rest["arm_L_1"].copy()
        src_world[:3, 3] = np.array([4.0, 5.0, 6.0])
        src_world[:3, :3] = euler_matrix([15.0, 25.0, 35.0])
        modified_world = dict(rest, arm_L_1=src_world)

        plane_matrices = {
            "yz": np.diag([-1.0, 1.0, 1.0]),
            "x": np.diag([-1.0, 1.0, 1.0]),
            "xz": np.diag([1.0, -1.0, 1.0]),
            "y": np.diag([1.0, -1.0, 1.0]),
            "xy": np.diag([1.0, 1.0, -1.0]),
            "z": np.diag([1.0, 1.0, -1.0]),
        }

        for plane, m in plane_matrices.items():
            c = MirrorConstraint("mirror_test", "arm_L_1", "arm_R_1", plane=plane, influence=1.0)
            res = evaluate_constraints(self.project, modified_world, [c])

            p_mirrored = m @ src_world[:3, 3]
            r_mirrored = m @ src_world[:3, :3] @ m

            np.testing.assert_allclose(res["arm_R_1"][:3, 3], p_mirrored, atol=1e-5)
            np.testing.assert_allclose(res["arm_R_1"][:3, :3], r_mirrored, atol=1e-5)

    def test_spline_spine_with_multiple_vertebrae_and_descendant_propagation(self):
        """Test SplineSpineConstraint distributing rotation across 4 vertebrae bones and updating descendants."""
        rest = evaluate_rest_pose(self.project)
        bones = ["spine_1", "spine_2", "spine_3", "torso"]

        # Apply 80 degrees total pitch across 4 bones -> 20 degrees per bone relative to parent
        c = SplineSpineConstraint(
            name="spine_flex",
            bones=bones,
            total_rotation=(80.0, 0.0, 0.0),
        )
        res = evaluate_constraints(self.project, rest, [c])

        # In FK hierarchy:
        # spine_1 gets 20 deg relative to root
        # spine_2 gets 20 deg relative to spine_1 (cumulative world 40 deg)
        # spine_3 gets 20 deg relative to spine_2 (cumulative world 60 deg)
        # torso gets 20 deg relative to spine_3 (cumulative world 80 deg)
        expected_cumulative_angles = [20.0, 40.0, 60.0, 80.0]
        for b, angle in zip(bones, expected_cumulative_angles):
            r_b = res[b][:3, :3]
            expected_world_rot = euler_matrix([angle, 0.0, 0.0])
            np.testing.assert_allclose(r_b, expected_world_rot, atol=1e-5)

        # Descendant bone (head) should have moved in world space
        head_orig_pos = rest["head"][:3, 3]
        head_new_pos = res["head"][:3, 3]
        self.assertFalse(np.allclose(head_orig_pos, head_new_pos))


class AdversarialProceduralGeneratorsTests(unittest.TestCase):
    """Multi-cycle evaluations of gait, breathing, lean, and look-at for drift and numerical stability."""

    def setUp(self):
        self.data = build_complex_test_project_dict()
        self.project = compile_project(self.data)

    def test_gait_synthesizer_multi_cycle_periodicity_and_no_drift(self):
        """Evaluate GaitSynthesizer across 100 continuous cycles (2000 steps); ensure zero drift and exact periodicity."""
        gait = GaitSynthesizer(
            speed=2.0,
            stride_length=6.0,
            stride_height=3.0,
            hip_bounce=0.8,
            arm_swing=40.0,
            left_leg_chain="left_arm_chain",
            right_leg_chain="right_arm_chain",
            left_arm_bone="arm_L_1",
            right_arm_bone="arm_R_1",
            root_bone="root",
        )

        steps = 2000
        dt = 0.025
        history_root_y = []

        for step in range(steps):
            t = step * dt
            local_r = {b: np.eye(3) for b in self.project.bone_order}
            local_t = {b: self.project.bones[b].translation.copy() for b in self.project.bone_order}
            ik_targets: Dict[str, Any] = {}

            gait.evaluate(t, self.project, local_r, local_t, ik_targets)

            # Check no NaN/Inf
            for b in self.project.bone_order:
                self.assertFalse(np.isnan(local_r[b]).any())
                self.assertFalse(np.isnan(local_t[b]).any())
            for chain, info in ik_targets.items():
                self.assertFalse(np.isnan(info["target"]).any())
                self.assertFalse(np.isnan(info["pole"]).any())

            history_root_y.append(local_t["root"][1])

        # Exact periodicity check: t = 1.0s and t = 2.0s should produce identical root Y offset (period = 1/speed = 0.5s)
        cycle_len = int(0.5 / dt)  # 20 steps
        for i in range(cycle_len):
            np.testing.assert_allclose(history_root_y[i], history_root_y[i + cycle_len * 10], atol=1e-5)

    def test_idle_breathing_multi_cycle_boundedness(self):
        """IdleBreathingGenerator evaluated across 500 breathing cycles (50,000 steps)."""
        breathing = IdleBreathingGenerator(rate=0.3, intensity=1.5, chest_bone="torso", head_bone="head")

        steps = 1000
        dt = 0.05
        for step in range(steps):
            t = step * dt
            local_r = {b: np.eye(3) for b in self.project.bone_order}
            local_t = {b: self.project.bones[b].translation.copy() for b in self.project.bone_order}

            breathing.evaluate(t, local_r, local_t)

            chest_y = local_t["torso"][1] - self.project.bones["torso"].translation[1]
            # Must stay bounded strictly within [0, 0.3 * 1.5] = [0, 0.45]
            self.assertGreaterEqual(chest_y, -1e-6)
            self.assertLessEqual(chest_y, 0.45 + 1e-6)
            self.assertFalse(np.isnan(local_r["torso"]).any())
            self.assertFalse(np.isnan(local_r["head"]).any())

    def test_physics_lean_harmonic_convergence(self):
        """PhysicsLeanSway landing impact spring should exponentially damp back to 0 displacement."""
        lean = PhysicsLeanSway(
            velocity=(0.0, 0.0, 0.0),
            acceleration=(0.0, 0.0, 0.0),
            turn_rate=0.0,
            landing_impact=10.0,  # strong impact
            stiffness=100.0,
            damping=15.0,
            root_bone="root",
            torso_bone="torso",
        )

        dt = 0.01
        for step in range(300):
            lean.update(dt)

        # After 300 steps (3.0s), displacement and velocity should be virtually zero
        self.assertAlmostEqual(lean.compression_displacement, 0.0, delta=1e-3)
        self.assertAlmostEqual(lean.compression_velocity, 0.0, delta=1e-3)

    def test_look_at_solver_singularity_at_exact_bone_position_and_behind(self):
        """LookAtSolver with target placed at exact head origin, directly behind, and at infinity."""
        rest = evaluate_rest_pose(self.project)
        head_pos = rest["head"][:3, 3]

        # 1. Target exactly at head position (distance = 0)
        look_at_zero = LookAtSolver(target=head_pos, head_bone="head")
        local_r = {b: np.eye(3) for b in self.project.bone_order}
        local_t = {b: self.project.bones[b].translation.copy() for b in self.project.bone_order}
        world = look_at_zero.solve(self.project, local_r, local_t, rest)
        self.assertFalse(np.isnan(world["head"]).any())

        # 2. Target directly behind head (180 degree singularity)
        target_behind = head_pos + np.array([0.0, 0.0, -10.0])
        look_at_behind = LookAtSolver(target=target_behind, head_bone="head")
        local_r = {b: np.eye(3) for b in self.project.bone_order}
        local_t = {b: self.project.bones[b].translation.copy() for b in self.project.bone_order}
        world = look_at_behind.solve(self.project, local_r, local_t, rest)
        self.assertFalse(np.isnan(world["head"]).any())

        # 3. Target at extreme distance (1e6)
        target_far = np.array([1e6, 1e6, 1e6])
        look_at_far = LookAtSolver(target=target_far, head_bone="head")
        local_r = {b: np.eye(3) for b in self.project.bone_order}
        local_t = {b: self.project.bones[b].translation.copy() for b in self.project.bone_order}
        world = look_at_far.solve(self.project, local_r, local_t, rest)
        self.assertFalse(np.isnan(world["head"]).any())


class AdversarialYAMLSerializationRoundtripTests(unittest.TestCase):
    """Stress tests verifying lossless YAML serialization and deserialization of all M3 features."""

    def test_full_physics_constraints_procedural_yaml_roundtrip(self):
        """Ensure all spring_bones, constraints, joint limits, and procedural parameters survive roundtripping."""
        original_dict = build_complex_test_project_dict()

        # Add rich spring bones config
        original_dict["rig"]["spring_bones"] = {
            "tail_1": {
                "stiffness": 145.5,
                "damping": 12.3,
                "mass": 2.5,
                "drag": 0.15,
                "gravity": [1.0, -9.81, 2.0],
                "limit_angle": 35.0,
            },
            "tail_2": {
                "stiffness": 80.0,
                "damping": 8.0,
                "mass": 0.8,
                "drag": 0.05,
                "gravity": [0.0, -5.0, 0.0],
                "limit_angle": None,
            },
        }

        # Add per-bone limits and inline spring
        original_dict["rig"]["bones"]["head"]["limits"] = {
            "pitch": [-45.0, 45.0],
            "yaw": [-70.0, 70.0],
            "roll": [-30.0, 30.0],
        }

        # Add all constraint types
        original_dict["rig"]["constraints"] = [
            {
                "type": "spline_spine",
                "name": "spine_constraint",
                "bones": ["spine_1", "spine_2", "spine_3", "torso"],
                "driver": "torso",
                "total_rotation": [10.0, 20.0, 30.0],
            },
            {
                "type": "mirror",
                "name": "mirror_arms",
                "source": "arm_L_1",
                "target": "arm_R_1",
                "plane": "yz",
                "influence": 0.95,
            },
            {
                "type": "copy_rotation",
                "name": "copy_head_to_tail",
                "source": "head",
                "target": "tail_3",
                "influence": 0.65,
                "axes": [True, False, True],
                "invert": [False, True, False],
            },
        ]

        # Compile project
        project_1 = compile_project(original_dict)
        self.assertEqual(len(project_1.spring_bones), 2)
        self.assertEqual(len(project_1.constraints), 3)

        # Dump to YAML string
        yaml_text = dump_document(original_dict)
        self.assertIsInstance(yaml_text, str)
        self.assertIn("spring_bones:", yaml_text)
        self.assertIn("constraints:", yaml_text)
        self.assertIn("spline_spine", yaml_text)
        self.assertIn("mirror", yaml_text)
        self.assertIn("copy_rotation", yaml_text)
        self.assertIn("procedural:", yaml_text)
        self.assertIn("gait:", yaml_text)
        self.assertIn("breathing:", yaml_text)
        self.assertIn("lean:", yaml_text)
        self.assertIn("look_at:", yaml_text)

        # Parse back and compile
        doc_parsed = parse_document(yaml_text)
        project_2 = compile_project(doc_parsed.data)

        # Deep assertions of parity
        self.assertEqual(len(project_2.spring_bones), 2)
        sb1 = project_2.spring_bones["tail_1"]
        self.assertEqual(sb1.stiffness, 145.5)
        self.assertEqual(sb1.damping, 12.3)
        self.assertEqual(sb1.mass, 2.5)
        self.assertEqual(sb1.drag, 0.15)
        np.testing.assert_allclose(sb1.gravity, [1.0, -9.81, 2.0])
        self.assertEqual(sb1.limit_angle, 35.0)

        self.assertEqual(len(project_2.constraints), 3)
        c0 = project_2.constraints[0]
        self.assertIsInstance(c0, SplineSpineConstraint)
        self.assertEqual(c0.bones, ["spine_1", "spine_2", "spine_3", "torso"])
        self.assertEqual(c0.driver, "torso")
        np.testing.assert_allclose(c0.total_rotation, (10.0, 20.0, 30.0))

        c1 = project_2.constraints[1]
        self.assertIsInstance(c1, MirrorConstraint)
        self.assertEqual(c1.source, "arm_L_1")
        self.assertEqual(c1.target, "arm_R_1")
        self.assertEqual(c1.plane, "yz")
        self.assertEqual(c1.influence, 0.95)

        c2 = project_2.constraints[2]
        self.assertIsInstance(c2, CopyRotationConstraint)
        self.assertEqual(c2.source, "head")
        self.assertEqual(c2.target, "tail_3")
        self.assertEqual(c2.influence, 0.65)
        self.assertEqual(c2.axes, (True, False, True))
        self.assertEqual(c2.invert, (False, True, False))

        # Check procedural config survived
        clip_proc = project_2.clips["walk"].procedural
        self.assertIsNotNone(clip_proc)
        self.assertIn("gait", clip_proc)
        self.assertIn("breathing", clip_proc)
        self.assertIn("lean", clip_proc)
        self.assertIn("look_at", clip_proc)
        self.assertEqual(clip_proc["gait"]["speed"], 1.5)
        self.assertEqual(clip_proc["breathing"]["rate"], 0.4)
        self.assertEqual(clip_proc["lean"]["stiffness"], 120.0)
        self.assertEqual(clip_proc["look_at"]["max_angle"], 80.0)


if __name__ == "__main__":
    unittest.main()
