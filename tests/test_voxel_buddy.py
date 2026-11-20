import unittest
from pathlib import Path

import numpy as np
import yaml

from spritebuilder.animation import active_parts, evaluate_pose
from spritebuilder.project import compile_project
from spritebuilder.render import render_pose

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "voxel_buddy.yaml"


def load():
    raw = yaml.safe_load(EXAMPLE.read_text(encoding="utf-8"))
    return raw, compile_project(raw, EXAMPLE)


def changed_pixels(project, clip, frame, yaw, hide):
    pose = evaluate_pose(project, clip, frame)
    parts = active_parts(project, clip, frame)
    a = np.asarray(render_pose(project, pose, yaw, parts=parts))
    b = np.asarray(render_pose(project, pose, yaw, parts={**parts, **{bone: None for bone in hide}}))
    return a, b


class VoxelBuddyTests(unittest.TestCase):
    """The example demonstrates sticker faces and a hidden-by-default prop."""

    def test_face_sticker_shows_from_front_views_only(self):
        _, project = load()
        clip = project.clips["idle"]
        for yaw in (0, 45, 315):
            a, b = changed_pixels(project, clip, 0, yaw, ["face"])
            self.assertGreater(int((a != b).any(axis=2).sum()), 20, yaw)
            self.assertEqual(int(((a[:, :, 3] > 0) & (b[:, :, 3] == 0)).sum()), 0, yaw)  # inside the head outline
        a, b = changed_pixels(project, clip, 0, 180, ["face"])
        self.assertEqual(int((a != b).any(axis=2).sum()), 0)

    def test_idle_blinks_with_a_face_swap(self):
        _, project = load()
        clip = project.clips["idle"]
        faces = [active_parts(project, clip, f)["face"] for f in range(clip.frames)]
        self.assertEqual([f for f, n in enumerate(faces) if n == "face_blink"], [5])

    def test_spark_prop_hidden_until_wave_shows_it(self):
        raw, project = load()
        self.assertIsNone(raw["rig"]["bones"]["fx_spark"]["part"])
        idle = project.clips["idle"]
        self.assertTrue(all(active_parts(project, idle, f)["fx_spark"] is None for f in range(idle.frames)))
        wave = project.clips["wave"]
        self.assertIn("fx_spark", {active_parts(project, wave, f)["fx_spark"] for f in range(wave.frames)})

    def test_no_frame_touches_the_border(self):
        _, project = load()
        for name, clip in project.clips.items():
            for f in range(clip.frames):
                pose = evaluate_pose(project, clip, f)
                parts = active_parts(project, clip, f)
                for yaw in project.export.directions:
                    a = np.asarray(render_pose(project, pose, yaw, parts=parts))[:, :, 3]
                    self.assertEqual(max(a[0].max(), a[-1].max(), a[:, 0].max(), a[:, -1].max()), 0, (name, f, yaw))


if __name__ == "__main__":
    unittest.main()
