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


CLIPS = {  # name: (loop, faces that must appear, props that must appear)
    "idle": (True, {"face_happy", "face_blink"}, set()),
    "float": (True, set(), {"fx_swirl"}),
    "listen": (True, set(), set()),
    "think": (True, {"face_thinking"}, {"fx_question"}),
    "present": (False, {"face_excited"}, {"fx_stars"}),
    "confused": (False, {"face_worried"}, {"fx_question"}),
    "celebrate": (False, {"face_excited"}, {"fx_stars"}),
    "wave": (False, {"face_wink"}, set()),
    "surprised": (False, {"face_surprised"}, {"fx_exclaim"}),
    "content": (True, {"face_content"}, {"fx_note"}),
    "thumbs_up": (False, {"face_wink"}, set()),
    "walk": (True, set(), set()),
}


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

    def test_clip_vocabulary(self):
        _, project = load()
        for name, (loop, faces, props) in CLIPS.items():
            with self.subTest(clip=name):
                self.assertIn(name, project.clips)
                clip = project.clips[name]
                self.assertEqual(clip.loop, loop)
                frames = [active_parts(project, clip, f) for f in range(clip.frames)]
                self.assertLessEqual(faces, {p["face"] for p in frames})
                for fx in FX:
                    shown = [f for f, p in enumerate(frames) if p[fx] is not None]
                    if fx in props:
                        self.assertTrue(shown, fx)
                    else:
                        self.assertEqual(shown, [], fx)

    def test_no_clip_touches_frame_border(self):
        _, project = load()
        for name in project.export.animations:
            clip = project.clips[name]
            for f in range(clip.frames):
                pose = evaluate_pose(project, clip, f)
                parts = active_parts(project, clip, f)
                for yaw in project.export.directions:
                    a = np.asarray(render_pose(project, pose, yaw, parts=parts))[:, :, 3]
                    edge = max(a[0].max(), a[-1].max(), a[:, 0].max(), a[:, -1].max())
                    self.assertEqual(edge, 0, (name, f, yaw))

    def test_no_root_yaw(self):
        raw, _ = load()
        for name, clip in raw["animations"].items():
            bones = clip["bones"]
            self.assertNotIn("rotation", bones.get("root", {}), name)
            for k in bones.get("torso", {}).get("rotation", []):
                self.assertLessEqual(abs(k["value"][1]), 10, name)

    def test_point_clips_reach_target_side_and_height(self):
        _, project = load()
        yaw = {"left": 315, "right": 45}
        for side in ("left", "right"):
            arm = "left" if side == "right" else "right"  # the arm nearer the target
            for height in ("up", "level", "down"):
                with self.subTest(side=side, height=height):
                    clip = project.clips[f"point_{side}_{height}"]
                    self.assertFalse(clip.loop)
                    pose = evaluate_pose(project, clip, clip.frames - 1)
                    cam = camera_yaw(yaw[side])
                    hand = cam @ pose[f"{arm}_hand"][:3, 3]
                    head = cam @ pose["head"][:3, 3]
                    shoulder_y = (cam @ pose[f"{arm}_arm"][:3, 3])[1]
                    dx = hand[0] - head[0]
                    self.assertGreater(dx if side == "right" else -dx, 4)
                    dy = hand[1] - shoulder_y
                    if height == "up":
                        self.assertGreater(dy, 3)
                    elif height == "level":
                        self.assertLess(abs(dy), 3)
                    else:
                        self.assertLess(dy, -3)

    def test_point_arm_visible_in_its_view(self):
        _, project = load()
        yaw = {"left": 315, "right": 45}
        for side in ("left", "right"):
            arm = "left" if side == "right" else "right"
            for height in ("up", "level", "down"):
                with self.subTest(side=side, height=height):
                    clip = project.clips[f"point_{side}_{height}"]
                    last = clip.frames - 1
                    pose = evaluate_pose(project, clip, last)
                    parts = active_parts(project, clip, last)
                    hidden = {**parts, f"{arm}_arm": None, f"{arm}_hand": None}
                    if arm == "left":
                        hidden["tablet"] = None  # the tablet rides on the left hand
                    a = np.asarray(render_pose(project, pose, yaw[side], parts=parts))
                    b = np.asarray(render_pose(project, pose, yaw[side], parts=hidden))
                    self.assertGreater(int((a != b).any(axis=2).sum()), 60)

    def test_swirl_spins_forward(self):
        # rotation tracks take the shortest path, so each key step must turn less than 180 degrees
        raw, _ = load()
        keys = raw["animations"]["float"]["bones"]["fx_swirl"]["rotation"]
        ys = [k["value"][1] for k in keys] + [keys[0]["value"][1] + 360]
        steps = [b - a for a, b in zip(ys, ys[1:])]
        self.assertTrue(all(0 < d < 180 for d in steps), steps)

    def test_qio_shell_enabled(self):
        raw, _ = load()
        self.assertIs(raw["export"]["shell"], True)
        assert_shell_parity(self, raw)


if __name__ == "__main__":
    unittest.main()
