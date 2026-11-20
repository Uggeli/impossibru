import sys
import unittest
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_shell import assert_shell_parity  # noqa: E402

from spritebuilder.animation import active_parts  # noqa: E402
from spritebuilder.project import compile_project  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
QIO = ROOT / "examples" / "qio.yaml"


def load():
    raw = yaml.safe_load(QIO.read_text(encoding="utf-8"))
    return raw, compile_project(raw, QIO)


class QioTests(unittest.TestCase):
    def test_qio_has_expression_parts(self):
        raw, _ = load()
        head = raw["parts"]["head"]
        for name in ("head_blink", "head_wink"):
            self.assertIn(name, raw["parts"])
            self.assertEqual(raw["parts"][name]["size"], head["size"])
            self.assertEqual(raw["parts"][name]["pivot"], head["pivot"])
            self.assertNotEqual(raw["parts"][name]["voxels"], head["voxels"])

    def test_idle_blinks(self):
        _, project = load()
        clip = project.clips["idle"]
        blink = [f for f in range(clip.frames) if active_parts(project, clip, f)["head"] == "head_blink"]
        self.assertEqual(blink, [5])
        for f in range(clip.frames):
            if f not in blink:
                self.assertEqual(active_parts(project, clip, f)["head"], "head")

    def test_thumbs_up_winks(self):
        _, project = load()
        clip = project.clips["thumbs_up"]
        used = {f: active_parts(project, clip, f)["head"] for f in range(clip.frames)}
        self.assertIn("head_wink", used.values())
        self.assertIn("head", used.values())

    def test_qio_shell_enabled(self):
        raw, _ = load()
        self.assertIs(raw["export"]["shell"], True)
        assert_shell_parity(self, raw)


if __name__ == "__main__":
    unittest.main()
