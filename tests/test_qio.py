import sys
import unittest
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_shell import assert_shell_parity  # noqa: E402

import numpy as np  # noqa: E402

from spritebuilder.animation import active_parts, evaluate_pose  # noqa: E402
from spritebuilder.render import camera_yaw, render_pose  # noqa: E402
from spritebuilder.project import compile_project  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
QIO = ROOT / "examples" / "qio.yaml"


FX = ("fx_question", "fx_exclaim", "fx_stars", "fx_note", "fx_swirl")
FACES = ("happy", "blink", "wink", "excited", "thinking", "surprised", "content", "worried")


def face_pixels(project, clip, pose, yaw, frame=0):
    """Pixels that change when the face sticker is hidden."""
    parts = active_parts(project, clip, frame)
    a = np.asarray(render_pose(project, pose, yaw, parts=parts))
    b = np.asarray(render_pose(project, pose, yaw, parts={**parts, "face": None}))
    return int((a != b).any(axis=2).sum())


def load():
    raw = yaml.safe_load(QIO.read_text(encoding="utf-8"))
    return raw, compile_project(raw, QIO)


class QioTests(unittest.TestCase):
    def test_faces_are_thin_stickers(self):
        raw, _ = load()
        sizes = {tuple(raw["parts"][f"face_{n}"]["size"]) for n in FACES}
        self.assertEqual(len(sizes), 1)
        (w, h, d), = sizes
        self.assertEqual(d, 1)
        self.assertLessEqual(max(w, h), 17)
        total = sum(len(raw["parts"][f"face_{n}"]["voxels"]) for n in FACES)
        self.assertLess(total, len(raw["parts"]["head"]["voxels"]))
        self.assertNotIn("head_blink", raw["parts"])
        self.assertNotIn("head_wink", raw["parts"])
        self.assertEqual(raw["rig"]["bones"]["face"]["parent"], "head")
        self.assertEqual(raw["rig"]["bones"]["face"]["part"], "face_happy")

    def test_face_sticker_visible_front_and_three_quarter_only(self):
        _, project = load()
        clip = project.clips["idle"]
        pose = evaluate_pose(project, clip, 0)
        for yaw in (0, 45, 315):
            self.assertGreater(face_pixels(project, clip, pose, yaw), 20, yaw)
        self.assertEqual(face_pixels(project, clip, pose, 180), 0)

    def test_export_directions_front_and_three_quarter(self):
        raw, _ = load()
        self.assertEqual(raw["export"]["directions"], [0, 45, 315])

    def test_idle_blinks(self):
        _, project = load()
        clip = project.clips["idle"]
        faces = [active_parts(project, clip, f)["face"] for f in range(clip.frames)]
        self.assertEqual([f for f, n in enumerate(faces) if n == "face_blink"], [5])
        self.assertEqual({n for n in faces if n != "face_blink"}, {"face_happy"})

    def test_thumbs_up_winks(self):
        _, project = load()
        clip = project.clips["thumbs_up"]
        used = {active_parts(project, clip, f)["face"] for f in range(clip.frames)}
        self.assertIn("face_wink", used)
        self.assertIn("face_happy", used)

    def test_props_hidden_by_default(self):
        raw, project = load()
        for n in FX:
            self.assertIn(n, raw["rig"]["bones"])
            self.assertIsNone(raw["rig"]["bones"][n]["part"])
            self.assertIn(n, raw["parts"])
            for c in ("idle", "walk"):
                clip = project.clips[c]
                for f in range(clip.frames):
                    self.assertIsNone(active_parts(project, clip, f)[n], (n, c, f))
        self.assertEqual(raw["rig"]["bones"]["fx_swirl"]["parent"], "root")
        for n in FX[:4]:
            self.assertEqual(raw["rig"]["bones"][n]["parent"], "head")

    def test_qio_shell_enabled(self):
        raw, _ = load()
        self.assertIs(raw["export"]["shell"], True)
        assert_shell_parity(self, raw)


if __name__ == "__main__":
    unittest.main()
