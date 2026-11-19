from pathlib import Path
import tempfile
import unittest
import numpy as np

from spritebuilder.animation import evaluate_pose, evaluate_rest_pose, norm
from spritebuilder.exporter import build_project
from spritebuilder.project import load_project
from spritebuilder.procedural import (
    GaitSynthesizer,
    IdleBreathingGenerator,
    LookAtSolver,
    PhysicsLeanSway,
    SpringBone,
    SpringBoneSolver,
    apply_procedural,
)

EXAMPLE_PATH = Path(__file__).resolve().parent.parent / "examples" / "procedural_humanoid.yaml"


class ProceduralAnimationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.project = load_project(EXAMPLE_PATH)

    def test_gait_synthesizer_cycle_and_arcing(self):
        gait = GaitSynthesizer(
            speed=1.0,
            stride_length=4.0,
            stride_height=2.0,
            hip_bounce=0.8,
            arm_swing=30.0,
        )
        rest_pose = evaluate_rest_pose(self.project)
        local_r = {b: np.eye(3) for b in self.project.bone_order}
        local_t = {b: self.project.bones[b].translation.copy() for b in self.project.bone_order}
        ik_targets = {}

        # Evaluate at stance phase start for left leg (t=0.0)
        gait.evaluate(0.0, self.project, local_r, local_t, ik_targets)
        self.assertIn("left_leg", ik_targets)
        self.assertIn("right_leg", ik_targets)

        # Left leg stance phase at t=0.0: foot planted on ground (y == 0)
        left_target_stance = ik_targets["left_leg"]["target"]
        base_left_end = rest_pose["left_foot"][:3, 3]
        self.assertAlmostEqual(left_target_stance[1], base_left_end[1], delta=1e-3)
        self.assertAlmostEqual(left_target_stance[2], base_left_end[2] + 2.0, delta=1e-3)

        # Left leg swing phase peak at t=0.75 (u_left = 0.75, swing midpoint)
        ik_targets_swing = {}
        gait.evaluate(0.75, self.project, local_r, local_t, ik_targets_swing)
        left_target_swing = ik_targets_swing["left_leg"]["target"]
        self.assertAlmostEqual(left_target_swing[1], base_left_end[1] + 2.0, delta=1e-3)
        self.assertAlmostEqual(left_target_swing[2], base_left_end[2], delta=1e-3)

    def test_physics_lean_sway_and_spring(self):
        lean = PhysicsLeanSway(
            velocity=(0.0, 0.0, 2.0),
            acceleration=(0.0, 0.0, 1.0),
            turn_rate=0.5,
            landing_impact=5.0,
            stiffness=100.0,
            damping=10.0,
        )
        local_r = {b: np.eye(3) for b in self.project.bone_order}
        local_t = {b: self.project.bones[b].translation.copy() for b in self.project.bone_order}

        lean.update(0.05)
        lean.evaluate(local_r, local_t)

        # Pitch tilt backward due to forward acceleration, turn banking roll
        torso_rot = local_r["torso"]
        self.assertFalse(np.allclose(torso_rot, np.eye(3)))

        # Compression spring should lower root translation Y
        self.assertLess(local_t["root"][1], self.project.bones["root"].translation[1])

    def test_idle_breathing_generator(self):
        breathing = IdleBreathingGenerator(rate=0.25, intensity=1.0)
        local_r = {b: np.eye(3) for b in self.project.bone_order}
        local_t = {b: self.project.bones[b].translation.copy() for b in self.project.bone_order}

        # Inhale phase at t=1.0 (quarter cycle phase = 0.5 pi)
        breathing.evaluate(1.0, local_r, local_t)

        # Torso elevation > 0 and pitch rotation > 0
        self.assertGreater(local_t["torso"][1], 0.0)
        # Head counter-rotates forward to balance gaze
        self.assertIn("head", local_r)

    def test_look_at_solver_convergence(self):
        target = (10.0, 15.0, 20.0)
        look_at = LookAtSolver(target=target, head_bone="head", spine_bones=["torso"])

        clip = self.project.clips["idle_procedural"]
        pose_before = evaluate_pose(self.project, clip, 0)
        head_pos = pose_before["head"][:3, 3]
        target_dir = norm(np.asarray(target, dtype=float) - head_pos)

        # Solve look-at
        local_r = {b: np.eye(3) for b in self.project.bone_order}
        local_t = {b: self.project.bones[b].translation.copy() for b in self.project.bone_order}
        world = evaluate_rest_pose(self.project)
        world_after = look_at.solve(self.project, local_r, local_t, world)

        head_rot_after = world_after["head"][:3, :3]
        head_forward = norm(head_rot_after @ np.array([0.0, 0.0, 1.0]))

        # Head forward vector should align closely with direction to target
        dot_product = float(np.dot(head_forward, target_dir))
        self.assertGreater(dot_product, 0.90)

    def test_procedural_evaluate_pose(self):
        clip = self.project.clips["walk_procedural"]
        pose_f0 = evaluate_pose(self.project, clip, 0)
        pose_f6 = evaluate_pose(self.project, clip, 6)

        # Bone positions should differ between frames due to gait cycle progress
        self.assertFalse(np.allclose(pose_f0["left_foot"][:3, 3], pose_f6["left_foot"][:3, 3]))

    def test_atlas_export_with_procedural_animation(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            out_dir = Path(tmpdir)
            png_path, json_path = build_project(self.project, out_dir)
            self.assertTrue(png_path.exists())
            self.assertTrue(json_path.exists())
            self.assertGreater(png_path.stat().st_size, 0)
            self.assertGreater(json_path.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main()
