import copy
import json
import time
import unittest
from pathlib import Path

import numpy as np
import yaml

from spritebuilder.animation import evaluate_pose
from spritebuilder.project import compile_project
from spritebuilder.render import render_pose

ROOT = Path(__file__).resolve().parents[1]


def shell_parity_stats(raw, full_clip_frames=None):
    """Render raw with export.shell False and True; return (frames, mask_mismatches, rgb_diff, opaque).

    Every direction is rendered. For each clip, `full_clip_frames` names the clip whose every frame is
    rendered (default: the first); other clips render frame 0 only.
    """
    raws = {}
    for flag in (False, True):
        variant = copy.deepcopy(raw)
        variant.setdefault("export", {})["shell"] = flag
        raws[flag] = compile_project(variant, ROOT / "shell-parity.yaml")
    full, shelled = raws[False], raws[True]
    names = list(full.export.animations)
    dense = full_clip_frames or names[0]
    stats = dict(frames=0, mask_mismatches=0, rgb_diff=0, opaque=0, worst_ratio=0.0)
    for name in names:
        frames = range(full.clips[name].frames) if name == dense else [0]
        for frame in frames:
            poses = [evaluate_pose(p, p.clips[name], frame) for p in (full, shelled)]
            for direction in full.export.directions:
                a = np.asarray(render_pose(full, poses[0], direction))
                b = np.asarray(render_pose(shelled, poses[1], direction))
                opaque_a, opaque_b = a[:, :, 3] > 0, b[:, :, 3] > 0
                mismatch = int((opaque_a != opaque_b).sum())
                both = opaque_a & opaque_b
                diff = int((a[both][:, :3] != b[both][:, :3]).any(axis=1).sum())
                count = int(opaque_a.sum())
                stats["frames"] += 1
                stats["mask_mismatches"] += mismatch
                stats["rgb_diff"] += diff
                stats["opaque"] += count
                stats["worst_ratio"] = max(stats["worst_ratio"], diff / max(count, 1))
    return stats


def assert_shell_parity(testcase, raw, max_color_ratio=0.02, full_clip_frames=None):
    """Shell must give the same opaque pixels and differ in colour on <= 2% of opaque pixels."""
    stats = shell_parity_stats(raw, full_clip_frames)
    testcase.assertGreater(stats["frames"], 0)
    testcase.assertEqual(stats["mask_mismatches"], 0, stats)
    testcase.assertLessEqual(stats["rgb_diff"], max_color_ratio * stats["opaque"], stats)
    testcase.assertLessEqual(stats["worst_ratio"], max_color_ratio, stats)
    return stats


class ShellTests(unittest.TestCase):
    def test_shell_matches_full_render_on_voxel_buddy(self):
        raw = yaml.safe_load((ROOT / "examples" / "voxel_buddy.yaml").read_text(encoding="utf-8"))
        assert_shell_parity(self, raw)

    def test_shell_matches_on_mundus_orc(self):
        raw = json.loads((ROOT / "examples" / "mundus" / "orc-male-adult.json").read_text(encoding="utf-8"))
        assert_shell_parity(self, raw)

    def test_shell_still_removes_voxels(self):
        n = 9
        raw = {"palette": {"a": "#ff0000"},
               "parts": {"cube": {"size": [n, n, n], "voxels": "%da" % (n * n * n)}},
               "rig": {"bones": {"root": {"part": "cube"}}},
               "animations": {"idle": {"frames": 1, "fps": 1, "loop": True, "bones": {}}},
               "export": {"size": [64, 64], "origin": [32, 60], "scale": 2}}
        counts = []
        for flag in (False, True):
            variant = copy.deepcopy(raw)
            variant["export"]["shell"] = flag
            counts.append(len(compile_project(variant, ROOT / "x.yaml").parts["cube"].positions))
        self.assertEqual(counts[0], 729)
        self.assertLess(counts[1], 0.6 * counts[0])


if __name__ == "__main__":
    unittest.main()
