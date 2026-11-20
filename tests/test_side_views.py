import copy
import unittest
from pathlib import Path

import numpy as np
import yaml

from spritebuilder.animation import evaluate_pose
from spritebuilder.project import ProjectError, _voxelize, compile_project
from spritebuilder.render import render_pose

ROOT = Path(__file__).resolve().parents[1]
CUBE = "\n".join(["aaa"] * 3)
PALETTE = {"a": (255, 0, 0, 255), "b": (0, 0, 255, 255)}


def part(**views):
    spec = {"front": CUBE, "back": CUBE}
    spec.update(views)
    return spec


def render_all(project):
    clip = next(iter(project.clips))
    pose = evaluate_pose(project, project.clips[clip], 0)
    return [np.asarray(render_pose(project, pose, d)).tobytes() for d in project.export.directions]


class SideViewTests(unittest.TestCase):
    def test_side_only_unchanged(self):
        raw = yaml.safe_load((ROOT / "examples" / "humanoid.yaml").read_text())
        split = copy.deepcopy(raw)
        for spec in split["parts"].values():
            if "side" in spec:
                spec["left"] = spec["right"] = spec.pop("side")
        a = compile_project(raw, ROOT / "x.yaml")
        b = compile_project(split, ROOT / "x.yaml")
        self.assertEqual(render_all(a), render_all(b))

    def test_left_colours_plus_x(self):
        v = _voxelize("p", part(left="\n".join(["aaa"] * 3), right="\n".join(["bbb"] * 3)), PALETTE)
        colours = {tuple(p): tuple(c) for p, c in zip(v.positions + np.array([1, 0, 1]), v.colors)}
        # x=2, y=1, z=1: side-dominant (|radial z| < |radial x|)... use z at centre
        self.assertEqual(colours[(2, 1, 1)], PALETTE["a"])
        self.assertEqual(colours[(0, 1, 1)], PALETTE["b"])

    def test_side_and_left_rejected(self):
        with self.assertRaisesRegex(ProjectError, r"parts\.p: use either side or left/right, not both"):
            _voxelize("p", part(side=CUBE, left=CUBE, right=CUBE), PALETTE)

    def test_only_left_rejected(self):
        for key in ("left", "right"):
            with self.assertRaisesRegex(ProjectError, r"parts\.p: left and right must both be given"):
                _voxelize("p", part(**{key: CUBE}), PALETTE)

    def test_left_right_outline_mismatch_rejected(self):
        with self.assertRaisesRegex(ProjectError, r"parts\.p: left/right silhouettes differ at row 2, column 3"):
            _voxelize("p", part(left=CUBE, right="aaa\naa.\naaa"), PALETTE)


if __name__ == "__main__":
    unittest.main()
