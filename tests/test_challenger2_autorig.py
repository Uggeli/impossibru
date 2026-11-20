"""Adversarial stress-testing suite for Backend Autorig API Route & Integration (Challenger 2)."""
from __future__ import annotations

import json
import socket
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path

from spritebuilder.editor_server import create_server
from spritebuilder.project import compile_project, ProjectError
from spritebuilder.autorig import autorig_document_data, generate_rig


SAMPLE_PROJECT = {
    "palette": {"x": "#66D9A3", "y": "#FF5555", "z": "#5555FF"},
    "parts": {
        "torso": {
            "pivot": [1.5, 0, 1.5],
            "front": "....\n.xx.\n.xx.\n....",
            "back": "....\n.xx.\n.xx.\n....",
            "side": "....\n.xx.\n.xx.\n....",
        },
        "head": {
            "pivot": [1.5, 0, 1.5],
            "front": "....\n.yy.\n.yy.\n....",
            "back": "....\n.yy.\n.yy.\n....",
            "side": "....\n.yy.\n.yy.\n....",
        },
        "upper_arm_l": {
            "pivot": [0.5, 0, 0.5],
            "front": ".x\n.x",
            "back": ".x\n.x",
            "side": ".x\n.x",
        },
        "lower_arm_l": {
            "pivot": [0.5, 0, 0.5],
            "front": ".x\n.x",
            "back": ".x\n.x",
            "side": ".x\n.x",
        },
        "upper_arm_r": {
            "pivot": [0.5, 0, 0.5],
            "front": ".x\n.x",
            "back": ".x\n.x",
            "side": ".x\n.x",
        },
        "lower_arm_r": {
            "pivot": [0.5, 0, 0.5],
            "front": ".x\n.x",
            "back": ".x\n.x",
            "side": ".x\n.x",
        },
        "upper_leg_l": {
            "pivot": [0.5, 0, 0.5],
            "front": ".z\n.z",
            "back": ".z\n.z",
            "side": ".z\n.z",
        },
        "lower_leg_l": {
            "pivot": [0.5, 0, 0.5],
            "front": ".z\n.z",
            "back": ".z\n.z",
            "side": ".z\n.z",
        },
        "foot_l": {
            "pivot": [0.5, 0, 0.5],
            "front": ".z\n.z",
            "back": ".z\n.z",
            "side": ".z\n.z",
        },
        "upper_leg_r": {
            "pivot": [0.5, 0, 0.5],
            "front": ".z\n.z",
            "back": ".z\n.z",
            "side": ".z\n.z",
        },
        "lower_leg_r": {
            "pivot": [0.5, 0, 0.5],
            "front": ".z\n.z",
            "back": ".z\n.z",
            "side": ".z\n.z",
        },
        "foot_r": {
            "pivot": [0.5, 0, 0.5],
            "front": ".z\n.z",
            "back": ".z\n.z",
            "side": ".z\n.z",
        },
    },
    "rig": {
        "bones": {
            "root": {"part": "torso", "translation": [0, 0, 0], "rotation": [0, 0, 0]}
        },
        "ik_chains": {},
    },
    "animations": {
        "idle": {
            "frames": 4,
            "fps": 10,
            "bones": {
                "root": {
                    "translation": [
                        {"frame": 0, "value": [0, 0, 0]},
                        {"frame": 3, "value": [0, 1, 0]},
                    ]
                }
            },
            "ik": {},
        }
    },
    "export": {
        "name": "character",
        "size": [64, 64],
        "scale": 2,
        "origin": [32, 50],
        "directions": [0, 90, 180, 270],
        "animations": ["idle"],
    },
}


class Challenger2AutorigAPITests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project_path = Path(self.temp_dir.name) / "project.yaml"
        # Save sample project YAML
        import yaml
        self.project_path.write_text(yaml.dump(SAMPLE_PROJECT), encoding="utf-8")
        self.server, self.session = create_server(self.project_path, port=0)
        self.port = self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp_dir.cleanup()

    def _request(self, method: str, path: str, payload: dict | str | None = None,
                 token: str | None = "__USE_SESSION__", host: str = "127.0.0.1"):
        conn = HTTPConnection(f"127.0.0.1:{self.port}", timeout=5)
        headers = {}
        if token == "__USE_SESSION__":
            headers["X-SpriteBuilder-Token"] = self.session.token
        elif token is not None:
            headers["X-SpriteBuilder-Token"] = token

        if host:
            headers["Host"] = host

        body_bytes = None
        if payload is not None:
            if isinstance(payload, dict):
                body_bytes = json.dumps(payload).encode("utf-8")
                headers["Content-Type"] = "application/json"
            elif isinstance(payload, str):
                body_bytes = payload.encode("utf-8")
                headers["Content-Type"] = "application/json"
            headers["Content-Length"] = str(len(body_bytes))

        conn.request(method, path, body=body_bytes, headers=headers)
        res = conn.getresponse()
        data = res.read()
        conn.close()
        try:
            parsed = json.loads(data.decode("utf-8"))
        except Exception:
            parsed = data
        return res.status, parsed

    # 1. Status 200 Tests with various presets & payload keys
    def test_200_valid_humanoid_with_document_key(self):
        status, data = self._request("POST", "/api/rig/autorig", {
            "document": SAMPLE_PROJECT,
            "preset": "humanoid"
        })
        self.assertEqual(status, 200)
        self.assertIn("document", data)
        self.assertIn("project", data)
        self.assertIn("rig", data)
        self.assertIn("bones", data["rig"])
        self.assertIn("ik_chains", data["rig"])
        self.assertIn("left_upper_leg", data["rig"]["bones"])
        self.assertIn("left_leg", data["rig"]["ik_chains"])
        # Verify compiled validity
        compile_project(data["document"])

    def test_200_valid_quadruped_with_project_key(self):
        status, data = self._request("POST", "/api/rig/autorig", {
            "project": SAMPLE_PROJECT,
            "preset": "quadruped"
        })
        self.assertEqual(status, 200)
        self.assertIn("front_left_upper_leg", data["rig"]["bones"])
        self.assertIn("front_left_leg", data["rig"]["ik_chains"])
        compile_project(data["project"])

    def test_200_valid_creature_preset(self):
        status, data = self._request("POST", "/api/rig/autorig", {
            "document": SAMPLE_PROJECT,
            "preset": "creature"
        })
        self.assertEqual(status, 200)
        self.assertIn("root", data["rig"]["bones"])
        compile_project(data["document"])

    def test_200_alias_endpoint_api_autorig(self):
        status, data = self._request("POST", "/api/autorig", {
            "document": SAMPLE_PROJECT,
            "preset": "humanoid"
        })
        self.assertEqual(status, 200)
        self.assertIn("rig", data)

    def test_200_default_preset_when_omitted(self):
        status, data = self._request("POST", "/api/rig/autorig", {
            "document": SAMPLE_PROJECT
        })
        self.assertEqual(status, 200)
        # Defaults to humanoid
        self.assertIn("left_upper_leg", data["rig"]["bones"])

    def test_200_multi_part_with_wings_and_tail(self):
        proj = json.loads(json.dumps(SAMPLE_PROJECT))
        proj["parts"]["wing_l"] = {
            "front": "..x\n..x", "back": "..x\n..x", "side": "..x\n..x"
        }
        proj["parts"]["wing_r"] = {
            "front": "x..\nx..", "back": "x..\nx..", "side": "x..\nx.."
        }
        proj["parts"]["tail"] = {
            "front": ".x\n.x", "back": ".x\n.x", "side": ".x\n.x"
        }
        status, data = self._request("POST", "/api/rig/autorig", {
            "document": proj,
            "preset": "creature"
        })
        self.assertEqual(status, 200)
        self.assertIn("left_wing", data["rig"]["bones"])
        self.assertIn("right_wing", data["rig"]["bones"])
        self.assertIn("tail", data["rig"]["bones"])
        compile_project(data["document"])

    def test_200_prunes_obsolete_animation_tracks_on_preset_switch(self):
        # Humanoid autorig first
        proj = autorig_document_data(SAMPLE_PROJECT, "humanoid")
        # Add animation tracks referencing humanoid bones
        proj["animations"]["walk"] = {
            "frames": 4, "fps": 10,
            "bones": {
                "left_upper_leg": {"rotation": [{"frame": 0, "value": [10, 0, 0]}]},
                "torso": {"rotation": [{"frame": 0, "value": [0, 0, 0]}]},
            },
            "ik": {
                "left_leg": {"target": [{"frame": 0, "value": [0, 0, 0]}]},
            }
        }
        # Now autorig to quadruped via API - left_upper_leg does not exist in quadruped (front_left_upper_leg does)
        status, data = self._request("POST", "/api/rig/autorig", {
            "document": proj,
            "preset": "quadruped"
        })
        self.assertEqual(status, 200)
        # Obsolete track should be pruned, document must compile without error
        self.assertNotIn("left_upper_leg", data["document"]["animations"]["walk"]["bones"])
        self.assertNotIn("left_leg", data["document"]["animations"]["walk"]["ik"])
        compile_project(data["document"])

    # 2. Status 422 Unprocessable Entity Tests (Invalid payloads/presets)
    def test_422_invalid_preset_name(self):
        status, data = self._request("POST", "/api/rig/autorig", {
            "document": SAMPLE_PROJECT,
            "preset": "dragon_preset_invalid"
        })
        self.assertEqual(status, 422)
        self.assertEqual(data.get("valid"), False)
        self.assertIn("unknown autorig preset", str(data.get("error")))

    def test_422_empty_json_object(self):
        status, data = self._request("POST", "/api/rig/autorig", {})
        self.assertEqual(status, 422)
        self.assertEqual(data.get("valid"), False)

    def test_422_missing_document_and_project_key(self):
        status, data = self._request("POST", "/api/rig/autorig", {
            "preset": "humanoid",
            "some_other_key": 123
        })
        self.assertEqual(status, 422)
        self.assertEqual(data.get("valid"), False)

    def test_422_document_is_not_a_dict(self):
        status, data = self._request("POST", "/api/rig/autorig", {
            "document": ["not", "a", "dict"],
            "preset": "humanoid"
        })
        self.assertEqual(status, 422)
        self.assertEqual(data.get("valid"), False)

    def test_422_empty_parts_mapping(self):
        bad_proj = json.loads(json.dumps(SAMPLE_PROJECT))
        bad_proj["parts"] = {}
        status, data = self._request("POST", "/api/rig/autorig", {
            "document": bad_proj,
            "preset": "humanoid"
        })
        self.assertEqual(status, 422)
        self.assertEqual(data.get("valid"), False)

    def test_422_part_with_zero_voxels(self):
        bad_proj = json.loads(json.dumps(SAMPLE_PROJECT))
        bad_proj["parts"]["empty_part"] = {
            "front": "..\n..", "back": "..\n..", "side": "..\n.."
        }
        status, data = self._request("POST", "/api/rig/autorig", {
            "document": bad_proj,
            "preset": "humanoid"
        })
        self.assertEqual(status, 422)
        self.assertEqual(data.get("valid"), False)

    def test_422_malformed_json_syntax(self):
        status, data = self._request("POST", "/api/rig/autorig", payload="{ malformed json [")
        self.assertEqual(status, 422)
        self.assertEqual(data.get("valid"), False)

    # 3. Status 403 Forbidden Tests (Security & Host Authorization)
    def test_403_missing_token(self):
        status, data = self._request("POST", "/api/rig/autorig", {
            "document": SAMPLE_PROJECT
        }, token=None)
        self.assertEqual(status, 403)

    def test_403_invalid_token(self):
        status, data = self._request("POST", "/api/rig/autorig", {
            "document": SAMPLE_PROJECT
        }, token="wrong-attacker-token")
        self.assertEqual(status, 403)

    def test_403_non_local_host_header(self):
        status, data = self._request("POST", "/api/rig/autorig", {
            "document": SAMPLE_PROJECT
        }, host="evil.attacker.com")
        self.assertEqual(status, 403)

    # 4. Unknown endpoint handling
    def test_404_on_unknown_subpath(self):
        status, data = self._request("POST", "/api/rig/autorig/nonexistent", {
            "document": SAMPLE_PROJECT
        })
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
