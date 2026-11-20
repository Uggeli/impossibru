import copy
import http.client
import json
from pathlib import Path
import shutil
import tempfile
import threading
import unittest

import numpy as np
import yaml

from spritebuilder.animation import evaluate_pose
from spritebuilder.document import (SaveConflict, create_document, dump_document, load_document,
                                    save_document, structured_error)
from spritebuilder.editor_server import create_server
from spritebuilder.project import ProjectError, compile_project
from spritebuilder.render import render_part, render_pose


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "humanoid.yaml"


class DocumentTests(unittest.TestCase):
    def test_create_starter_document_without_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "new-character.yaml"
            document = create_document(path)
            project = document.compile()
            self.assertEqual((list(project.parts), list(project.bones), list(project.clips)),
                             (["part"], ["root"], ["idle"]))
            self.assertEqual(project.export.name, "new-character")
            with self.assertRaisesRegex(ProjectError, "already exists"):
                create_document(path)
            with self.assertRaisesRegex(ProjectError, "must end"):
                create_document(Path(directory) / "wrong.txt")

    def test_canonical_round_trip_keeps_multiline_grids_and_unknown_fields(self):
        document = load_document(FIXTURE)
        document.data["editor_extension"] = {"keep": True}
        encoded = dump_document(document.data)
        self.assertIn("front: |", encoded)
        loaded = yaml.safe_load(encoded)
        self.assertEqual(loaded, document.data)
        self.assertEqual(loaded["editor_extension"], {"keep": True})
        compile_project(loaded)

    def test_save_is_atomic_and_detects_external_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "project.yaml"
            shutil.copy(FIXTURE, path)
            document = load_document(path)
            document.data["editor_extension"] = "saved"
            new_hash = save_document(path, document.data, document.source_hash)
            self.assertEqual(load_document(path).source_hash, new_hash)
            path.write_text(path.read_text() + "\n# external change\n")
            with self.assertRaises(SaveConflict):
                save_document(path, document.data, new_hash)

    def test_invalid_document_is_not_written(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "project.yaml"
            shutil.copy(FIXTURE, path)
            document = load_document(path)
            original = path.read_bytes()
            document.data["parts"]["head"]["front"] = "."
            with self.assertRaises(ProjectError):
                save_document(path, document.data, document.source_hash)
            self.assertEqual(path.read_bytes(), original)

    def test_structured_grid_error_has_location(self):
        error = structured_error(ProjectError("parts.head.front uses unknown palette character 'x' at row 2, column 3"))
        self.assertEqual(error["path"], "parts.head.front")
        self.assertEqual((error["row"], error["column"]), (2, 3))

    def test_isolated_part_preview(self):
        project = load_document(FIXTURE).compile()
        image = render_part(project, "head", 180, 128)
        self.assertEqual(image.size, (128, 128))
        self.assertIsNotNone(image.getbbox())

    def test_axis_aligned_part_has_no_transparent_pixel_seams(self):
        project = load_document(FIXTURE).compile()
        for bone in project.bones.values():
            if bone.part != "torso":
                bone.part = None
        pose = evaluate_pose(project, project.clips["idle"], 0)
        alpha = np.asarray(render_pose(project, pose, 0))[:, :, 3] > 0
        for row in alpha:
            occupied = np.flatnonzero(row)
            if len(occupied):
                self.assertTrue(row[occupied[0]:occupied[-1] + 1].all())


class EditorAPITests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "project.yaml"
        shutil.copy(FIXTURE, self.path)
        try:
            self.server, self.session = create_server(self.path)
        except PermissionError as exc:
            self.directory.cleanup()
            self.skipTest(f"local sockets unavailable: {exc}")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        if hasattr(self, "server"):
            self.server.shutdown()
            self.server.server_close()
            self.thread.join(2)
        self.directory.cleanup()

    def call(self, method, path, payload=None, token=True, host=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        body = json.dumps(payload) if payload is not None else None
        headers = {}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if token:
            headers["X-SpriteBuilder-Token"] = self.session.token
        if host:
            headers["Host"] = host
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        content = response.read()
        connection.close()
        return response.status, response.getheader("Content-Type"), content

    def test_project_validate_preview_and_save(self):
        status, content_type, body = self.call("GET", "/")
        self.assertEqual((status, content_type), (200, "text/html"))
        self.assertIn(b"Impossibru!", body)
        status, _, body = self.call("GET", "/api/project")
        self.assertEqual(status, 200)
        payload = json.loads(body)
        document = payload["document"]
        status, _, body = self.call("POST", "/api/validate", {"document": document})
        self.assertEqual((status, json.loads(body)["valid"]), (200, True))
        status, content_type, body = self.call("POST", "/api/preview", {
            "document": document, "mode": "part", "part": "head", "direction": 180})
        self.assertEqual(status, 200)
        self.assertEqual(content_type, "image/png")
        self.assertTrue(body.startswith(b"\x89PNG"))
        status, content_type, body = self.call("POST", "/api/preview", {
            "document": document, "mode": "character", "clip": "walk", "frame": 3, "direction": 45})
        self.assertEqual((status, content_type), (200, "image/png"))
        self.assertTrue(body.startswith(b"\x89PNG"))
        document["editor_extension"] = {"api": True}
        status, _, body = self.call("PUT", "/api/project", {
            "document": document, "source_hash": payload["source_hash"]})
        self.assertEqual(status, 200)
        self.assertTrue(yaml.safe_load(self.path.read_text())["editor_extension"]["api"])

    def test_export_builds_posted_document_not_disk_file(self):
        from spritebuilder.exporter import build_project
        import base64
        status, _, body = self.call("GET", "/api/project")
        document = json.loads(body)["document"]
        edited = copy.deepcopy(document)
        # recolour a used palette entry so the render differs from the file on disk
        edited["palette"]["r"] = "#00ff00"
        status, _, body = self.call("POST", "/api/export", {"document": edited})
        self.assertEqual(status, 200)
        result = json.loads(body)
        project = compile_project(edited, self.path)
        with tempfile.TemporaryDirectory() as out:
            png_path, json_path = build_project(project, Path(out))
            expected_png = png_path.read_bytes()
            expected_meta = json.loads(json_path.read_text())
            expected_name = png_path.stem
        self.assertEqual(base64.b64decode(result["png"]), expected_png)
        self.assertEqual(result["json"], expected_meta)
        self.assertEqual(result["name"], expected_name)
        with tempfile.TemporaryDirectory() as out:
            disk_png, _ = build_project(compile_project(document, self.path), Path(out))
            self.assertNotEqual(base64.b64decode(result["png"]), disk_png.read_bytes())

    def test_export_rejects_broken_document(self):
        status, _, body = self.call("GET", "/api/project")
        document = json.loads(body)["document"]
        document["parts"] = "nope"
        status, _, _ = self.call("POST", "/api/export", {"document": document})
        self.assertEqual(status, 422)

    def test_export_rejects_path_escaping_name(self):
        status, _, body = self.call("GET", "/api/project")
        document = json.loads(body)["document"]
        document.setdefault("export", {})["name"] = "../escape-me"
        before = set(Path(tempfile.gettempdir()).glob("escape-me*"))
        status, _, _ = self.call("POST", "/api/export", {"document": document})
        self.assertEqual(status, 422)
        self.assertEqual(set(Path(tempfile.gettempdir()).glob("escape-me*")), before)

    def test_auth_and_host_rejections(self):
        status, _, _ = self.call("GET", "/api/project", token=False)
        self.assertEqual(status, 403)

    def test_rig_preview_drag_and_reparent(self):
        _, _, body = self.call("GET", "/api/project")
        document = json.loads(body)["document"]
        status, content_type, body = self.call("POST", "/api/rig/preview", {
            "document": document, "mode": "rest", "direction": 37})
        self.assertEqual((status, content_type), (200, "application/json; charset=utf-8"))
        preview = json.loads(body)
        self.assertTrue(preview["png"].startswith("iVBOR"))
        self.assertEqual(preview["overlay"]["width"], document["export"]["size"][0] * 2)
        self.assertEqual(preview["overlay"]["height"], document["export"]["size"][1] * 2)
        self.assertEqual(preview["overlay"]["offset"],
                         [document["export"]["size"][0] / 2,
                          document["export"]["size"][1] / 2])
        self.assertEqual(len(preview["overlay"]["bones"]), len(document["rig"]["bones"]))
        head = next(b for b in preview["overlay"]["bones"] if b["name"] == "head")
        offset = preview["overlay"]["offset"]
        status, _, body = self.call("POST", "/api/rig/drag", {
            "document": document, "kind": "joint", "name": "head",
            "screen": [head["x"] - offset[0] + 3, head["y"] - offset[1]],
            "depth": head["depth"],
            "direction": 37, "mode": "rest"})
        self.assertEqual(status, 200)
        self.assertNotEqual(json.loads(body)["document"]["rig"]["bones"]["head"]["translation"],
                            document["rig"]["bones"]["head"]["translation"])
        status, _, body = self.call("POST", "/api/rig/reparent", {
            "document": document, "bone": "head", "parent": "root"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["document"]["rig"]["bones"]["head"]["parent"], "root")
        status, _, _ = self.call("POST", "/api/rig/drag", {
            "document": document, "kind": "joint", "name": "head", "screen": [1]})
        self.assertEqual(status, 422)
        status, _, _ = self.call("POST", "/api/rig/preview", {
            "document": document}, token=False)
        self.assertEqual(status, 403)
        status, _, _ = self.call("GET", "/api/project", host="attacker.example")
        self.assertEqual(status, 403)

    def test_create_new_project_beside_current_file(self):
        status, _, body = self.call("POST", "/api/project/new", {"filename": "fresh.yaml"})
        self.assertEqual(status, 201)
        payload = json.loads(body)
        self.assertEqual(Path(payload["summary"]["path"]), self.path.parent / "fresh.yaml")
        self.assertTrue((self.path.parent / "fresh.yaml").exists())
        self.assertEqual(list(payload["document"]["animations"]), ["idle"])
        status, _, _ = self.call("POST", "/api/project/new", {"filename": "fresh.yaml"})
        self.assertEqual(status, 422)
        status, _, _ = self.call("POST", "/api/project/new", {"filename": "../escape.yaml"})
        self.assertEqual(status, 422)

    def test_rig_autorig_endpoint_humanoid(self):
        _, _, body = self.call("GET", "/api/project")
        document = json.loads(body)["document"]
        status, content_type, body = self.call("POST", "/api/rig/autorig", {
            "document": document, "preset": "humanoid"})
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertIn("document", payload)
        self.assertIn("project", payload)
        self.assertIn("rig", payload)
        self.assertEqual(len(payload["document"]["rig"]["bones"]), 13)
        self.assertIn("left_leg", payload["document"]["rig"]["ik_chains"])

    def test_rig_autorig_endpoint_quadruped_and_project_key(self):
        _, _, body = self.call("GET", "/api/project")
        document = json.loads(body)["document"]
        status, _, body = self.call("POST", "/api/rig/autorig", {
            "project": document, "preset": "quadruped"})
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertIn("front_left_leg", payload["rig"]["ik_chains"])

    def test_rig_autorig_invalid_preset_returns_422(self):
        _, _, body = self.call("GET", "/api/project")
        document = json.loads(body)["document"]
        status, _, body = self.call("POST", "/api/rig/autorig", {
            "document": document, "preset": "invalid_alien_preset"})
        self.assertEqual(status, 422)
        payload = json.loads(body)
        self.assertFalse(payload["valid"])


if __name__ == "__main__":
    unittest.main()


class EditorSliceHighlightTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "qio.yaml"
        shutil.copy(Path(__file__).resolve().parents[1] / "examples" / "qio.yaml", self.path)
        try:
            self.server, self.session = create_server(self.path)
        except PermissionError as exc:
            self.directory.cleanup()
            self.skipTest(f"local sockets unavailable: {exc}")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        if hasattr(self, "server"):
            self.server.shutdown()
            self.server.server_close()
            self.thread.join(2)
        self.directory.cleanup()

    def preview(self, document, **extra):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        body = json.dumps({"document": document, "mode": "part", "part": "head", "direction": 0, **extra})
        connection.request("POST", "/api/preview", body=body, headers={
            "Content-Type": "application/json", "X-SpriteBuilder-Token": self.session.token})
        response = connection.getresponse()
        content = response.read()
        connection.close()
        self.assertEqual(response.status, 200)
        return content

    def test_grid_part_preview_highlights_requested_slice(self):
        document = yaml.safe_load(self.path.read_text())
        plain = self.preview(document)
        lit = self.preview(document, slice=10)
        self.assertNotEqual(plain, lit)
        self.assertEqual(self.preview(document, slice=10), lit)
        self.assertNotEqual(self.preview(document, slice=3), lit)
