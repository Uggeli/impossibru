"""Empirical Adversarial Stress-Testing Suite for Milestone 3 (Challenger 1).

Tests:
1. Deep bone hierarchies (up to 20 levels), multi-step reparenting preserving world coordinates, and cycle attempt rejection.
2. Autorigging on pathological voxel layouts (empty parts, single-voxel 1x1x1, non-contiguous voxels, asymmetric density & extreme aspect ratios).
3. Viewport joint dragging transform inversion under complex rotated parent chains across all camera angles and octants.
4. Numerical stability: protection against division-by-zero, NaN, Inf, and singular matrix inversion.
"""
from __future__ import annotations

import copy
import math
import unittest
import numpy as np

from spritebuilder.animation import evaluate_pose, evaluate_rest_pose
from spritebuilder.autorig import (
    analyze_part,
    analyze_project,
    autorig_document_data,
    autorig_project,
    generate_creature_rig,
    generate_humanoid_rig,
    generate_quadruped_rig,
    generate_rig,
)
from spritebuilder.project import Project, ProjectError, VoxelPart, compile_project
from spritebuilder.rigging import (
    drag_document,
    euler_from_matrix,
    normalize_angle,
    normalize_euler,
    project_point,
    reparent_document,
    unproject_point,
)


def _create_deep_chain_project(depth: int = 10, base_name: str = "bone") -> dict:
    """Create a valid project dict with a deep chain of compound rotated/translated bones."""
    palette = {"x": "#55AA55", "#": "#FFFFFF"}
    parts = {
        "torso": {
            "pivot": [1.5, 0, 1.5],
            "front": "....\n.xx.\n.xx.\n....",
            "back": "....\n.xx.\n.xx.\n....",
            "side": "....\n.xx.\n.xx.\n....",
        }
    }
    bones = {
        f"{base_name}_0": {
            "part": "torso",
            "translation": [3.0, 7.0, -2.0],
            "rotation": [15.0, -20.0, 35.0],
        }
    }
    for i in range(1, depth):
        bones[f"{base_name}_{i}"] = {
            "parent": f"{base_name}_{i-1}",
            "translation": [float(i * 1.5), float(i * 2.0 - 5.0), float(-i * 1.2)],
            "rotation": [
                float((i * 27) % 180 - 90),
                float((i * 41) % 180 - 90),
                float((i * 33) % 180 - 90),
            ],
        }

    return {
        "palette": palette,
        "parts": parts,
        "rig": {"bones": bones, "ik_chains": {}},
        "animations": {
            "idle": {
                "frames": 4,
                "fps": 10,
                "bones": {
                    f"{base_name}_0": {
                        "translation": [{"frame": 0, "value": [0, 0, 0]}]
                    }
                },
                "ik": {},
            }
        },
        "export": {
            "name": "deep_chain",
            "size": [64, 64],
            "scale": 2,
            "origin": [32, 50],
            "directions": [0, 90, 180, 270],
            "animations": ["idle"],
        },
    }


class Challenger1DeepHierarchyReparentingTests(unittest.TestCase):
    """Adversarial stress-testing of deep bone trees and reparenting invariants."""

    def test_reparenting_preserves_world_matrix_in_20_level_hierarchy(self):
        doc = _create_deep_chain_project(depth=20)
        proj_init = compile_project(doc)
        pose_init = evaluate_rest_pose(proj_init)

        # Record initial world translations for all bones
        initial_world_positions = {
            name: pose_init[name][:3, 3].copy() for name in proj_init.bone_order
        }

        # Step 1: Reparent leaf bone_19 directly to root bone_0
        doc1 = reparent_document(doc, "bone_19", "bone_0")
        proj1 = compile_project(doc1)
        pose1 = evaluate_rest_pose(proj1)
        self.assertEqual(doc1["rig"]["bones"]["bone_19"]["parent"], "bone_0")
        np.testing.assert_allclose(
            pose1["bone_19"], pose_init["bone_19"], atol=1e-4
        )

        # Step 2: Reparent middle bone_10 to null (making it a second root)
        doc2 = reparent_document(doc1, "bone_10", None)
        proj2 = compile_project(doc2)
        pose2 = evaluate_rest_pose(proj2)
        self.assertNotIn("parent", doc2["rig"]["bones"]["bone_10"])
        np.testing.assert_allclose(
            pose2["bone_10"], pose_init["bone_10"], atol=1e-4
        )

        # Descendants of bone_10 (bone_11 through bone_18) must also retain world matrices
        for i in range(11, 19):
            b_name = f"bone_{i}"
            np.testing.assert_allclose(
                pose2[b_name], pose_init[b_name], atol=1e-4
            )

        # Step 3: Reparent bone_19 under bone_15 (cross-branch reparenting)
        doc3 = reparent_document(doc2, "bone_19", "bone_15")
        proj3 = compile_project(doc3)
        pose3 = evaluate_rest_pose(proj3)
        np.testing.assert_allclose(
            pose3["bone_19"], pose_init["bone_19"], atol=1e-4
        )

        # Step 4: Reparent formerly root bone_0 under bone_18
        doc4 = reparent_document(doc3, "bone_0", "bone_18")
        proj4 = compile_project(doc4)
        pose4 = evaluate_rest_pose(proj4)
        np.testing.assert_allclose(
            pose4["bone_0"], pose_init["bone_0"], atol=1e-4
        )

        # Verify no NaN or Inf anywhere in the 20-bone poses
        for b_name in proj4.bone_order:
            self.assertTrue(np.all(np.isfinite(pose4[b_name])))

    def test_cycle_rejection_direct_and_transitive(self):
        doc = _create_deep_chain_project(depth=15)

        # Self-parenting
        with self.assertRaises(ProjectError) as cm:
            reparent_document(doc, "bone_3", "bone_3")
        self.assertIn("cannot parent itself", str(cm.exception))

        # Direct 2-node cycle (bone_0 -> bone_1, reparent bone_0 under bone_1)
        with self.assertRaises(ProjectError) as cm:
            reparent_document(doc, "bone_0", "bone_1")
        self.assertIn("cycle", str(cm.exception))

        # Transitive 15-node cycle (reparent bone_0 under leaf bone_14)
        with self.assertRaises(ProjectError) as cm:
            reparent_document(doc, "bone_0", "bone_14")
        self.assertIn("cycle", str(cm.exception))

        # Mid-chain cycle (bone_4 is ancestor of bone_12; reparent bone_4 under bone_12)
        with self.assertRaises(ProjectError) as cm:
            reparent_document(doc, "bone_4", "bone_12")
        self.assertIn("cycle", str(cm.exception))

    def test_ik_chain_invalidation_rejection_during_reparenting(self):
        doc = _create_deep_chain_project(depth=8)
        doc["rig"]["ik_chains"] = {
            "leg_chain": {
                "root": "bone_2",
                "mid": "bone_3",
                "end": "bone_4",
            }
        }
        compile_project(doc)

        # Attempting to reparent mid bone_3 away from root bone_2 must fail
        with self.assertRaises(ProjectError) as cm:
            reparent_document(doc, "bone_3", "bone_0")
        self.assertIn("invalidate IK chain", str(cm.exception))

        # Attempting to reparent end bone_4 away from mid bone_3 must fail
        with self.assertRaises(ProjectError) as cm:
            reparent_document(doc, "bone_4", "bone_0")
        self.assertIn("invalidate IK chain", str(cm.exception))

        # Reparenting root bone_2 under bone_0 preserves the chain and must succeed
        doc_valid = reparent_document(doc, "bone_2", "bone_0")
        self.assertEqual(doc_valid["rig"]["bones"]["bone_2"]["parent"], "bone_0")
        compile_project(doc_valid)


class Challenger1AutorigPathologicalLayoutTests(unittest.TestCase):
    """Adversarial stress-testing of autorig algorithms on extreme voxel configurations."""

    def test_empty_parts_rejection(self):
        doc = {
            "palette": {"x": "#FF0000"},
            "parts": {
                "empty_part": {
                    "front": "..\n..",
                    "back": "..\n..",
                    "side": "..\n..",
                }
            },
            "rig": {"bones": {}, "ik_chains": {}},
            "animations": {},
            "export": {"name": "empty_test", "size": [32, 32], "scale": 1, "origin": [16, 16], "directions": [0], "animations": []},
        }
        with self.assertRaises(ProjectError):
            autorig_document_data(doc, "humanoid")

    def test_single_voxel_1x1x1_part_stability(self):
        doc = {
            "palette": {"x": "#00FF00"},
            "parts": {
                "torso": {
                    "pivot": [0, 0, 0],
                    "front": "x",
                    "back": "x",
                    "side": "x",
                },
                "head": {
                    "pivot": [0, 0, 0],
                    "front": "x",
                    "back": "x",
                    "side": "x",
                },
            },
            "rig": {"bones": {"root": {"translation": [0, 0, 0]}}, "ik_chains": {}},
            "animations": {"idle": {"frames": 1, "fps": 10, "bones": {}, "ik": {}}},
            "export": {"name": "test", "size": [64, 64], "scale": 1, "origin": [32, 32], "directions": [0], "animations": ["idle"]},
        }

        for preset in ["humanoid", "quadruped", "creature"]:
            rigged = autorig_document_data(doc, preset)
            proj = compile_project(rigged)
            pose = evaluate_rest_pose(proj)
            for b_name, mat in pose.items():
                self.assertTrue(np.all(np.isfinite(mat)))

    def test_disconnected_extreme_corner_voxels(self):
        doc = {
            "palette": {"x": "#336699", "y": "#FF9900"},
            "parts": {
                "torso": {
                    "pivot": [0, 0, 0],
                    "front": "x......x\n........\n........\n........\n........\n........\n........\nx......x",
                    "back": "x......x\n........\n........\n........\n........\n........\n........\nx......x",
                    "side": "x......x\n........\n........\n........\n........\n........\n........\nx......x",
                },
                "head": {
                    "pivot": [0, 0, 0],
                    "front": "y..y\n....\n....\ny..y",
                    "back": "y..y\n....\n....\ny..y",
                    "side": "y..y\n....\n....\ny..y",
                },
            },
            "rig": {"bones": {"root": {"translation": [0, 0, 0]}}, "ik_chains": {}},
            "animations": {"idle": {"frames": 1, "fps": 10, "bones": {}, "ik": {}}},
            "export": {"name": "test", "size": [64, 64], "scale": 1, "origin": [32, 32], "directions": [0], "animations": ["idle"]},
        }
        for preset in ["humanoid", "quadruped", "creature"]:
            rigged = autorig_document_data(doc, preset)
            proj = compile_project(rigged)
            pose = evaluate_rest_pose(proj)
            for mat in pose.values():
                self.assertTrue(np.all(np.isfinite(mat)))

    def test_extreme_aspect_ratio_needle_and_slab(self):
        long_row = "x" * 60
        tall_col = "\n".join(["x"] * 60)
        doc = {
            "palette": {"x": "#FF00FF"},
            "parts": {
                "torso": {
                    "pivot": [0, 0, 0],
                    "front": long_row,
                    "back": long_row,
                    "side": "x",
                },
                "lower_leg_l": {
                    "pivot": [0, 0, 0],
                    "front": tall_col,
                    "back": tall_col,
                    "side": tall_col,
                },
            },
            "rig": {"bones": {"root": {"translation": [0, 0, 0]}}, "ik_chains": {}},
            "animations": {"idle": {"frames": 1, "fps": 10, "bones": {}, "ik": {}}},
            "export": {"name": "test", "size": [128, 128], "scale": 1, "origin": [64, 64], "directions": [0], "animations": ["idle"]},
        }
        for preset in ["humanoid", "quadruped", "creature"]:
            rigged = autorig_document_data(doc, preset)
            proj = compile_project(rigged)
            pose = evaluate_rest_pose(proj)
            for mat in pose.values():
                self.assertTrue(np.all(np.isfinite(mat)))


class Challenger1JointDraggingTransformInversionTests(unittest.TestCase):
    """Adversarial stress-testing of joint dragging inverse transforms under compound rotations."""

    def test_rest_joint_dragging_across_deep_compound_rotated_hierarchy(self):
        doc = _create_deep_chain_project(depth=8)
        proj_init = compile_project(doc)

        target_coords = [
            (0.0, 0.0, 0.0),
            (10.0, 25.0, -15.0),
            (-120.0, 85.0, 240.0),
            (0.001, -0.002, 0.003),
            (999.0, -888.0, 777.0),
        ]

        camera_angles = [0.0, 45.0, 90.0, 135.0, 180.0, 225.0, 270.0, 315.0]

        for target_world in target_coords:
            for yaw in camera_angles:
                # Project target_world into screen space
                screen_x, screen_y, depth = project_point(proj_init, target_world, yaw)

                # Drag bone_7 (leaf in 8-level hierarchy)
                dragged_doc = drag_document(
                    doc,
                    kind="joint",
                    name="bone_7",
                    screen=(screen_x, screen_y),
                    yaw=yaw,
                    depth=depth,
                    mode="rest",
                )

                proj_after = compile_project(dragged_doc)
                pose_after = evaluate_rest_pose(proj_after)
                actual_world = pose_after["bone_7"][:3, 3]

                np.testing.assert_allclose(
                    actual_world, np.asarray(target_world), atol=1e-4,
                    err_msg=f"Failed for target={target_world}, yaw={yaw}"
                )

                # Verify all ancestor bone transforms (bone_0 through bone_6) are unmodified
                pose_init = evaluate_rest_pose(proj_init)
                for i in range(7):
                    b_name = f"bone_{i}"
                    np.testing.assert_allclose(
                        pose_after[b_name], pose_init[b_name], atol=1e-5
                    )


class Challenger1NumericalStabilityTests(unittest.TestCase):
    """Adversarial stress-testing of numerical edge cases, gimbal lock, and angle normalization."""

    def test_euler_matrix_round_trip_gimbal_lock(self):
        gimbal_angles = [
            [0.0, 90.0, 0.0],
            [0.0, -90.0, 0.0],
            [45.0, 90.0, 30.0],
            [-30.0, -90.0, 60.0],
            [180.0, 0.0, 180.0],
            [-179.99, 89.99, -179.99],
        ]
        for ang in gimbal_angles:
            from spritebuilder.animation import euler_matrix
            mat = euler_matrix(ang)
            reconstructed = euler_from_matrix(mat)
            remat = euler_matrix(reconstructed)
            np.testing.assert_allclose(mat, remat, atol=1e-4)

    def test_angle_normalization_boundaries(self):
        self.assertEqual(normalize_angle(0.0), 0.0)
        self.assertEqual(normalize_angle(180.0), -180.0)
        self.assertEqual(normalize_angle(-180.0), -180.0)
        self.assertEqual(normalize_angle(360.0), 0.0)
        self.assertEqual(normalize_angle(540.0), -180.0)
        self.assertEqual(normalize_angle(-720.0), 0.0)
        self.assertEqual(normalize_euler([360, 540, -180]), [0.0, -180.0, -180.0])


if __name__ == "__main__":
    unittest.main()
