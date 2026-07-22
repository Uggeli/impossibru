import copy
from pathlib import Path
import unittest

import numpy as np

from spritebuilder.animation import euler_matrix, evaluate_pose, evaluate_rest_pose
from spritebuilder.document import load_document
from spritebuilder.project import ProjectError, compile_project
from spritebuilder.rigging import (chain_suggestions, drag_document, euler_from_matrix,
                                   normalize_angle, project_point, reparent_document,
                                   unproject_point)


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "humanoid.yaml"


class RigGeometryTests(unittest.TestCase):
    def setUp(self):
        self.document = load_document(FIXTURE).data
        self.project = compile_project(self.document)

    def test_euler_round_trip_and_normalization(self):
        for angles in ([12, 34, -56], [-175, 70, 179], [45, -80, 20]):
            recovered = euler_from_matrix(euler_matrix(angles))
            np.testing.assert_allclose(euler_matrix(recovered), euler_matrix(angles), atol=1e-7)
        self.assertEqual(normalize_angle(540), -180)

    def test_projection_unprojection_all_views(self):
        point = np.array([3.25, -4.5, 7.75])
        for yaw in (0, 90, 37.5, 271):
            x, y, depth = project_point(self.project, point, yaw)
            np.testing.assert_allclose(unproject_point(self.project, [x, y], depth, yaw), point)

    def test_reparent_preserves_entire_world_pose_and_rejects_cycle(self):
        before = evaluate_rest_pose(self.project)
        changed = reparent_document(self.document, "head", "root")
        after = evaluate_rest_pose(compile_project(changed))
        for name in ("head",):
            np.testing.assert_allclose(after[name], before[name], atol=1e-7)
        with self.assertRaises(ProjectError):
            reparent_document(self.document, "root", "head")

    def test_rest_drag_keeps_camera_depth(self):
        pose = evaluate_rest_pose(self.project)
        point = pose["head"][:3, 3]
        x, y, depth = project_point(self.project, point, 45)
        changed = drag_document(self.document, "joint", "head", [x + 9, y - 6], 45, depth)
        moved = evaluate_rest_pose(compile_project(changed))["head"][:3, 3]
        self.assertAlmostEqual(project_point(self.project, moved, 45)[2], depth)
        self.assertAlmostEqual(project_point(self.project, moved, 45)[0], x + 9)

    def test_chain_suggestions_are_direct_paths(self):
        suggestions = chain_suggestions(self.project)
        self.assertIn({"root": "root", "mid": "left_upper_leg", "end": "left_lower_leg"}, suggestions)


class RigKeyTests(unittest.TestCase):
    def test_root_drag_replaces_key_and_ik_drag_writes_world_key(self):
        document = load_document(FIXTURE).data
        project = compile_project(document)
        root = evaluate_rest_pose(project)["root"][:3, 3]
        x, y, depth = project_point(project, root, 0)
        changed = drag_document(document, "joint", "root", [x + 3, y], 0, depth,
                                "animate", "idle", 1)
        keys = changed["animations"]["idle"]["bones"]["root"]["translation"]
        self.assertEqual(len([k for k in keys if k["frame"] == 1]), 1)
        self.assertEqual(next(k for k in keys if k["frame"] == 1).get("interpolation"), "linear")

    def test_dragging_ik_end_bone_creates_target_and_moves_whole_chain(self):
        document = load_document(FIXTURE).data
        project = compile_project(document)
        clip = project.clips["idle"]
        foot = evaluate_pose(project, clip, 1)["left_foot"][:3, 3]
        x, y, depth = project_point(project, foot, 0)

        changed = drag_document(document, "joint", "left_foot", [x + 3, y - 2],
                                0, depth, "animate", "idle", 1)

        target = changed["animations"]["idle"]["ik"]["left_leg"]["target"]
        key = next(key for key in target if key["frame"] == 1)
        np.testing.assert_allclose(key["value"], unproject_point(project, [x + 3, y - 2], depth, 0))
        self.assertNotIn("left_lower_leg", changed["animations"]["idle"].get("bones", {}))
        changed_project = compile_project(changed)
        changed_pose = evaluate_pose(changed_project, changed_project.clips["idle"], 1)
        self.assertFalse(np.allclose(changed_pose["left_lower_leg"][:3, 3],
                                     evaluate_pose(project, clip, 1)["left_lower_leg"][:3, 3]))
        np.testing.assert_allclose(changed_pose["left_foot"][:3, 3], key["value"], atol=1e-5)
