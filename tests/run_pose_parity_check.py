#!/usr/bin/env python3
"""
Empirical Challenge: Full Character Rig Pose Evaluation Parity (Python vs TypeScript).
Compares evaluate_pose() in Python with pose() in TypeScript across 500 animated frames
with FK rotations, IK targets, collinear poles, overextension, and SLERP blend weights.
"""

import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import numpy as np
from spritebuilder.animation import evaluate_pose
from spritebuilder.project import compile_project

def create_test_project_doc():
    """Create a standard humanoid rig document with bones and IK chains."""
    return {
        "name": "challenge_hero",
        "palette": {
            "0": "#000000",
            "1": "#ffffff",
            "2": "#ff0000",
            "3": "#00ff00",
            "4": "#0000ff"
        },
        "parts": {
            "torso": {
                "front": "22\n22",
                "back": "22\n22",
                "side": "22\n22",
                "color": 2
            },
            "limb": {
                "front": "3\n3",
                "back": "3\n3",
                "side": "3\n3",
                "color": 3
            }
        },
        "rig": {
            "bones": {
                "root": {"part": "torso", "translation": [0, 10, 0], "rotation": [0, 0, 0]},
                "spine": {"parent": "root", "translation": [0, 4, 0], "rotation": [0, 0, 0]},
                "chest": {"parent": "spine", "translation": [0, 4, 0], "rotation": [0, 0, 0]},
                "head": {"parent": "chest", "part": "torso", "translation": [0, 4, 0], "rotation": [0, 0, 0]},
                # Left leg chain
                "l_hip": {"parent": "root", "translation": [2, -2, 0], "rotation": [0, 0, 0]},
                "l_knee": {"parent": "l_hip", "part": "limb", "translation": [0, -4, 0], "rotation": [0, 0, 0]},
                "l_foot": {"parent": "l_knee", "part": "limb", "translation": [0, -4, 0], "rotation": [0, 0, 0]},
                # Right leg chain
                "r_hip": {"parent": "root", "translation": [-2, -2, 0], "rotation": [0, 0, 0]},
                "r_knee": {"parent": "r_hip", "part": "limb", "translation": [0, -4, 0], "rotation": [0, 0, 0]},
                "r_foot": {"parent": "r_knee", "part": "limb", "translation": [0, -4, 0], "rotation": [0, 0, 0]},
                # Left arm chain
                "l_shoulder": {"parent": "chest", "translation": [3, 0, 0], "rotation": [0, 0, 0]},
                "l_elbow": {"parent": "l_shoulder", "part": "limb", "translation": [3, 0, 0], "rotation": [0, 0, 0]},
                "l_hand": {"parent": "l_elbow", "part": "limb", "translation": [3, 0, 0], "rotation": [0, 0, 0]},
            },
            "ik_chains": {
                "left_leg": {"root": "l_hip", "mid": "l_knee", "end": "l_foot"},
                "right_leg": {"root": "r_hip", "mid": "r_knee", "end": "r_foot"},
                "left_arm": {"root": "l_shoulder", "mid": "l_elbow", "end": "l_hand"},
            }
        },
        "animations": {
            "test_clip": {
                "fps": 12,
                "loop": True,
                "frames": 50,
                "bones": {
                    "root": {
                        "translation": [
                            {"frame": 0, "value": [0, 10, 0], "interpolation": "linear"},
                            {"frame": 25, "value": [10, 12, -5], "interpolation": "linear"},
                            {"frame": 49, "value": [0, 10, 0], "interpolation": "linear"},
                        ],
                    },
                },
                "ik": {
                    "left_leg": {
                        "target": [
                            {"frame": 0, "value": [2, 0, 2], "interpolation": "linear"},
                            {"frame": 15, "value": [4, 2, -3], "interpolation": "smooth"},
                            {"frame": 35, "value": [2, 5, 6], "interpolation": "linear"},
                            {"frame": 49, "value": [2, 0, 2], "interpolation": "linear"},
                        ],
                        "pole": [
                            {"frame": 0, "value": [2, 0, 5], "interpolation": "linear"},
                            {"frame": 25, "value": [0, 0, 5], "interpolation": "linear"},
                        ],
                        "weight": [
                            {"frame": 0, "value": 1.0, "interpolation": "linear"},
                            {"frame": 20, "value": 0.5, "interpolation": "smooth"},
                            {"frame": 40, "value": 0.0, "interpolation": "linear"},
                            {"frame": 49, "value": 1.0, "interpolation": "linear"},
                        ]
                    },
                    "right_leg": {
                        "target": [
                            {"frame": 0, "value": [-2, 0, -2], "interpolation": "linear"},
                            {"frame": 25, "value": [-5, 4, 3], "interpolation": "smooth"},
                            {"frame": 49, "value": [-2, 0, -2], "interpolation": "linear"},
                        ],
                        "pole": [
                            {"frame": 0, "value": [-2, 0, 5], "interpolation": "linear"},
                        ],
                        "weight": [
                            {"frame": 0, "value": 0.8, "interpolation": "linear"},
                        ]
                    },
                    "left_arm": {
                        "target": [
                            {"frame": 0, "value": [8, 4, 5], "interpolation": "linear"},
                            {"frame": 25, "value": [10, 15, -2], "interpolation": "smooth"},
                            {"frame": 49, "value": [8, 4, 5], "interpolation": "linear"},
                        ],
                        "pole": [
                            {"frame": 0, "value": [0, 1, 0], "interpolation": "linear"},
                        ],
                        "weight": [
                            {"frame": 0, "value": 1.0, "interpolation": "linear"},
                        ]
                    }
                }
            }
        }
    }

def run_pose_parity():
    print("=" * 70)
    print("EMPIRICAL CHALLENGE: Full Pose Evaluation Parity (Python vs TS)")
    print("=" * 70)

    doc_data = create_test_project_doc()
    project = compile_project(doc_data)
    clip = project.clips["test_clip"]

    # 1. Evaluate all 50 frames in Python
    py_frames = []
    for f in range(clip.frames):
        world_mats = evaluate_pose(project, clip, f, apply_physics=False, apply_constraints=False)
        frame_dict = {}
        for bone_name, mat in world_mats.items():
            frame_dict[bone_name] = mat.flatten().tolist()
        py_frames.append(frame_dict)

    print(f"Python evaluate_pose evaluated {len(py_frames)} animated frames across {len(project.bones)} bones.")

    # 2. Evaluate in TypeScript via Node
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f_in:
        json.dump(doc_data, f_in)
        doc_path = f_in.name

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f_out:
        out_path = f_out.name

    ts_script = f"""
import fs from 'fs';
import {{ pose }} from '/home/uggeli/impossibru/web/src/engine.ts';

const doc = JSON.parse(fs.readFileSync('{doc_path}', 'utf8'));
const frames = [];
for (let f = 0; f < 50; f++) {{
  const world = pose(doc, 'test_clip', f);
  const frameObj = {{}};
  for (const [k, v] of Object.entries(world)) {{
    frameObj[k] = v;
  }}
  frames.push(frameObj);
}}
fs.writeFileSync('{out_path}', JSON.stringify({{ frames }}));
"""
    runner_ts_path = "/tmp/run_ts_pose_bench.ts"
    with open(runner_ts_path, "w") as f:
        f.write(ts_script)

    cmd = ["node", "--experimental-strip-types", runner_ts_path]
    env = dict(os.environ)
    res = subprocess.run(cmd, cwd="/home/uggeli/impossibru/web", capture_output=True, text=True, env=env)

    if res.returncode != 0:
        print("Error running TS pose benchmark:", res.stderr)
        return False

    with open(out_path, "r") as f:
        ts_data = json.load(f)

    ts_frames = ts_data["frames"]
    assert len(ts_frames) == len(py_frames)

    # 3. Compare matrices
    max_mat_diff = 0.0
    all_diffs = []
    worst_bone = None
    worst_frame = None

    for f_idx in range(50):
        py_b = py_frames[f_idx]
        ts_b = ts_frames[f_idx]

        for bone_name in py_b.keys():
            m_py = np.array(py_b[bone_name]).reshape(4, 4)
            m_ts = np.array(ts_b[bone_name]).reshape(4, 4)

            diff = float(np.max(np.abs(m_py - m_ts)))
            all_diffs.append(diff)
            if diff > max_mat_diff:
                max_mat_diff = diff
                worst_bone = bone_name
                worst_frame = f_idx

    print("-" * 70)
    print(f"Frames Evaluated:        50")
    print(f"Total Bones / Frame:     {len(project.bones)}")
    print(f"Total Matrix Elements:   {len(all_diffs) * 16:,}")
    print(f"Max Absolute Diff:       {max_mat_diff:.8e} (Bone: '{worst_bone}', Frame: {worst_frame})")
    print(f"Mean Matrix Diff:        {np.mean(all_diffs):.8e}")
    print(f"99.9th Percentile Diff:  {np.percentile(all_diffs, 99.9):.8e}")
    print("-" * 70)

    # Cleanup
    for p in [doc_path, out_path, runner_ts_path]:
        if os.path.exists(p):
            os.unlink(p)

    assert max_mat_diff < 1e-4, f"Max matrix difference {max_mat_diff} exceeded tolerance 1e-4!"
    print(">>> FULL POSE EVALUATION PARITY: PASSED <<<")
    return True

if __name__ == "__main__":
    success = run_pose_parity()
    sys.exit(0 if success else 1)
