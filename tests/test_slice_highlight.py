"""Slice highlight in Python-rendered part previews (spritebuilder edit mode)."""
import io
import unittest
from pathlib import Path

import numpy as np
import yaml
from PIL import Image

from spritebuilder.project import compile_project
from spritebuilder.render import render_part

ROOT = Path(__file__).resolve().parents[1]
HIGHLIGHT = (102, 217, 163)


def _grid_doc():
    # 3x3x3 solid cube of 'a'; slice 1 is the middle layer
    return {
        "palette": {"a": "#202020"},
        "parts": {"cube": {"size": [3, 3, 3], "voxels": "27a"}},
        "rig": {"bones": {"root": {"part": "cube"}}},
        "animations": {"idle": {"frames": 1, "fps": 1}},
    }


def _greenish(image):
    px = np.asarray(image.convert("RGBA")).astype(int)
    r, g, b, a = px[..., 0], px[..., 1], px[..., 2], px[..., 3]
    return (a > 0) & (g > r + 40) & (g > b + 20)


class RenderPartHighlightTests(unittest.TestCase):
    def setUp(self):
        self.project = compile_project(_grid_doc(), ROOT / "slice.yaml")

    def test_no_highlight_by_default(self):
        self.assertFalse(_greenish(render_part(self.project, "cube", 0)).any())

    def test_highlight_marks_only_that_layer(self):
        plain = np.asarray(render_part(self.project, "cube", 0))
        lit = render_part(self.project, "cube", 0, highlight_y=1.0)
        mask = _greenish(lit)
        self.assertTrue(mask.any())
        rows = np.flatnonzero(mask.any(axis=1))
        opaque_rows = np.flatnonzero((plain[..., 3] > 0).any(axis=1))
        height = len(opaque_rows)
        # the lit band is the middle third of the cube's rows, not the top or bottom
        self.assertGreater(rows.min(), opaque_rows.min() + height // 4)
        self.assertLess(rows.max(), opaque_rows.max() - height // 4)

    def test_highlight_out_of_range_is_noop(self):
        plain = np.asarray(render_part(self.project, "cube", 0))
        lit = np.asarray(render_part(self.project, "cube", 0, highlight_y=10.0))
        self.assertTrue((plain == lit).all())


if __name__ == "__main__":
    unittest.main()
