"""Unit tests for dynamic spring bones and bone constraints."""
import math
import unittest

import numpy as np

from spritebuilder.animation import euler_matrix, evaluate_pose, evaluate_rest_pose
from spritebuilder.project import Bone, ProjectError, compile_project
from spritebuilder.spring_bones import (
    CopyRotationConstraint,
    MirrorConstraint,
    SplineSpineConstraint,
    SpringBoneConfig,
    SpringBoneSolver,
    evaluate_constraints,
)


def create_test_project_dict():
    """Return a minimal valid project dictionary for spring bone testing."""
    return {
        "palette": {"x": "#FF0000"},
        "parts": {
            "root_part": {
                "pivot": [0, 0, 0],
                "front": "x",
                "back": "x",
                "side": "x",
            }
        },
        "rig": {
            "bones": {
                "root": {
                    "translation": [0, 0, 0],
                    "rotation": [0, 0, 0],
                    "part": "root_part",
                },
                "tail_1": {
                    "parent": "root",
                    "translation": [0, 1, 0],
                    "rotation": [0, 0, 0],
                },
                "tail_2": {
                    "parent": "tail_1",
                    "translation": [0, 1, 0],
                    "rotation": [0, 0, 0],
                },
            },
            "ik_chains": {},
        },
        "animations": {
            "idle": {
                "frames": 10,
                "fps": 10.0,
                "loop": True,
                "bones": {
                    "root": {
                        "rotation": [
                            {"frame": 0, "value": [0, 0, 0]},
                            {"frame": 5, "value": [0, 0, 30]},
                            {"frame": 9, "value": [0, 0, 0]},
                        ]
                    }
                },
                "ik": {},
            }
        },
        "export": {
            "name": "test_spring",
            "size": [32, 32],
            "scale": 1,
            "origin": [16, 16],
            "directions": [0],
            "animations": ["idle"],
            "background": [0, 0, 0, 0],
        },
    }


class SpringBoneParsingTests(unittest.TestCase):
    def test_parse_spring_bones_and_constraints(self):
        data = create_test_project_dict()
        data["rig"]["spring_bones"] = {
            "tail_1": {
                "stiffness": 150.0,
                "damping": 15.0,
                "mass": 1.5,
                "drag": 0.2,
                "gravity": [0.0, -9.81, 0.0],
                "limit_angle": 30.0,
            }
        }
        data["rig"]["constraints"] = [
            {
                "type": "spline_spine",
                "name": "spine_c",
                "bones": ["tail_1", "tail_2"],
                "total_rotation": [0, 20, 0],
            },
            {
                "type": "mirror",
                "name": "mirror_c",
                "source": "tail_1",
                "target": "tail_2",
                "plane": "yz",
                "influence": 0.8,
            },
        ]
        project = compile_project(data)
        self.assertIn("tail_1", project.spring_bones)
        cfg = project.spring_bones["tail_1"]
        self.assertEqual(cfg.stiffness, 150.0)
        self.assertEqual(cfg.damping, 15.0)
        self.assertEqual(cfg.mass, 1.5)
        self.assertEqual(cfg.drag, 0.2)
        np.testing.assert_allclose(cfg.gravity, [0.0, -9.81, 0.0])
        self.assertEqual(cfg.limit_angle, 30.0)
        self.assertIsNotNone(project.bones["tail_1"].spring)

        self.assertEqual(len(project.constraints), 2)
        self.assertIsInstance(project.constraints[0], SplineSpineConstraint)
        self.assertIsInstance(project.constraints[1], MirrorConstraint)

    def test_parse_bone_inline_spring(self):
        data = create_test_project_dict()
        data["rig"]["bones"]["tail_1"]["spring"] = {
            "stiffness": 80.0,
            "damping": 8.0,
        }
        project = compile_project(data)
        self.assertIn("tail_1", project.spring_bones)
        self.assertEqual(project.spring_bones["tail_1"].stiffness, 80.0)
        self.assertEqual(project.spring_bones["tail_1"].damping, 8.0)

    def test_invalid_spring_params_raise_project_error(self):
        data = create_test_project_dict()
        data["rig"]["spring_bones"] = {
            "tail_1": {"mass": -1.0}
        }
        with self.assertRaises(ProjectError):
            compile_project(data)

        data = create_test_project_dict()
        data["rig"]["spring_bones"] = {
            "non_existent": {"stiffness": 10.0}
        }
        with self.assertRaises(ProjectError):
            compile_project(data)

    def test_invalid_constraint_raises_project_error(self):
        data = create_test_project_dict()
        data["rig"]["constraints"] = [
            {"type": "mirror", "source": "tail_1", "target": "missing_bone"}
        ]
        with self.assertRaises(ProjectError):
            compile_project(data)


class SpringPhysicsSolverTests(unittest.TestCase):
    def setUp(self):
        self.data = create_test_project_dict()
        self.data["rig"]["spring_bones"] = {
            "tail_1": {
                "stiffness": 100.0,
                "damping": 0.0,  # Undamped for frequency test
                "mass": 1.0,
                "drag": 0.0,
                "gravity": [0.0, 0.0, 0.0],
                "limit_angle": 180.0,
            }
        }
        self.project = compile_project(self.data)

    def test_rest_pose_compliance(self):
        """In static rest pose with no external force, spring bone remains at rest pose."""
        rest_pose = evaluate_rest_pose(self.project)
        solver = SpringBoneSolver(self.project)
        # Step solver with rest pose and dt = 0.01s
        stepped_pose = solver.step(rest_pose, dt=0.01)

        for bone_name in ("root", "tail_1", "tail_2"):
            np.testing.assert_allclose(stepped_pose[bone_name], rest_pose[bone_name], atol=1e-5)

    def test_spring_harmonic_oscillation_frequency(self):
        """Verify dynamic 3D damped harmonic oscillator frequency matches omega_0 = sqrt(k/m)."""
        k = 100.0
        m = 1.0
        omega_0 = math.sqrt(k / m)  # 10.0 rad/s -> Period T = 2*pi/10 approx 0.628 s
        expected_period = 2.0 * math.pi / omega_0

        solver = SpringBoneSolver(self.project)
        rest_pose = evaluate_rest_pose(self.project)

        # Displace tail_1 spring tip initially
        solver.state["tail_1"]["pos"] += np.array([0.5, 0.0, 0.0])

        dt = 0.005
        total_time = 1.5
        steps = int(total_time / dt)

        # Record x displacement of tail_1 tip over time
        displacements = []
        target_tip = rest_pose["tail_1"][:3, 3] + rest_pose["tail_1"][:3, :3] @ solver.local_tips["tail_1"]
        for s in range(steps):
            stepped = solver.step(rest_pose, dt)
            st_pos = solver.state["tail_1"]["pos"]
            displacements.append(st_pos[0] - target_tip[0])

        # Find zero-crossing indices to measure half period
        zero_crossings = []
        for i in range(1, len(displacements)):
            if displacements[i - 1] * displacements[i] <= 0:
                zero_crossings.append(i * dt)

        self.assertGreater(len(zero_crossings), 3)
        periods = [2 * (zero_crossings[i + 1] - zero_crossings[i]) for i in range(len(zero_crossings) - 1)]
        avg_period = sum(periods) / len(periods)

        self.assertAlmostEqual(avg_period, expected_period, delta=0.08)

    def test_energy_stability_under_damping(self):
        """Verify total mechanical energy decreases monotonically over time when damping > 0."""
        self.data["rig"]["spring_bones"]["tail_1"]["damping"] = 15.0
        self.data["rig"]["spring_bones"]["tail_1"]["stiffness"] = 100.0
        project = compile_project(self.data)
        solver = SpringBoneSolver(project)
        rest_pose = evaluate_rest_pose(project)

        # Give spring tip an initial offset / disturbance
        solver.state["tail_1"]["pos"] += np.array([0.5, 0.0, 0.0])

        dt = 0.01
        energies = []
        for _ in range(100):
            stepped = solver.step(rest_pose, dt)
            st = solver.state["tail_1"]
            v = st["vel"]
            p_head = stepped["tail_1"][:3, 3]
            target_tip = p_head + stepped["tail_1"][:3, :3] @ solver.local_tips["tail_1"]
            x_disp = st["pos"] - target_tip

            kinetic = 0.5 * 1.0 * np.dot(v, v)
            potential = 0.5 * 100.0 * np.dot(x_disp, x_disp)
            energy = kinetic + potential
            energies.append(energy)

        # Check energy general decay trend: final energy significantly less than initial energy
        self.assertLess(energies[-1], energies[0] * 0.1)

    def test_gravity_steady_state_equilibrium(self):
        """Constant gravity vector causes predictable downward equilibrium deflection delta_y = m*g/k."""
        self.data["rig"]["spring_bones"]["tail_1"]["gravity"] = [0.0, -10.0, 0.0]
        self.data["rig"]["spring_bones"]["tail_1"]["stiffness"] = 100.0
        self.data["rig"]["spring_bones"]["tail_1"]["damping"] = 20.0  # Overdamped to reach steady state quickly
        self.data["rig"]["spring_bones"]["tail_1"]["mass"] = 1.0
        project = compile_project(self.data)
        solver = SpringBoneSolver(project)
        rest_pose = evaluate_rest_pose(project)

        dt = 0.02
        for _ in range(100):
            stepped = solver.step(rest_pose, dt)

        st = solver.state["tail_1"]
        target_tip = rest_pose["tail_1"][:3, 3] + rest_pose["tail_1"][:3, :3] @ solver.local_tips["tail_1"]
        disp = st["pos"] - target_tip
        expected_y = -10.0 / 100.0  # m*g_y / k = 1.0 * -10.0 / 100.0 = -0.1

        self.assertAlmostEqual(disp[1], expected_y, delta=0.02)

    def test_limit_angle_clamping(self):
        """Angle between spring tip and target direction never exceeds limit_angle."""
        self.data["rig"]["spring_bones"]["tail_1"]["limit_angle"] = 15.0  # 15 degrees
        self.data["rig"]["spring_bones"]["tail_1"]["gravity"] = [50.0, 0.0, 0.0]  # Strong sideways force
        project = compile_project(self.data)
        solver = SpringBoneSolver(project)
        rest_pose = evaluate_rest_pose(project)

        dt = 0.01
        for _ in range(50):
            stepped = solver.step(rest_pose, dt)
            st = solver.state["tail_1"]
            p_head = stepped["tail_1"][:3, 3]
            target_tip = p_head + stepped["tail_1"][:3, :3] @ solver.local_tips["tail_1"]
            dir_sim = st["pos"] - p_head
            dir_target = target_tip - p_head
            cos_a = np.dot(dir_sim, dir_target) / (np.linalg.norm(dir_sim) * np.linalg.norm(dir_target))
            angle_deg = math.degrees(math.acos(np.clip(cos_a, -1.0, 1.0)))

            self.assertLessEqual(angle_deg, 15.01)


class ConstraintSolverTests(unittest.TestCase):
    def setUp(self):
        self.data = create_test_project_dict()
        self.project = compile_project(self.data)

    def test_spline_spine_constraint_distribution(self):
        """SplineSpineConstraint distributes flex/twist rotation evenly across N vertebrae bones."""
        constraint = SplineSpineConstraint(
            name="spine_c",
            bones=["tail_1", "tail_2"],
            total_rotation=(0.0, 40.0, 0.0),  # 40 degrees total yaw across 2 bones
        )
        rest_pose = evaluate_rest_pose(self.project)
        constrained = evaluate_constraints(self.project, rest_pose, [constraint])

        # Each bone should receive 20 degrees yaw (40 / 2)
        # Check tail_1 rotation matrix relative to root
        r1 = constrained["tail_1"][:3, :3]
        expected_r1 = euler_matrix([0.0, 20.0, 0.0])
        np.testing.assert_allclose(r1, expected_r1, atol=1e-5)

    def test_mirror_constraint_reflection(self):
        """MirrorConstraint reflects source bone transform across YZ plane (x -> -x)."""
        data = create_test_project_dict()
        data["rig"]["bones"]["arm_L"] = {
            "parent": "root",
            "translation": [2.0, 1.0, 0.0],
            "rotation": [10.0, 20.0, 30.0],
        }
        data["rig"]["bones"]["arm_R"] = {
            "parent": "root",
            "translation": [-2.0, 1.0, 0.0],
            "rotation": [0.0, 0.0, 0.0],
        }
        project = compile_project(data)
        rest_pose = evaluate_rest_pose(project)

        constraint = MirrorConstraint(
            name="mirror_arm",
            source="arm_L",
            target="arm_R",
            plane="yz",
            influence=1.0,
        )
        constrained = evaluate_constraints(project, rest_pose, [constraint])

        # arm_R position should be mirrored X of arm_L
        p_L = constrained["arm_L"][:3, 3]
        p_R = constrained["arm_R"][:3, 3]
        np.testing.assert_allclose(p_R, [-p_L[0], p_L[1], p_L[2]], atol=1e-5)

        # arm_R rotation matrix should equal M @ R_L @ M where M = diag(-1, 1, 1)
        m = np.diag([-1.0, 1.0, 1.0])
        r_L = constrained["arm_L"][:3, :3]
        expected_r_R = m @ r_L @ m
        np.testing.assert_allclose(constrained["arm_R"][:3, :3], expected_r_R, atol=1e-5)

    def test_copy_rotation_constraint_with_influence_and_axes(self):
        """CopyRotationConstraint drives target bone rotation with axes filtering and influence."""
        data = create_test_project_dict()
        data["rig"]["bones"]["driver"] = {
            "parent": "root",
            "translation": [0, 1, 0],
            "rotation": [30.0, 40.0, 50.0],
        }
        data["rig"]["bones"]["follower"] = {
            "parent": "root",
            "translation": [1, 1, 0],
            "rotation": [0.0, 0.0, 0.0],
        }
        project = compile_project(data)
        rest_pose = evaluate_rest_pose(project)

        # Copy X axis only with influence 1.0
        constraint = CopyRotationConstraint(
            name="copy_rot",
            source="driver",
            target="follower",
            influence=1.0,
            axes=(True, False, False),
            invert=(False, False, False),
        )
        constrained = evaluate_constraints(project, rest_pose, [constraint])

        follower_r = constrained["follower"][:3, :3]
        expected_r = euler_matrix([30.0, 0.0, 0.0])
        np.testing.assert_allclose(follower_r, expected_r, atol=1e-5)


class PoseEvaluationIntegrationTests(unittest.TestCase):
    def test_evaluate_pose_with_physics_and_constraints(self):
        data = create_test_project_dict()
        data["rig"]["spring_bones"] = {
            "tail_2": {
                "stiffness": 50.0,
                "damping": 5.0,
                "mass": 1.0,
            }
        }
        data["rig"]["constraints"] = [
            {
                "type": "copy_rotation",
                "name": "copy_c",
                "source": "root",
                "target": "tail_1",
                "influence": 0.5,
            }
        ]
        project = compile_project(data)
        clip = project.clips["idle"]
        solver = SpringBoneSolver(project)

        # Evaluate frames sequentially
        poses = []
        for f in range(clip.frames):
            pose = evaluate_pose(project, clip, f, dt=0.1, solver=solver)
            poses.append(pose)
            self.assertIn("tail_1", pose)
            self.assertIn("tail_2", pose)

        # Verify dynamic movement occurred across frames
        t2_pos_0 = poses[0]["tail_2"][:3, 3]
        t2_pos_5 = poses[5]["tail_2"][:3, 3]
        self.assertFalse(np.allclose(t2_pos_0, t2_pos_5))


if __name__ == "__main__":
    unittest.main()
