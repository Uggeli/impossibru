import copy
import tempfile
import unittest
from pathlib import Path

import numpy as np
import yaml
from PIL import Image

from spritebuilder.animation import active_parts, evaluate_pose
from spritebuilder.exporter import build_project
from spritebuilder.project import ProjectError, compile_project
from spritebuilder.render import render_pose

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples" / "humanoid.yaml"


def _raw(keys, loop=True, extra=None):
    raw = yaml.safe_load(EXAMPLE.read_text())
    head = copy.deepcopy(raw["parts"]["head"])
    for view in ("front", "back", "side"):
        head[view] = head[view].replace("e", "r")
    raw["parts"]["head_alt"] = head
    clip = raw["animations"]["idle"]
    clip["loop"] = loop
    clip["bones"].setdefault("head", {})["part"] = keys
    if extra:
        extra(raw)
    return raw


def _project(keys, loop=True):
    return compile_project(_raw(keys, loop), EXAMPLE)


def _swap(frame, value):
    return {"frame": frame, "value": value}


class PartSwapTests(unittest.TestCase):
    def test_before_first_key_uses_rig_part(self):
        p = _project([_swap(2, "head_alt")])
        clip = p.clips["idle"]
        self.assertEqual(active_parts(p, clip, 0)["head"], "head")
        self.assertEqual(active_parts(p, clip, 1)["head"], "head")

    def test_step_hold_until_next_key(self):
        p = _project([_swap(2, "head_alt")])
        clip = p.clips["idle"]
        self.assertEqual(active_parts(p, clip, 2)["head"], "head_alt")
        self.assertEqual(active_parts(p, clip, 3)["head"], "head_alt")

    def test_loop_wraps_last_key(self):
        p = _project([_swap(1, "head_alt"), _swap(3, "head")])
        self.assertEqual(active_parts(p, p.clips["idle"], 0)["head"], "head")
        p = _project([_swap(1, "head"), _swap(3, "head_alt")])
        self.assertEqual(active_parts(p, p.clips["idle"], 0)["head"], "head_alt")

    def test_no_clip_uses_rig_part(self):
        p = _project([_swap(0, "head_alt")])
        self.assertEqual(active_parts(p, None, 0)["head"], "head")

    def test_null_hides_part(self):
        p = _project([_swap(1, None)])
        clip = p.clips["idle"]
        pose = evaluate_pose(p, clip, 1)
        shown = np.array(render_pose(p, pose, 0))
        hidden = np.array(render_pose(p, pose, 0, parts=active_parts(p, clip, 1)))
        self.assertEqual(active_parts(p, clip, 1)["head"], None)
        self.assertFalse(np.array_equal(shown, hidden))
        opaque = lambda a: int((a[..., 3] > 0).sum())
        self.assertLess(opaque(hidden), opaque(shown))

    def test_missing_part_rejected(self):
        with self.assertRaisesRegex(ProjectError, "references missing part 'nope'"):
            _project([_swap(0, "nope")])

    def test_bad_value_rejected(self):
        with self.assertRaisesRegex(ProjectError, r"part\[0\]\.value must be a part name or null"):
            _project([_swap(0, 5)])

    def test_interpolation_rejected(self):
        key = dict(_swap(0, "head_alt"), interpolation="linear")
        with self.assertRaisesRegex(
                ProjectError,
                r"animations\.idle\.bones\.head\.part\[0\]\.interpolation is not allowed on part keys"):
            _project([key])

    def _atlas(self, keys, trim):
        def extra(raw):
            raw["export"]["trim"] = trim
            raw["export"]["animations"] = ["idle"]
            raw["export"]["directions"] = [0]
            raw["animations"]["idle"]["bones"] = {"head": raw["animations"]["idle"]["bones"]["head"]}
        p = compile_project(_raw(keys, extra=extra), EXAMPLE)
        with tempfile.TemporaryDirectory() as out:
            png, _ = build_project(p, Path(out))
            return np.array(Image.open(png)), p.export.width

    def test_export_uses_swapped_part(self):
        atlas, w = self._atlas([_swap(2, "head_alt")], False)
        self.assertTrue(np.array_equal(atlas[:, 0:w], atlas[:, w:2 * w]))
        self.assertFalse(np.array_equal(atlas[:, w:2 * w], atlas[:, 2 * w:3 * w]))

    def test_trimmed_export_uses_swapped_part(self):
        swapped, _ = self._atlas([_swap(2, "head_alt")], True)
        plain, _ = self._atlas([_swap(2, "head")], True)
        self.assertFalse(swapped.shape == plain.shape and np.array_equal(swapped, plain))

    def test_unswapped_projects_unchanged(self):
        p = compile_project(yaml.safe_load(EXAMPLE.read_text()), EXAMPLE)
        clip = p.clips["walk"]
        for frame in range(clip.frames):
            pose = evaluate_pose(p, clip, frame)
            a = render_pose(p, pose, 45).tobytes()
            b = render_pose(p, pose, 45, parts=active_parts(p, clip, frame)).tobytes()
            self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()
