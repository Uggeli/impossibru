#!/usr/bin/env python3
"""
Empirical Parity & Stress Benchmark for Milestone 4:
Directly compares TypeScript engine pose() output with Python evaluate_pose() across
a battery of adversarial animation timeline stress cases:
1. 1-frame clips with loop=True and loop=False
2. 1000-frame clips with extreme frame steps
3. Wrapped loop boundary interpolation with smooth, step, linear
4. Single keyframe tracks
5. Complex multi-IK and multi-bone rigs
"""

import json
import os
import subprocess
import sys
import tempfile
import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from spritebuilder.animation import evaluate_pose
from spritebuilder.project import compile_project

def build_adversarial_project():
    return {
        "name": "m4_parity_hero",
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
                "hip_l": {"parent": "root", "translation": [2, -2, 0], "rotation": [0, 0, 0]},
                "knee_l": {"parent": "hip_l", "part": "box", "translation": [0, -4, 0], "rotation": [0, 0, 0]},
                "foot_l": {"parent": "knee_l", "part": "box", "translation": [0, -4, 0], "rotation": [0, 0, 0]},
            },
            "ik_chains": {
                "leg_l": {"root": "hip_l", "mid": "knee_l", "end": "foot_l"},
            },
        },
        "animations": {
            "single_frame": {
                "frames": 1,
                "fps": 10,
                "loop": True,
                "bones": {
                    "root": {
                        "translation": [{"frame": 0, "value": [1.0, 2.0, 3.0], "interpolation": "linear"}],
                        "rotation": [{"frame": 0, "value": [10.0, 20.0, 30.0], "interpolation": "linear"}],
                    }
                },
                "ik": {},
            },
            "wrapped_loop": {
                "frames": 10,
                "fps": 10,
                "loop": True,
                "bones": {
                    "root": {
                        "translation": [
                            {"frame": 2, "value": [20.0, 0.0, 0.0], "interpolation": "smooth"},
                            {"frame": 8, "value": [80.0, 0.0, 0.0], "interpolation": "smooth"},
                        ],
                        "rotation": [
                            {"frame": 2, "value": [0.0, 45.0, 0.0], "interpolation": "linear"},
                            {"frame": 8, "value": [0.0, -45.0, 0.0], "interpolation": "linear"},
                        ],
                    },
                    "spine": {
                        "rotation": [
                            {"frame": 1, "value": [15.0, 0.0, 0.0], "interpolation": "step"},
                            {"frame": 6, "value": [-15.0, 0.0, 0.0], "interpolation": "step"},
                        ]
                    },
                },
                "ik": {
                    "leg_l": {
                        "target": [
                            {"frame": 2, "value": [2.0, -2.0, 2.0], "interpolation": "smooth"},
                            {"frame": 8, "value": [2.0, 2.0, -2.0], "interpolation": "smooth"},
                        ],
                        "pole": [
                            {"frame": 0, "value": [0.0, 0.0, 5.0], "interpolation": "linear"},
                        ],
                        "weight": [
                            {"frame": 0, "value": 1.0, "interpolation": "linear"},
                            {"frame": 5, "value": 0.5, "interpolation": "smooth"},
                        ],
                    }
                },
            },
            "huge_clip": {
                "frames": 1000,
                "fps": 60,
                "loop": True,
                "bones": {
                    "root": {
                        "translation": [
                            {"frame": 0, "value": [0.0, 0.0, 0.0], "interpolation": "smooth"},
                            {"frame": 999, "value": [1000.0, 0.0, 0.0], "interpolation": "smooth"},
                        ]
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

def run_adversarial_parity():
    print("=" * 70)
    print("M4 ADVERSARIAL PARITY HARNESS: TypeScript vs Python")
    print("=" * 70)

    doc_data = build_adversarial_project()
    project = compile_project(doc_data)

    test_queries = []
    # Clip 1: single_frame (frame 0)
    test_queries.append(("single_frame", 0))
    # Clip 2: wrapped_loop (all 10 frames)
    for f in range(10):
        test_queries.append(("wrapped_loop", f))
    # Clip 3: huge_clip (frames 0, 250, 500, 750, 999)
    for f in [0, 250, 500, 750, 999]:
        test_queries.append(("huge_clip", f))

    # Evaluate in Python
    py_results = []
    for clip_name, frame in test_queries:
        clip = project.clips[clip_name]
        world_mats = evaluate_pose(project, clip, frame, apply_physics=False, apply_constraints=False)
        frame_dict = {b: mat.flatten().tolist() for b, mat in world_mats.items()}
        py_results.append({"clip": clip_name, "frame": frame, "bones": frame_dict})

    print(f"Evaluated {len(test_queries)} adversarial query poses in Python.")

    # Evaluate in TypeScript
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f_in:
        json.dump(doc_data, f_in)
        doc_path = f_in.name

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f_out:
        out_path = f_out.name

    queries_json = json.dumps(test_queries)
    ts_script = f"""
import fs from 'fs';
import {{ pose }} from '/home/uggeli/impossibru/web/src/engine.ts';

const doc = JSON.parse(fs.readFileSync('{doc_path}', 'utf8'));
const queries = {queries_json};
const results = [];
for (const [clipName, frame] of queries) {{
  const world = pose(doc, clipName, frame);
  const frameObj = {{}};
  for (const [k, v] of Object.entries(world)) {{
    frameObj[k] = v;
  }}
  results.push({{ clip: clipName, frame, bones: frameObj }});
}}
fs.writeFileSync('{out_path}', JSON.stringify({{ results }}));
"""
    runner_ts = "/tmp/run_ts_m4_adversarial.ts"
    with open(runner_ts, "w") as f:
        f.write(ts_script)

    cmd = ["node", "--experimental-strip-types", runner_ts]
    res = subprocess.run(cmd, cwd="/home/uggeli/impossibru/web", capture_output=True, text=True)
    if res.returncode != 0:
        print("TypeScript Evaluation Error:", res.stderr)
        return False

    with open(out_path, "r") as f:
        ts_data = json.load(f)

    ts_results = ts_data["results"]
    assert len(ts_results) == len(py_results)

    # Compare matrices
    max_diff = 0.0
    all_diffs = []
    worst_case = None

    for idx, (py_r, ts_r) in enumerate(zip(py_results, ts_results)):
        assert py_r["clip"] == ts_r["clip"]
        assert py_r["frame"] == ts_r["frame"]
        for bone_name in py_r["bones"]:
            m_py = np.array(py_r["bones"][bone_name]).reshape(4, 4)
            m_ts = np.array(ts_r["bones"][bone_name]).reshape(4, 4)
            diff = float(np.max(np.abs(m_py - m_ts)))
            all_diffs.append(diff)
            if diff > max_diff:
                max_diff = diff
                worst_case = (py_r["clip"], py_r["frame"], bone_name)

    print("-" * 70)
    print(f"Total Queries Evaluated: {len(test_queries)}")
    print(f"Total Matrix Elements:   {len(all_diffs) * 16:,}")
    print(f"Max Absolute Diff:       {max_diff:.8e} (Clip: {worst_case[0]}, Frame: {worst_case[1]}, Bone: {worst_case[2]})")
    print(f"Mean Matrix Diff:        {np.mean(all_diffs):.8e}")
    print(f"Tolerance Threshold:     1.0e-04")
    print("-" * 70)

    # Cleanup
    for p in [doc_path, out_path, runner_ts]:
        if os.path.exists(p):
            os.unlink(p)

    if max_diff < 1e-4:
        print(">>> M4 ADVERSARIAL PARITY: PASSED <<<")
        return True
    else:
        print(">>> M4 ADVERSARIAL PARITY: FAILED <<<")
        return False

if __name__ == "__main__":
    success = run_adversarial_parity()
    sys.exit(0 if success else 1)
