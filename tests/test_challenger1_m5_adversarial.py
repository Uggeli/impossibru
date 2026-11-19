"""
Milestone 5 Phase 2 Challenger 1 Adversarial Test Suite (Python Backend & Math Core).
Conducts adversarial stress testing on:
1. Engine Math & 2-Bone IK Solver (singularities, zero length, collinearity, NaN/Inf bounds).
2. Degenerate Voxel Meshes & Autorigging Engine (1x1x1, empty, hollow, single-slice, asymmetric).
3. Spring Physics Boundary Conditions (zero/high damping & stiffness, sub-step stability, dt edge cases).
4. Backend API REST Endpoints (malformed JSON, huge bodies, invalid types, auth/host guards, error codes).
"""

import http.client
import json
import math
import tempfile
import threading
import unittest
from pathlib import Path
import numpy as np

from spritebuilder.animation import (
    euler_matrix,
    evaluate_pose,
    evaluate_rest_pose,
    matrix_from_quat,
    norm,
    quat_from_matrix,
    rot_from_to,
    sample_rotation,
    sample_track,
    slerp_matrix,
    solve_two_bone,
)
from spritebuilder.rigging import (
    euler_from_matrix as rigging_euler_from_matrix,
    normalize_angle,
    normalize_euler,
    overlay_geometry,
    reparent_document,
    drag_document,
)
from spritebuilder.autorig import (
    analyze_contact_surface,
    analyze_part,
    analyze_project,
    autorig_document_data,
    autorig_project,
    generate_creature_rig,
    generate_humanoid_rig,
    generate_quadruped_rig,
    generate_rig,
)
from spritebuilder.editor_server import create_server
from spritebuilder.project import (
    Bone,
    Clip,
    IKChain,
    Project,
    ProjectError,
    VoxelPart,
    compile_project,
)
from spritebuilder.spring_bones import (
    CopyRotationConstraint,
    MirrorConstraint,
    SplineSpineConstraint,
    SpringBoneConfig,
    SpringBoneSolver,
    evaluate_constraints,
)


def get_base_project_dict():
    return {
        "palette": {
            "0": "#000000",
            "1": "#ffffff",
            "r": "#ff0000",
            "g": "#00ff00",
            "b": "#0000ff",
        },
        "parts": {
            "torso": {
                "front": "rr\nrr",
                "back": "rr\nrr",
                "side": "rr\nrr",
            },
            "head": {
                "front": "gg\ngg",
                "back": "gg\ngg",
                "side": "gg\ngg",
            },
            "upper_arm_l": {
                "front": "bb\nbb",
                "back": "bb\nbb",
                "side": "bb\nbb",
            },
            "lower_arm_l": {
                "front": "bb\nbb",
                "back": "bb\nbb",
                "side": "bb\nbb",
            },
            "upper_leg_l": {
                "front": "11\n11",
                "back": "11\n11",
                "side": "11\n11",
            },
            "lower_leg_l": {
                "front": "11\n11",
                "back": "11\n11",
                "side": "11\n11",
            },
            "foot_l": {
                "front": "11\n11",
                "back": "11\n11",
                "side": "11\n11",
            },
        },
        "rig": {
            "bones": {
                "root": {"translation": [0, 8, 0], "rotation": [0, 0, 0]},
                "torso": {"parent": "root", "part": "torso", "translation": [0, 0, 0]},
                "head": {"parent": "torso", "part": "head", "translation": [0, 4, 0]},
                "upper_arm_l": {"parent": "torso", "part": "upper_arm_l", "translation": [3, 2, 0]},
                "lower_arm_l": {"parent": "upper_arm_l", "part": "lower_arm_l", "translation": [0, -3, 0]},
                "upper_leg_l": {"parent": "root", "part": "upper_leg_l", "translation": [2, -1, 0]},
                "lower_leg_l": {"parent": "upper_leg_l", "part": "lower_leg_l", "translation": [0, -4, 0]},
                "foot_l": {"parent": "lower_leg_l", "part": "foot_l", "translation": [0, -4, 0]},
            },
            "ik_chains": {
                "leg_l": {"root": "upper_leg_l", "mid": "lower_leg_l", "end": "foot_l"}
            },
        },
        "animations": {
            "idle": {
                "frames": 8,
                "fps": 8,
                "loop": True,
                "bones": {
                    "root": {
                        "translation": [
                            {"frame": 0, "value": [0, 0, 0]},
                            {"frame": 4, "value": [0, 1, 0]},
                            {"frame": 7, "value": [0, 0, 0]},
                        ]
                    }
                },
                "ik": {
                    "leg_l": {
                        "target": [
                            {"frame": 0, "value": [2, 0, 0]},
                            {"frame": 4, "value": [2, 1, 1]},
                        ],
                        "pole": [
                            {"frame": 0, "value": [2, 0, 5]},
                        ],
                    }
                },
            }
        },
        "export": {
            "name": "adv_hero",
            "size": [32, 32],
            "scale": 1,
            "origin": [16, 16],
            "directions": [0, 90, 180, 270],
            "animations": ["idle"],
            "background": [0, 0, 0, 0],
        },
    }


class TestAdversarialEngineMathAndIK(unittest.TestCase):
    """Stress test engine math, rot_from_to, quaternion conversions, and 2-bone IK solver."""

    def test_rot_from_to_extreme_angles_and_zeros(self):
        """rot_from_to should handle zero vectors, exact antiparallel, and tiny perturbations."""
        # Exact parallel
        r = rot_from_to([1, 0, 0], [1, 0, 0])
        np.testing.assert_allclose(r, np.eye(3), atol=1e-6)

        # Exact antiparallel on all 3 axes
        for v in ([1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]):
            v = np.array(v, dtype=float)
            r = rot_from_to(v, -v)
            self.assertTrue(np.all(np.isfinite(r)))
            np.testing.assert_allclose(r @ r.T, np.eye(3), atol=1e-5)
            self.assertAlmostEqual(np.linalg.det(r), 1.0, places=5)
            # Transforming v gives -v
            np.testing.assert_allclose(r @ v, -v, atol=1e-5)

        # Near antiparallel (180 deg - epsilon)
        for eps in (1e-4, 1e-6, 1e-8):
            v1 = np.array([0.0, 1.0, 0.0])
            v2 = np.array([eps, -1.0, 0.0])
            r = rot_from_to(v1, v2)
            self.assertTrue(np.all(np.isfinite(r)))
            np.testing.assert_allclose(r @ r.T, np.eye(3), atol=1e-4)

    def test_euler_gimbal_lock_and_extremes(self):
        """Gimbal lock condition (pitch = 90/-90 deg) and extreme angle multiples."""
        for pitch in (90.0, -90.0):
            m = euler_matrix([0.0, pitch, 45.0])
            angles = rigging_euler_from_matrix(m)
            self.assertTrue(np.all(np.isfinite(angles)))
            # Reconstructed matrix must match original
            m_recon = euler_matrix(angles)
            np.testing.assert_allclose(m, m_recon, atol=1e-4)

        # Huge angles (multiples of 360)
        m_huge = euler_matrix([360000.0, -720000.0, 1080000.0])
        np.testing.assert_allclose(m_huge, np.eye(3), atol=1e-5)

    def test_quat_matrix_roundtrip_all_branches(self):
        """Quaternion to matrix and back across all 4 sign/trace branches."""
        test_rotations = [
            euler_matrix([0, 0, 0]),          # trace > 0
            euler_matrix([180, 0, 0]),        # diag[0] max
            euler_matrix([0, 180, 0]),        # diag[1] max
            euler_matrix([0, 0, 180]),        # diag[2] max
            euler_matrix([120, -45, 60]),     # general
            euler_matrix([-170, 85, -135]),   # near boundary
        ]
        for m in test_rotations:
            q = quat_from_matrix(m)
            self.assertTrue(np.all(np.isfinite(q)))
            self.assertAlmostEqual(np.linalg.norm(q), 1.0, places=5)
            m_recon = matrix_from_quat(q)
            np.testing.assert_allclose(m, m_recon, atol=1e-5)

    def test_slerp_matrix_boundary_values(self):
        """SLERP interpolation with t <= 0, t >= 1, t = 0.5, and opposite quaternions."""
        m1 = euler_matrix([10, 20, 30])
        m2 = euler_matrix([50, -40, 70])

        np.testing.assert_allclose(slerp_matrix(m1, m2, 0.0), m1, atol=1e-5)
        np.testing.assert_allclose(slerp_matrix(m1, m2, 1.0), m2, atol=1e-5)

        # Extrapolation / boundary clamp
        s_mid = slerp_matrix(m1, m2, 0.5)
        self.assertTrue(np.all(np.isfinite(s_mid)))
        np.testing.assert_allclose(s_mid @ s_mid.T, np.eye(3), atol=1e-5)

        # Slerp identical matrices
        s_same = slerp_matrix(m1, m1, 0.5)
        np.testing.assert_allclose(s_same, m1, atol=1e-5)

    def test_ik_solver_extreme_targets_and_singularities(self):
        """IK solver under extreme overreach, zero distance, collinear poles, and zero lengths."""
        root = np.array([0.0, 10.0, 0.0])
        l1, l2 = 4.0, 4.0

        # Target infinitely far away (1e7)
        target_far = root + np.array([0.0, -1e7, 0.0])
        pole = root + np.array([0.0, 0.0, 5.0])
        j, e = solve_two_bone(root, target_far, l1, l2, pole)
        self.assertTrue(np.all(np.isfinite(j)))
        self.assertTrue(np.all(np.isfinite(e)))
        self.assertAlmostEqual(np.linalg.norm(j - root), l1, places=3)
        self.assertAlmostEqual(np.linalg.norm(e - j), l2, places=3)
        # End should be clamped to (l1 + l2 - 1e-6)
        self.assertAlmostEqual(np.linalg.norm(e - root), l1 + l2 - 1e-6, places=3)

        # Target exactly at root (0 distance)
        j0, e0 = solve_two_bone(root, root, l1, l2, pole)
        self.assertTrue(np.all(np.isfinite(j0)))
        self.assertTrue(np.all(np.isfinite(e0)))
        self.assertAlmostEqual(np.linalg.norm(j0 - root), l1, places=3)

        # Zero length bones
        jz, ez = solve_two_bone(root, root + np.array([0, -2, 0]), 0.0, 0.0, pole)
        self.assertTrue(np.all(np.isfinite(jz)))
        self.assertTrue(np.all(np.isfinite(ez)))

        # Pole exactly collinear with target direction
        target = root + np.array([0.0, -5.0, 0.0])
        pole_collinear = root + np.array([0.0, -10.0, 0.0])
        jc, ec = solve_two_bone(root, target, l1, l2, pole_collinear)
        self.assertTrue(np.all(np.isfinite(jc)))
        self.assertTrue(np.all(np.isfinite(ec)))
        self.assertAlmostEqual(np.linalg.norm(jc - root), l1, places=3)
        self.assertAlmostEqual(np.linalg.norm(ec - jc), l2, places=3)


class TestAdversarialDegenerateVoxelMeshesAndAutorig(unittest.TestCase):
    """Stress test voxel analysis and autorigging against degenerate geometries."""

    def test_single_voxel_1x1x1_part_analysis(self):
        """Analyze 1x1x1 single voxel part."""
        data = {
            "palette": {"x": "#ff0000"},
            "parts": {
                "cube1": {
                    "front": "x",
                    "back": "x",
                    "side": "x",
                }
            },
            "rig": {"bones": {"root": {"part": "cube1"}}, "ik_chains": {}},
            "animations": {"idle": {"frames": 1, "fps": 1}},
            "export": {"directions": [0], "animations": ["idle"]},
        }
        proj = compile_project(data)
        analysis = analyze_part(proj.parts["cube1"])
        self.assertEqual(analysis.volume, 1)
        self.assertEqual(analysis.width, 1.0)
        self.assertEqual(analysis.height, 1.0)
        self.assertEqual(analysis.depth, 1.0)
        np.testing.assert_allclose(analysis.centroid, [0.0, 0.0, 0.0])

    def test_single_slice_flat_voxel_parts(self):
        """Analyze flat single-slice parts (dx=1, dy=10, dz=10) and (dx=10, dy=1, dz=10)."""
        data = {
            "palette": {"x": "#ff0000"},
            "parts": {
                "flat_x": {
                    "front": "x\nx\nx\nx\nx\nx\nx\nx\nx\nx",  # 1x10
                    "back": "x\nx\nx\nx\nx\nx\nx\nx\nx\nx",
                    "side": "xxxxxxxxxx\nxxxxxxxxxx\nxxxxxxxxxx\nxxxxxxxxxx\nxxxxxxxxxx\n"
                            "xxxxxxxxxx\nxxxxxxxxxx\nxxxxxxxxxx\nxxxxxxxxxx\nxxxxxxxxxx", # 10x10
                },
                "flat_y": {
                    "front": "xxxxxxxxxx",  # 10x1
                    "back": "xxxxxxxxxx",
                    "side": "xxxxxxxxxx",
                }
            },
            "rig": {
                "bones": {
                    "root": {"part": "flat_x"},
                    "child": {"parent": "root", "part": "flat_y"}
                },
                "ik_chains": {}
            },
            "animations": {"idle": {"frames": 1, "fps": 1}},
            "export": {"directions": [0], "animations": ["idle"]},
        }
        proj = compile_project(data)
        analysis_x = analyze_part(proj.parts["flat_x"])
        self.assertEqual(analysis_x.width, 1.0)
        self.assertEqual(analysis_x.height, 10.0)
        self.assertEqual(analysis_x.depth, 10.0)

        analysis_y = analyze_part(proj.parts["flat_y"])
        self.assertEqual(analysis_y.width, 10.0)
        self.assertEqual(analysis_y.height, 1.0)
        self.assertEqual(analysis_y.depth, 10.0)

    def test_hollow_voxel_box_part(self):
        """Hollow box where interior voxels are empty '.'."""
        data = {
            "palette": {"x": "#00ff00"},
            "parts": {
                "hollow": {
                    "front": "xxxx\nx..x\nx..x\nxxxx",
                    "back": "xxxx\nx..x\nx..x\nxxxx",
                    "side": "xxxx\nx..x\nx..x\nxxxx",
                }
            },
            "rig": {"bones": {"root": {"part": "hollow"}}, "ik_chains": {}},
            "animations": {"idle": {"frames": 1, "fps": 1}},
            "export": {"directions": [0], "animations": ["idle"]},
        }
        proj = compile_project(data)
        analysis = analyze_part(proj.parts["hollow"])
        self.assertEqual(analysis.width, 4.0)
        self.assertEqual(analysis.height, 4.0)
        self.assertEqual(analysis.depth, 4.0)
        # Volume should be less than 4x4x4=64 because of hollow interior
        self.assertLess(analysis.volume, 64)
        self.assertGreater(analysis.volume, 0)

    def test_autorig_on_degenerate_single_part_project(self):
        """Autorig presets on a project with only 1 unsegmented block."""
        data = {
            "palette": {"x": "#ff00ff"},
            "parts": {
                "blob": {
                    "front": "xxx\nxxx\nxxx",
                    "back": "xxx\nxxx\nxxx",
                    "side": "xxx\nxxx\nxxx",
                }
            },
            "rig": {"bones": {"root": {"part": "blob"}}, "ik_chains": {}},
            "animations": {
                "idle": {"frames": 2, "fps": 2, "bones": {"root": {}}}
            },
            "export": {"directions": [0], "animations": ["idle"]},
        }
        for preset in ("humanoid", "quadruped", "creature"):
            rig = autorig_document_data(data, preset=preset)
            self.assertIn("rig", rig)
            self.assertIn("bones", rig["rig"])
            self.assertIn("root", rig["rig"]["bones"])
            # Validate output compiles cleanly
            compiled = compile_project(rig)
            self.assertIn("root", compiled.bones)

    def test_autorig_on_asymmetric_disconnected_model(self):
        """Autorig on model with non-standard limb part names and asymmetric sizes."""
        data = {
            "palette": {"x": "#ffffff"},
            "parts": {
                "body": {"front": "xx\nxx\nxx\nxx", "back": "xx\nxx\nxx\nxx", "side": "xx\nxx\nxx\nxx"},
                "wing_left": {"front": "xxxx\n.xx.", "back": "xxxx\n.xx.", "side": "xx\nxx"},
                "tail": {"front": "x\nx\nx", "back": "x\nx\nx", "side": "xxx\n.xx\n..x"},
            },
            "rig": {"bones": {"root": {"part": "body"}}, "ik_chains": {}},
            "animations": {"idle": {"frames": 1, "fps": 1}},
            "export": {"directions": [0], "animations": ["idle"]},
        }
        rig = autorig_document_data(data, preset="creature")
        compiled = compile_project(rig)
        self.assertIn("root", compiled.bones)
        self.assertIn("tail", compiled.bones)
        self.assertIn("left_wing", compiled.bones)


class TestAdversarialSpringPhysics(unittest.TestCase):
    """Stress test SpringBoneSolver against extreme boundary parameters."""

    def test_spring_zero_and_high_damping(self):
        """Verify stability under damping=0 (pure harmonic) and damping=50 (strongly overdamped)."""
        data = get_base_project_dict()
        data["rig"]["spring_bones"] = {
            "head": {
                "stiffness": 100.0,
                "damping": 0.0,
                "mass": 1.0,
                "drag": 0.0,
                "gravity": [0.0, 0.0, 0.0],
                "limit_angle": 180.0,
            }
        }
        proj = compile_project(data)
        solver = SpringBoneSolver(proj)
        rest = evaluate_rest_pose(proj)

        # Disturbance
        solver.state["head"]["pos"] += np.array([1.0, 0.0, 0.0])

        # Step 200 times at dt=0.005s
        for _ in range(200):
            p = solver.step(rest, 0.005)
            self.assertTrue(np.all(np.isfinite(p["head"])))

        # Switch to strong damping = 50.0
        proj.spring_bones["head"].damping = 50.0
        for _ in range(50):
            p = solver.step(rest, 0.005)
            self.assertTrue(np.all(np.isfinite(p["head"])))
            self.assertTrue(np.all(np.isfinite(solver.state["head"]["vel"])))

    def test_spring_zero_and_high_stiffness(self):
        """Verify stability under stiffness=0 and stiffness=500."""
        data = get_base_project_dict()
        data["rig"]["spring_bones"] = {
            "head": {
                "stiffness": 0.0,
                "damping": 5.0,
                "mass": 1.0,
                "drag": 1.0,
                "gravity": [0.0, -10.0, 0.0],
            }
        }
        proj = compile_project(data)
        solver = SpringBoneSolver(proj)
        rest = evaluate_rest_pose(proj)

        # Zero stiffness with gravity: falls under gravity damped by drag
        for _ in range(50):
            p = solver.step(rest, 0.01)
            self.assertTrue(np.all(np.isfinite(p["head"])))

        # High stiffness = 500
        proj.spring_bones["head"].stiffness = 500.0
        proj.spring_bones["head"].damping = 20.0
        for _ in range(50):
            p = solver.step(rest, 0.002)
            self.assertTrue(np.all(np.isfinite(p["head"])))

    def test_spring_dt_extremes_and_negative(self):
        """Test dt = 0, dt < 0, and large dt = 1.0."""
        data = get_base_project_dict()
        data["rig"]["spring_bones"] = {
            "head": {"stiffness": 100.0, "damping": 10.0, "mass": 1.0}
        }
        proj = compile_project(data)
        solver = SpringBoneSolver(proj)
        rest = evaluate_rest_pose(proj)

        # dt = 0
        p0 = solver.step(rest, 0.0)
        np.testing.assert_allclose(p0["head"], rest["head"], atol=1e-5)

        # dt < 0
        p_neg = solver.step(rest, -0.01)
        np.testing.assert_allclose(p_neg["head"], rest["head"], atol=1e-5)

        # large dt = 1.0s
        p_large = solver.step(rest, 1.0)
        self.assertTrue(np.all(np.isfinite(p_large["head"])))

    def test_spring_negative_parameter_rejection(self):
        """Negative mass, stiffness, damping, or drag must be rejected during project compile."""
        bad_configs = [
            {"mass": -1.0},
            {"stiffness": -50.0},
            {"damping": -5.0},
            {"drag": -0.5},
            {"limit_angle": -10.0},
        ]
        for cfg in bad_configs:
            data = get_base_project_dict()
            data["rig"]["spring_bones"] = {"head": cfg}
            with self.assertRaises(ProjectError, msg=f"Allowed invalid spring config: {cfg}"):
                compile_project(data)


class TestAdversarialBackendCoreRESTAPI(unittest.TestCase):
    """Stress test backend HTTP REST API server with malformed payloads and malicious inputs."""

    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.project_file = Path(cls.temp_dir.name) / "test_api.yaml"
        import yaml
        with open(cls.project_file, "w") as f:
            yaml.dump(get_base_project_dict(), f)

        cls.server, cls.session = create_server(cls.project_file, port=0)
        cls.port = cls.server.server_port
        cls.token = cls.session.token
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.temp_dir.cleanup()

    def _request(self, method: str, path: str, body: bytes | str | None = None,
                 headers: dict | None = None, host: str = "127.0.0.1"):
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        req_headers = {"Host": f"{host}:{self.port}"}
        if headers:
            req_headers.update(headers)
        if body is not None:
            if isinstance(body, str):
                body = body.encode("utf-8")
            if "Content-Length" not in req_headers:
                req_headers["Content-Length"] = str(len(body))
        conn.request(method, path, body=body, headers=req_headers)
        response = conn.getresponse()
        data = response.read()
        conn.close()
        return response.status, response.getheaders(), data

    def test_non_local_host_header_rejected(self):
        """Host header not in (127.0.0.1, localhost, [::1]) must receive 403 Forbidden."""
        status, _, _ = self._request("GET", "/api/project", host="evil.com")
        self.assertEqual(status, 403)

        status, _, _ = self._request("POST", "/api/validate", body=b"{}", host="attacker.org")
        self.assertEqual(status, 403)

    def test_missing_or_invalid_auth_token(self):
        """API mutations without valid X-SpriteBuilder-Token must receive 403."""
        status, _, _ = self._request("GET", "/api/project")
        self.assertEqual(status, 403)

        status, _, _ = self._request(
            "POST", "/api/validate", body=json.dumps({"project": get_base_project_dict()}),
            headers={"X-SpriteBuilder-Token": "bad_token"}
        )
        self.assertEqual(status, 403)

    def test_malformed_json_payloads(self):
        """Corrupt JSON syntax, truncated payloads, or non-object roots return 422/400 error."""
        auth = {"X-SpriteBuilder-Token": self.token}

        # Broken JSON syntax
        status, _, body = self._request("POST", "/api/validate", body=b'{"project": {unclosed...', headers=auth)
        self.assertIn(status, (400, 422))
        res = json.loads(body)
        self.assertIn("error", res)

        # JSON array instead of object
        status, _, body = self._request("POST", "/api/validate", body=b'[1, 2, 3]', headers=auth)
        self.assertIn(status, (400, 422))

        # JSON number
        status, _, body = self._request("POST", "/api/validate", body=b'12345', headers=auth)
        self.assertIn(status, (400, 422))

        # Empty body
        status, _, body = self._request("POST", "/api/validate", body=b'', headers=auth)
        self.assertIn(status, (400, 422))

    def test_payload_size_limit_exceeded(self):
        """Payload declaring Content-Length > MAX_BODY (8MB) is rejected cleanly with 422."""
        auth = {"X-SpriteBuilder-Token": self.token, "Content-Length": "10000000"}
        status, _, body = self._request("POST", "/api/validate", body=b"", headers=auth)
        self.assertEqual(status, 422)

    def test_invalid_api_route_or_method(self):
        """Unknown route returns 404."""
        auth = {"X-SpriteBuilder-Token": self.token}
        status, _, body = self._request(
            "POST", "/api/non_existent_endpoint",
            body=json.dumps({"project": get_base_project_dict()}), headers=auth
        )
        self.assertEqual(status, 404)

    def test_autorig_endpoint_validation_and_recovery(self):
        """POST /api/rig/autorig with valid and invalid project structures."""
        auth = {"X-SpriteBuilder-Token": self.token}

        # Valid autorig request
        status, _, body = self._request(
            "POST", "/api/rig/autorig",
            body=json.dumps({"project": get_base_project_dict(), "preset": "humanoid"}),
            headers=auth
        )
        self.assertEqual(status, 200)
        res = json.loads(body)
        self.assertIn("project", res)
        self.assertIn("rig", res)

        # Invalid preset
        status, _, body = self._request(
            "POST", "/api/rig/autorig",
            body=json.dumps({"project": get_base_project_dict(), "preset": "invalid_preset_xyz"}),
            headers=auth
        )
        self.assertEqual(status, 422)

        # Missing project dict
        status, _, body = self._request(
            "POST", "/api/rig/autorig",
            body=json.dumps({"preset": "humanoid"}),
            headers=auth
        )
        self.assertEqual(status, 422)

    def test_reparent_cyclic_attempt_via_api(self):
        """POST /api/rig/reparent with cyclic parent attempt returns 422."""
        auth = {"X-SpriteBuilder-Token": self.token}
        data = get_base_project_dict()

        # Try to reparent root under its own descendant 'head'
        status, _, body = self._request(
            "POST", "/api/rig/reparent",
            body=json.dumps({"project": data, "bone": "root", "parent": "head"}),
            headers=auth
        )
        self.assertEqual(status, 422)
        res = json.loads(body)
        self.assertFalse(res.get("valid", True))

    def test_preview_out_of_bounds_frame(self):
        """POST /api/preview with frame < 0 or frame >= frames returns 422."""
        auth = {"X-SpriteBuilder-Token": self.token}
        data = get_base_project_dict()

        # Frame 99 in an 8-frame clip
        status, _, body = self._request(
            "POST", "/api/preview",
            body=json.dumps({"project": data, "clip": "idle", "frame": 99}),
            headers=auth
        )
        self.assertEqual(status, 422)

        # Negative frame
        status, _, body = self._request(
            "POST", "/api/preview",
            body=json.dumps({"project": data, "clip": "idle", "frame": -1}),
            headers=auth
        )
        self.assertEqual(status, 422)

        # Unknown clip
        status, _, body = self._request(
            "POST", "/api/preview",
            body=json.dumps({"project": data, "clip": "nonexistent_clip", "frame": 0}),
            headers=auth
        )
        self.assertEqual(status, 422)


if __name__ == "__main__":
    unittest.main()
