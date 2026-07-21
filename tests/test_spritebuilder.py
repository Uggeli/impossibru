import json
import copy
import tempfile
import unittest
from pathlib import Path

import numpy as np
import yaml

from spritebuilder.animation import evaluate_pose, sample_rotation, sample_track, solve_two_bone
from spritebuilder.exporter import build_project
from spritebuilder.project import ProjectError, compile_project, load_project


ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples" / "humanoid.yaml"
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "humanoid.yaml"


class TrackTests(unittest.TestCase):
    def test_loop_interpolates_last_to_first(self):
        keys = [{"frame": 1, "value": 10}, {"frame": 5, "value": 20}]
        self.assertAlmostEqual(float(sample_track(keys, 7, True, 8)), 15)

    def test_step_holds_previous_value(self):
        keys = [{"frame": 0, "value": 2, "interpolation": "step"},
                {"frame": 3, "value": 8}]
        self.assertEqual(float(sample_track(keys, 2, False, 4)), 2)

    def test_rotation_uses_shortest_path(self):
        keys = [{"frame": 0, "value": [0, 0, 0]},
                {"frame": 2, "value": [0, 270, 0]}]
        rotated = sample_rotation(keys, 1, False, 3) @ np.array([1., 0., 0.])
        self.assertTrue(np.allclose(rotated, [2**-.5, 0, 2**-.5], atol=1e-6))


class IKTests(unittest.TestCase):
    def test_reachable_target_and_lengths(self):
        root = np.array([0., 0., 0.])
        joint, end = solve_two_bone(root, [3, 0, 0], 2, 2, [0, 0, 1])
        self.assertAlmostEqual(np.linalg.norm(joint-root), 2, places=6)
        self.assertAlmostEqual(np.linalg.norm(end-joint), 2, places=6)
        self.assertTrue(np.allclose(end, [3, 0, 0]))

    def test_unreachable_target_is_clamped(self):
        _, end = solve_two_bone([0, 0, 0], [10, 0, 0], 2, 3, [0, 0, 1])
        self.assertAlmostEqual(np.linalg.norm(end), 5, places=5)

    def test_weight_zero_preserves_fk_and_partial_weight_blends(self):
        project = load_project(FIXTURE)
        base = copy.deepcopy(project.clips["walk"])
        base.ik = {}
        fk = evaluate_pose(project, base, 0)
        weighted = []
        for value in (0, .5, 1):
            clip = copy.deepcopy(project.clips["walk"])
            clip.ik["left_leg"]["weight"] = [{"frame": 0, "value": value}]
            weighted.append(evaluate_pose(project, clip, 0)["left_foot"][:3, 3])
        self.assertTrue(np.allclose(weighted[0], fk["left_foot"][:3, 3]))
        self.assertFalse(np.allclose(weighted[1], weighted[0]))
        self.assertFalse(np.allclose(weighted[1], weighted[2]))


class ProjectTests(unittest.TestCase):
    def test_fixture_is_valid(self):
        project = load_project(FIXTURE)
        self.assertEqual(len(project.parts), 7)
        self.assertIn("left_leg", project.ik_chains)
        self.assertEqual(project.clips["walk"].frames, 8)

    def test_shipped_example_is_valid(self):
        # The example evolves freely; only require that it stays loadable.
        load_project(EXAMPLE)

    def test_front_back_shape_mismatch_is_rejected(self):
        data = yaml.safe_load(FIXTURE.read_text())
        rows = data["parts"]["torso"]["back"].splitlines()
        rows[0] = rows[0].replace("r", ".", 1)
        data["parts"]["torso"]["back"] = "\n".join(rows)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.yaml"
            path.write_text(yaml.safe_dump(data))
            with self.assertRaisesRegex(ProjectError, "front/back silhouettes differ"):
                load_project(path)

    def test_unknown_animation_reference_is_rejected(self):
        data = yaml.safe_load(FIXTURE.read_text())
        data["animations"]["idle"]["bones"]["missing"] = {
            "rotation": [{"frame": 0, "value": [0, 0, 0]}]
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.yaml"
            path.write_text(yaml.safe_dump(data))
            with self.assertRaisesRegex(ProjectError, "invalid bone"):
                load_project(path)

    def test_parent_cycle_is_rejected(self):
        data = yaml.safe_load(FIXTURE.read_text())
        data["rig"]["bones"]["root"]["parent"] = "torso"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.yaml"
            path.write_text(yaml.safe_dump(data))
            with self.assertRaisesRegex(ProjectError, "parent cycle"):
                load_project(path)

    def test_out_of_range_ik_weight_is_rejected(self):
        data = yaml.safe_load(FIXTURE.read_text())
        data["animations"]["walk"]["ik"]["left_leg"]["weight"][0]["value"] = 1.5
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.yaml"
            path.write_text(yaml.safe_dump(data))
            with self.assertRaisesRegex(ProjectError, "must stay within 0..1"):
                load_project(path)

    def test_export_animation_selection_is_validated(self):
        data = yaml.safe_load(FIXTURE.read_text())
        data["export"]["animations"] = ["missing"]
        with self.assertRaisesRegex(ProjectError, "references missing animation"):
            compile_project(data)


class ExportTests(unittest.TestCase):
    def test_build_writes_deterministic_atlas_contract(self):
        project = load_project(FIXTURE)
        with tempfile.TemporaryDirectory() as directory:
            png, metadata_path = build_project(project, Path(directory))
            metadata = json.loads(metadata_path.read_text())
            self.assertTrue(png.exists())
            self.assertEqual(metadata["size"], {"w": 768, "h": 2688})
            self.assertEqual(len(metadata["animations"]["walk"]["directions"]), 8)
            frame = metadata["animations"]["walk"]["directions"][0]["frames"][0]
            self.assertEqual(frame["rect"]["w"], 96)
            self.assertEqual(frame["pivot"]["x"], 48)

    def test_build_honors_selected_animations_and_directions(self):
        data = yaml.safe_load(FIXTURE.read_text())
        data["export"]["animations"] = ["idle"]
        data["export"]["directions"] = [0, 90]
        project = compile_project(data, FIXTURE)
        with tempfile.TemporaryDirectory() as directory:
            _, metadata_path = build_project(project, Path(directory))
            metadata = json.loads(metadata_path.read_text())
            self.assertEqual(list(metadata["animations"]), ["idle"])
            self.assertEqual([d["angle"] for d in metadata["animations"]["idle"]["directions"]],
                             [0.0, 90.0])
            self.assertEqual(metadata["size"]["h"], 2 * project.export.height)


if __name__ == "__main__":
    unittest.main()
