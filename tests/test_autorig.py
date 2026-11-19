import copy
from pathlib import Path
import tempfile
import unittest

import numpy as np
import yaml

from spritebuilder.autorig import (
    ContactSurface,
    PartAnalysis,
    analyze_contact_surface,
    analyze_part,
    analyze_project,
    autorig_document_data,
    autorig_project,
    find_contact_surfaces,
    generate_creature_rig,
    generate_humanoid_rig,
    generate_quadruped_rig,
)
from spritebuilder.cli import main
from spritebuilder.document import EditableDocument, autorig_document, load_document
from spritebuilder.exporter import build_project
from spritebuilder.project import ProjectError, compile_project, load_project

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "humanoid.yaml"


class AutorigGeometryTests(unittest.TestCase):
    def setUp(self):
        self.project = load_project(EXAMPLE)

    def test_part_analysis_bounding_box_centroid_and_silhouettes(self):
        analyses = analyze_project(self.project)
        self.assertIn("torso", analyses)
        self.assertIn("head", analyses)

        torso_info = analyses["torso"]
        self.assertIsInstance(torso_info, PartAnalysis)
        self.assertEqual(torso_info.name, "torso")
        self.assertGreater(torso_info.volume, 0)
        self.assertEqual(torso_info.height, 10.0)
        self.assertEqual(torso_info.width, 8.0)
        self.assertEqual(torso_info.depth, 4.0)

        # Check silhouette masks
        self.assertEqual(torso_info.silhouette_front.shape, (10, 8))
        self.assertEqual(torso_info.silhouette_back.shape, (10, 8))
        self.assertEqual(torso_info.silhouette_side.shape, (10, 4))
        self.assertTrue(torso_info.silhouette_front.any())

    def test_contact_surface_analysis_between_adjacent_parts(self):
        head = self.project.parts["head"]
        torso = self.project.parts["torso"]

        contact = analyze_contact_surface(torso, head)
        self.assertIsInstance(contact, ContactSurface)
        self.assertEqual(contact.part_a, "torso")
        self.assertEqual(contact.part_b, "head")
        self.assertGreaterEqual(contact.contact_count, 1)

        # Contact point on torso should be near the top of torso
        self.assertAlmostEqual(contact.contact_point_a[1], 9.0, delta=1.5)
        # Contact point on head should be near bottom of head
        self.assertAlmostEqual(contact.contact_point_b[1], 0.0, delta=1.5)

        surfaces = find_contact_surfaces(self.project)
        self.assertGreater(len(surfaces), 0)


class AutorigPresetTests(unittest.TestCase):
    def setUp(self):
        self.project = load_project(EXAMPLE)

    def test_humanoid_preset_generator(self):
        rig = generate_humanoid_rig(self.project)
        bones = rig["bones"]
        ik = rig["ik_chains"]

        self.assertIn("root", bones)
        self.assertIn("torso", bones)
        self.assertIn("head", bones)
        self.assertIn("left_upper_arm", bones)
        self.assertIn("left_lower_arm", bones)
        self.assertIn("right_upper_arm", bones)
        self.assertIn("right_lower_arm", bones)
        self.assertIn("left_upper_leg", bones)
        self.assertIn("left_lower_leg", bones)
        self.assertIn("left_foot", bones)

        self.assertIn("left_leg", ik)
        self.assertIn("right_leg", ik)
        self.assertEqual(ik["left_leg"], {"root": "left_upper_leg", "mid": "left_lower_leg", "end": "left_foot"})

    def test_quadruped_preset_generator(self):
        rig = generate_quadruped_rig(self.project)
        bones = rig["bones"]
        ik = rig["ik_chains"]

        self.assertIn("root", bones)
        self.assertIn("torso", bones)
        self.assertIn("front_left_upper_leg", bones)
        self.assertIn("back_left_upper_leg", bones)
        self.assertIn("front_left_leg", ik)

    def test_creature_preset_generator(self):
        rig = generate_creature_rig(self.project)
        bones = rig["bones"]
        self.assertIn("root", bones)
        self.assertIn("torso", bones)


class AutorigDocumentIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.document = load_document(EXAMPLE)

    def test_autorig_document_and_project_methods(self):
        # Test document autorig
        updated_data = self.document.autorig("humanoid")
        compiled = compile_project(updated_data)
        self.assertEqual(len(compiled.bones), 13)
        self.assertIn("left_leg", compiled.ik_chains)

        # Test project autorig
        orig_project = load_project(EXAMPLE)
        rigged_project = orig_project.autorig("humanoid")
        self.assertEqual(len(rigged_project.bones), 13)
        self.assertIn("right_leg", rigged_project.ik_chains)

    def test_autorig_preserves_validity_and_exportability(self):
        rigged_doc = autorig_document(self.document, preset="humanoid")
        compiled = compile_project(rigged_doc)
        with tempfile.TemporaryDirectory() as tmpdir:
            png, json_meta = build_project(compiled, Path(tmpdir))
            self.assertTrue(png.exists())
            self.assertTrue(json_meta.exists())


class AutorigCLITests(unittest.TestCase):
    def test_cli_autorig_command_with_output(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            out_file = Path(tmpdir) / "autorigged.yaml"
            ret = main(["autorig", str(EXAMPLE), "--preset", "humanoid", "--output", str(out_file)])
            self.assertEqual(ret, 0)
            self.assertTrue(out_file.exists())

            # Load generated file and verify compilation
            loaded_proj = load_project(out_file)
            self.assertEqual(len(loaded_proj.bones), 13)
            self.assertIn("left_leg", loaded_proj.ik_chains)

    def test_cli_autorig_inplace(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            copy_path = Path(tmpdir) / "humanoid_copy.yaml"
            copy_path.write_text(EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")

            ret = main(["autorig", str(copy_path), "--preset", "humanoid"])
            self.assertEqual(ret, 0)

            loaded_proj = load_project(copy_path)
            self.assertEqual(len(loaded_proj.bones), 13)


if __name__ == "__main__":
    unittest.main()
