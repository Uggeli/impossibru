import copy
import unittest
from pathlib import Path

import yaml

from spritebuilder.project import ProjectError, compile_project

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "humanoid.yaml"
NAME_MSG = "export.name must be a plain file name (no path separators)"


def _raw():
    return yaml.safe_load(EXAMPLE.read_text())


class FinalReviewTests(unittest.TestCase):
    def test_export_name_must_be_plain(self):
        for bad in ["", "../x", "a/b", "a\\b", "/abs", ".", "..", "C:\\x"]:
            raw = _raw()
            raw.setdefault("export", {})["name"] = bad
            with self.assertRaises(ProjectError, msg=repr(bad)) as ctx:
                compile_project(raw, EXAMPLE)
            self.assertEqual(str(ctx.exception), NAME_MSG)

    def test_export_name_plain_ok(self):
        raw = _raw()
        raw.setdefault("export", {})["name"] = "my.sheet-1"
        self.assertEqual(compile_project(raw, EXAMPLE).export.name, "my.sheet-1")
