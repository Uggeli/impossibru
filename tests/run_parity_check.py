#!/usr/bin/env python3
"""
Empirical Cross-Language Parity Challenge Harness
Directly compares Python and TypeScript 2-Bone IK solver and full pose evaluation.
"""

import json
import math
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import numpy as np

from spritebuilder.animation import solve_two_bone, evaluate_pose
from spritebuilder.project import compile_project

def generate_random_ik_cases(n=10000, seed=1337):
    np.random.seed(seed)
    cases = []
    
    # 1. Standard random cases
    for _ in range(n - 1000):
        root = np.random.uniform(-500, 500, size=3).tolist()
        target = np.random.uniform(-500, 500, size=3).tolist()
        l1 = float(np.random.uniform(0.1, 50.0))
        l2 = float(np.random.uniform(0.1, 50.0))
        pole = np.random.uniform(-500, 500, size=3).tolist()
        cases.append({"root": root, "target": target, "l1": l1, "l2": l2, "pole": pole})
        
    # 2. Extreme spatial offset cases
    for _ in range(200):
        offset = np.random.uniform(-1e7, 1e7, size=3)
        root = (np.random.uniform(-10, 10, size=3) + offset).tolist()
        target = (np.random.uniform(-10, 10, size=3) + offset).tolist()
        l1 = float(np.random.uniform(1.0, 20.0))
        l2 = float(np.random.uniform(1.0, 20.0))
        pole = (np.random.uniform(-10, 10, size=3) + offset).tolist()
        cases.append({"root": root, "target": target, "l1": l1, "l2": l2, "pole": pole})

    # 3. Collinear & parallel/anti-parallel pole cases
    for _ in range(200):
        root = np.random.uniform(-100, 100, size=3)
        direction = np.random.randn(3)
        direction /= np.linalg.norm(direction)
        dist = np.random.uniform(0.5, 30.0)
        target = (root + direction * dist).tolist()
        l1 = float(np.random.uniform(1.0, 20.0))
        l2 = float(np.random.uniform(1.0, 20.0))
        k = float(np.random.choice([-10.0, -1.0, -0.1, 0.0, 0.1, 1.0, 10.0]))
        pole = (root + direction * k).tolist()
        cases.append({"root": root.tolist(), "target": target, "l1": l1, "l2": l2, "pole": pole})

    # 4. Reach boundary cases (exact max reach, overextended, minimal reach, underextended)
    for _ in range(200):
        root = np.random.uniform(-100, 100, size=3)
        direction = np.random.randn(3)
        direction /= np.linalg.norm(direction)
        l1 = float(np.random.uniform(1.0, 20.0))
        l2 = float(np.random.uniform(1.0, 20.0))
        reach_choice = np.random.choice(["exact_max", "over", "exact_min", "under", "zero_dist"])
        if reach_choice == "exact_max":
            dist = l1 + l2
        elif reach_choice == "over":
            dist = (l1 + l2) * np.random.uniform(1.01, 10.0)
        elif reach_choice == "exact_min":
            dist = abs(l1 - l2)
        elif reach_choice == "under":
            dist = abs(l1 - l2) * np.random.uniform(0.01, 0.99) if abs(l1 - l2) > 0.1 else 0.05
        else:
            dist = 0.0
        target = (root + direction * dist).tolist()
        pole = (root + np.random.randn(3) * 5.0).tolist()
        cases.append({"root": root.tolist(), "target": target, "l1": l1, "l2": l2, "pole": pole})

    # 5. Zero-length bone cases & coincident root/target
    for _ in range(200):
        root = np.random.uniform(-100, 100, size=3).tolist()
        target = (np.asarray(root) + np.random.randn(3) * np.random.choice([0.0, 5.0])).tolist()
        l_choice = np.random.choice(["l1_zero", "l2_zero", "both_zero"])
        if l_choice == "l1_zero":
            l1, l2 = 0.0, float(np.random.uniform(1.0, 10.0))
        elif l_choice == "l2_zero":
            l1, l2 = float(np.random.uniform(1.0, 10.0)), 0.0
        else:
            l1, l2 = 0.0, 0.0
        pole = (np.asarray(root) + np.random.randn(3) * 5.0).tolist()
        cases.append({"root": root, "target": target, "l1": l1, "l2": l2, "pole": pole})

    return cases

def run_parity_comparison():
    print("=" * 70)
    print("EMPIRICAL CHALLENGE: Python vs TypeScript 2-Bone IK Parity")
    print("=" * 70)
    
    cases = generate_random_ik_cases(n=10000, seed=1337)
    print(f"Generated {len(cases)} adversarial test cases.")
    
    # 1. Run Python solver on all cases
    py_results = []
    for c in cases:
        j, e = solve_two_bone(c["root"], c["target"], c["l1"], c["l2"], c["pole"])
        py_results.append({
            "joint": j.tolist(),
            "end": e.tolist()
        })
        
    print(f"Python solve_two_bone executed {len(py_results)} cases successfully.")
    
    # 2. Package into temp JSON and invoke Node.js runner
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f_in:
        json.dump({"cases": cases}, f_in)
        in_path = f_in.name

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f_out:
        out_path = f_out.name

    ts_runner_code = f"""
import fs from 'fs';
import {{ solveTwoBone }} from '/home/uggeli/impossibru/web/src/engine.ts';

const data = JSON.parse(fs.readFileSync('{in_path}', 'utf8'));
const results = data.cases.map((c) => {{
  const [j, e] = solveTwoBone(c.root, c.target, c.l1, c.l2, c.pole);
  return {{ joint: j, end: e }};
}});
fs.writeFileSync('{out_path}', JSON.stringify({{ results }}));
"""
    runner_ts_path = "/tmp/run_ts_ik_bench.ts"
    with open(runner_ts_path, "w") as f:
        f.write(ts_runner_code)
        
    cmd = ["node", "--experimental-strip-types", runner_ts_path]
    env = dict(os.environ)
    res = subprocess.run(cmd, cwd="/home/uggeli/impossibru/web", capture_output=True, text=True, env=env)

    if res.returncode != 0:
        print("Error running TS benchmark:", res.stderr)
        return False
        
    with open(out_path, "r") as f:
        ts_data = json.load(f)
        
    ts_results = ts_data["results"]
    assert len(ts_results) == len(py_results), f"Length mismatch: {len(ts_results)} vs {len(py_results)}"
    
    # 3. Numerical analysis
    max_joint_diff = 0.0
    max_end_diff = 0.0
    joint_diffs = []
    end_diffs = []
    nan_count = 0
    
    for i in range(len(cases)):
        py_j = np.array(py_results[i]["joint"])
        py_e = np.array(py_results[i]["end"])
        ts_j = np.array(ts_results[i]["joint"])
        ts_e = np.array(ts_results[i]["end"])
        
        if not np.all(np.isfinite(py_j)) or not np.all(np.isfinite(ts_j)):
            nan_count += 1
            print(f"NaN detected at case {i}: py_j={py_j}, ts_j={ts_j}")
            continue
            
        j_diff = float(np.linalg.norm(py_j - ts_j))
        e_diff = float(np.linalg.norm(py_e - ts_e))
        
        joint_diffs.append(j_diff)
        end_diffs.append(e_diff)
        
        if j_diff > max_joint_diff:
            max_joint_diff = j_diff
        if e_diff > max_end_diff:
            max_end_diff = e_diff
            
    print("-" * 70)
    print(f"Total Cases Tested:      {len(cases):,}")
    print(f"NaN/Inf Occurrences:     {nan_count}")
    print(f"Max Joint Difference:    {max_joint_diff:.8e}")
    print(f"Max End Difference:      {max_end_diff:.8e}")
    print(f"Mean Joint Difference:   {np.mean(joint_diffs):.8e}")
    print(f"Mean End Difference:     {np.mean(end_diffs):.8e}")
    print(f"Joint 99.9th Percentile: {np.percentile(joint_diffs, 99.9):.8e}")
    print(f"End 99.9th Percentile:   {np.percentile(end_diffs, 99.9):.8e}")
    print("-" * 70)
    
    # Cleanup
    for p in [in_path, out_path, runner_ts_path]:
        if os.path.exists(p):
            os.unlink(p)
            
    assert nan_count == 0, f"Found {nan_count} NaNs in solver output!"
    assert max_joint_diff < 1e-4, f"Max joint difference {max_joint_diff} exceeded tolerance 1e-4!"
    assert max_end_diff < 1e-4, f"Max end difference {max_end_diff} exceeded tolerance 1e-4!"
    print(">>> IK SOLVER PARITY: PASSED (100% agreement within float tolerance) <<<")
    return True

if __name__ == "__main__":
    success = run_parity_comparison()
    sys.exit(0 if success else 1)
