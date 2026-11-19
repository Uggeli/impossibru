"""
Milestone 4 Challenger 1 Adversarial Test Suite:
1. Keyframe Deletion and Track Pruning Schema Invariants
2. Track Sampling, Interpolation Modes (Linear/Smooth/Step), Loop Boundary Wrapping
3. Python vs TS Mathematical Parity under Extreme Conditions
"""

import unittest
import numpy as np

from spritebuilder.project import compile_project, ProjectError
from spritebuilder.animation import (
    sample_track,
    sample_rotation,
    evaluate_pose,
    euler_matrix,
)

def create_complex_py_project():
    return {
        "name": "challenger1_project",
        "palette": {
            "0": "#000000",
            "1": "#ffffff",
            "2": "#ff0000",
            "3": "#00ff00",
        },
        "parts": {
            "box": {
                "front": "22\n22",
                "back": "22\n22",
                "side": "22\n22",
                "color": 2,
            }
        },
        "rig": {
            "bones": {
                "root": {"part": "box", "translation": [0, 10, 0], "rotation": [0, 0, 0]},
                "spine": {"parent": "root", "translation": [0, 4, 0], "rotation": [0, 0, 0]},
                "chest": {"parent": "spine", "translation": [0, 4, 0], "rotation": [0, 0, 0]},
                "head": {"parent": "chest", "translation": [0, 4, 0], "rotation": [0, 0, 0]},
                "leaf": {"parent": "head", "translation": [0, 2, 0], "rotation": [0, 0, 0]},
                "hip_l": {"parent": "root", "translation": [2, -2, 0], "rotation": [0, 0, 0]},
                "knee_l": {"parent": "hip_l", "part": "box", "translation": [0, -4, 0], "rotation": [0, 0, 0]},
                "foot_l": {"parent": "knee_l", "part": "box", "translation": [0, -4, 0], "rotation": [0, 0, 0]},
                "hip_r": {"parent": "root", "translation": [-2, -2, 0], "rotation": [0, 0, 0]},
                "knee_r": {"parent": "hip_r", "part": "box", "translation": [0, -4, 0], "rotation": [0, 0, 0]},
                "foot_r": {"parent": "knee_r", "part": "box", "translation": [0, -4, 0], "rotation": [0, 0, 0]},
            },
            "ik_chains": {
                "leg_l": {"root": "hip_l", "mid": "knee_l", "end": "foot_l"},
                "leg_r": {"root": "hip_r", "mid": "knee_r", "end": "foot_r"},
            },
        },
        "animations": {
            "walk": {
                "frames": 16,
                "fps": 12,
                "loop": True,
                "bones": {
                    "root": {
                        "translation": [
                            {"frame": 0, "value": [0, 0, 0], "interpolation": "linear"},
                            {"frame": 8, "value": [0, 1, 0], "interpolation": "smooth"},
                            {"frame": 15, "value": [0, 0, 0], "interpolation": "linear"},
                        ],
                        "rotation": [
                            {"frame": 0, "value": [0, 0, 0], "interpolation": "linear"},
                            {"frame": 8, "value": [0, 15, 0], "interpolation": "smooth"},
                        ],
                    },
                    "spine": {
                        "rotation": [
                            {"frame": 0, "value": [5, 0, 0], "interpolation": "linear"},
                            {"frame": 8, "value": [-5, 0, 0], "interpolation": "smooth"},
                        ],
                    },
                    "leaf": {
                        "rotation": [
                            {"frame": 0, "value": [0, 0, 0], "interpolation": "step"},
                            {"frame": 8, "value": [10, 0, 0], "interpolation": "step"},
                        ],
                    },
                },
                "ik": {
                    "leg_l": {
                        "target": [
                            {"frame": 0, "value": [2, 0, 2], "interpolation": "linear"},
                            {"frame": 8, "value": [2, 2, -2], "interpolation": "smooth"},
                            {"frame": 15, "value": [2, 0, 2], "interpolation": "linear"},
                        ],
                        "pole": [
                            {"frame": 0, "value": [2, 0, 5], "interpolation": "linear"},
                            {"frame": 8, "value": [2, 1, 5], "interpolation": "smooth"},
                        ],
                        "weight": [
                            {"frame": 0, "value": 1.0, "interpolation": "linear"},
                            {"frame": 8, "value": 0.8, "interpolation": "smooth"},
                        ],
                    },
                    "leg_r": {
                        "target": [
                            {"frame": 0, "value": [-2, 2, -2], "interpolation": "smooth"},
                            {"frame": 8, "value": [-2, 0, 2], "interpolation": "linear"},
                        ],
                        "weight": [
                            {"frame": 0, "value": 1.0, "interpolation": "linear"},
                        ],
                    },
                },
            },
            "single_frame": {
                "frames": 1,
                "fps": 10,
                "loop": True,
                "bones": {
                    "root": {
                        "translation": [{"frame": 0, "value": [1, 2, 3], "interpolation": "linear"}],
                    }
                },
                "ik": {},
            },
        },
        "export": {
            "size": [96, 96],
            "scale": 3,
        },
    }

def clean_animation_tracks_py(doc):
    """Mirror of cleanAnimationTracks for Python dict testing."""
    if not doc.get("animations") or not isinstance(doc["animations"], dict):
        return
    for clip in doc["animations"].values():
        if not isinstance(clip, dict):
            continue
        if "bones" in clip and isinstance(clip["bones"], dict):
            for bone_name, bone_tracks in list(clip["bones"].items()):
                if not isinstance(bone_tracks, dict):
                    continue
                for track_name, keys in list(bone_tracks.items()):
                    if isinstance(keys, list) and len(keys) == 0:
                        del bone_tracks[track_name]
                if len(bone_tracks) == 0:
                    del clip["bones"][bone_name]
        if "ik" in clip and isinstance(clip["ik"], dict):
            for chain_name, ik_tracks in list(clip["ik"].items()):
                if not isinstance(ik_tracks, dict):
                    continue
                for track_name, keys in list(ik_tracks.items()):
                    if isinstance(keys, list) and len(keys) == 0:
                        del ik_tracks[track_name]
                if len(ik_tracks) == 0:
                    del clip["ik"][chain_name]


class TestMilestone4Adversarial(unittest.TestCase):
    def test_schema_rejection_of_empty_tracks_and_clean_cure(self):
        doc = create_complex_py_project()
        proj = compile_project(doc)
        self.assertIsNotNone(proj)

        # Force empty bone track
        doc["animations"]["walk"]["bones"]["spine"]["rotation"] = []
        with self.assertRaises(ProjectError) as ctx:
            compile_project(doc)
        self.assertIn("must be a non-empty keyframe list", str(ctx.exception))

        # Cure using clean_animation_tracks_py
        clean_animation_tracks_py(doc)
        self.assertNotIn("spine", doc["animations"]["walk"]["bones"])
        proj = compile_project(doc)
        self.assertIsNotNone(proj)

        # Force empty IK track
        doc["animations"]["walk"]["ik"]["leg_r"]["target"] = []
        with self.assertRaises(ProjectError) as ctx:
            compile_project(doc)
        self.assertIn("must be a non-empty keyframe list", str(ctx.exception))

        clean_animation_tracks_py(doc)
        proj = compile_project(doc)
        self.assertIsNotNone(proj)

    def test_sample_track_loop_wrapping_and_smooth_math(self):
        # 10 frame clip, keys at frame 2 (20) and frame 8 (80)
        keys_linear = [
            {"frame": 2, "value": [20.0, 0.0, 0.0], "interpolation": "linear"},
            {"frame": 8, "value": [80.0, 0.0, 0.0], "interpolation": "linear"},
        ]
        # Frame 9: t = 1/4 -> 65.0
        v9 = sample_track(keys_linear, 9, loop=True, frames=10)
        self.assertAlmostEqual(v9[0], 65.0, places=5)

        # Frame 0: t = 2/4 -> 50.0
        v0 = sample_track(keys_linear, 0, loop=True, frames=10)
        self.assertAlmostEqual(v0[0], 50.0, places=5)

        # Frame 1: t = 3/4 -> 35.0
        v1 = sample_track(keys_linear, 1, loop=True, frames=10)
        self.assertAlmostEqual(v1[0], 35.0, places=5)

        # Smooth interpolation:
        keys_smooth = [
            {"frame": 2, "value": [20.0, 0.0, 0.0], "interpolation": "smooth"},
            {"frame": 8, "value": [80.0, 0.0, 0.0], "interpolation": "smooth"},
        ]
        # Frame 9: t = 0.25 -> smooth_t = 0.15625 -> 80 + 0.15625 * (-60) = 70.625
        v9s = sample_track(keys_smooth, 9, loop=True, frames=10)
        self.assertAlmostEqual(v9s[0], 70.625, places=5)

        # Frame 0: t = 0.50 -> smooth_t = 0.50 -> 50.0
        v0s = sample_track(keys_smooth, 0, loop=True, frames=10)
        self.assertAlmostEqual(v0s[0], 50.0, places=5)

        # Frame 1: t = 0.75 -> smooth_t = 0.84375 -> 80 - 50.625 = 29.375
        v1s = sample_track(keys_smooth, 1, loop=True, frames=10)
        self.assertAlmostEqual(v1s[0], 29.375, places=5)

        # Step interpolation:
        keys_step = [
            {"frame": 2, "value": [20.0, 0.0, 0.0], "interpolation": "step"},
            {"frame": 8, "value": [80.0, 0.0, 0.0], "interpolation": "step"},
        ]
        self.assertAlmostEqual(sample_track(keys_step, 9, loop=True, frames=10)[0], 80.0, places=5)
        self.assertAlmostEqual(sample_track(keys_step, 0, loop=True, frames=10)[0], 80.0, places=5)
        self.assertAlmostEqual(sample_track(keys_step, 1, loop=True, frames=10)[0], 80.0, places=5)
        self.assertAlmostEqual(sample_track(keys_step, 2, loop=True, frames=10)[0], 20.0, places=5)

    def test_single_keyframe_and_extreme_frame_counts(self):
        # Single keyframe track
        keys = [{"frame": 4, "value": [42.0, 10.0, -5.0], "interpolation": "linear"}]
        for f in range(10):
            val_loop = sample_track(keys, f, loop=True, frames=10)
            val_noloop = sample_track(keys, f, loop=False, frames=10)
            np.testing.assert_allclose(val_loop, [42.0, 10.0, -5.0])
            np.testing.assert_allclose(val_noloop, [42.0, 10.0, -5.0])

        # 1-frame clip
        doc = create_complex_py_project()
        proj = compile_project(doc)
        clip1 = proj.clips["single_frame"]
        world_mats = evaluate_pose(proj, clip1, 0, apply_physics=False, apply_constraints=False)
        self.assertIn("root", world_mats)
        self.assertFalse(np.isnan(world_mats["root"]).any())

        # 1000-frame clip
        doc["animations"]["huge"] = {
            "frames": 1000,
            "fps": 60,
            "loop": True,
            "bones": {
                "root": {
                    "translation": [
                        {"frame": 0, "value": [0, 0, 0], "interpolation": "smooth"},
                        {"frame": 999, "value": [1000, 0, 0], "interpolation": "smooth"},
                    ]
                }
            },
            "ik": {},
        }
        proj_huge = compile_project(doc)
        clip_huge = proj_huge.clips["huge"]
        mats_500 = evaluate_pose(proj_huge, clip_huge, 500, apply_physics=False, apply_constraints=False)
        t500 = 500.0 / 999.0
        smooth_t500 = t500 * t500 * (3.0 - 2.0 * t500)
        expected_x = 1000.0 * smooth_t500
        # Root translation is [0, 10, 0] + [expected_x, 0, 0]
        self.assertAlmostEqual(mats_500["root"][0, 3], expected_x, places=3)
        self.assertAlmostEqual(mats_500["root"][1, 3], 10.0, places=3)


if __name__ == "__main__":
    unittest.main()
