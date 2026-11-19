"""
Comprehensive Adversarial Stress Test Suite for 2-Bone IK Solver (Python).
Tests extreme offsets, collinearities, reach boundaries, singularities, and numerical stability.
"""

import math
import unittest
import numpy as np

from spritebuilder.animation import solve_two_bone, rot_from_to, evaluate_pose, slerp_matrix, matrix_from_quat, euler_matrix
from spritebuilder.project import compile_project, Project


class TestIKAdversarialStress(unittest.TestCase):

    def test_extreme_spatial_offsets_translational_invariance(self):
        """Test translational invariance under massive spatial offsets."""
        offsets = [
            np.array([1000.0, -500.0, 250.0]),
            np.array([1e6, -1e6, 1e6]),
            np.array([-1e8, 1e8, 0.0]),
            np.array([1e10, -1e10, 5e9]),
        ]
        
        base_cases = [
            (np.array([0., 0., 0.]), np.array([1., 3., 2.]), 2.5, 3.0, np.array([0., 1., 0.])),
            (np.array([1., 2., 3.]), np.array([4., 5., 6.]), 4.0, 4.0, np.array([0., 0., 1.])),
            (np.array([-5., 10., -2.]), np.array([3., -1., 4.]), 10.0, 8.0, np.array([1., -1., 1.])),
        ]

        for root0, target0, l1, l2, pole0 in base_cases:
            j0, e0 = solve_two_bone(root0, target0, l1, l2, pole0)
            rel_j0 = j0 - root0
            rel_e0 = e0 - root0

            for offset in offsets:
                root = root0 + offset
                target = target0 + offset
                pole = pole0 + offset

                j, e = solve_two_bone(root, target, l1, l2, pole)
                rel_j = j - root
                rel_e = e - root

                np.testing.assert_allclose(rel_j, rel_j0, atol=1e-5,
                    err_msg=f"Joint relative offset failed at offset {offset}")
                np.testing.assert_allclose(rel_e, rel_e0, atol=1e-5,
                    err_msg=f"End relative offset failed at offset {offset}")

    def test_collinear_targets_and_pole_vectors_all_axes(self):
        """Test collinear pole vectors parallel and anti-parallel across all 3D primary axes."""
        axes = [
            np.array([1., 0., 0.]),
            np.array([-1., 0., 0.]),
            np.array([0., 1., 0.]),
            np.array([0., -1., 0.]),
            np.array([0., 0., 1.]),
            np.array([0., 0., -1.]),
            np.array([1., 1., 1.]) / math.sqrt(3),
            np.array([-1., 2., -2.]) / 3.0,
        ]

        root = np.array([5.0, -3.0, 2.0])
        l1, l2 = 3.0, 3.0
        reach = 4.0

        for axis in axes:
            target = root + axis * reach

            # Parallel pole (k > 0)
            for k in [0.5, 1.0, 5.0, 100.0]:
                pole_parallel = root + axis * k
                j, e = solve_two_bone(root, target, l1, l2, pole_parallel)
                self.assertTrue(np.all(np.isfinite(j)), f"NaN/Inf in joint for parallel axis {axis} k={k}")
                self.assertTrue(np.all(np.isfinite(e)), f"NaN/Inf in end for parallel axis {axis} k={k}")
                self.assertAlmostEqual(np.linalg.norm(j - root), l1, places=4)
                self.assertAlmostEqual(np.linalg.norm(e - j), l2, places=4)
                self.assertAlmostEqual(np.linalg.norm(e - target), 0.0, places=4)

            # Anti-parallel pole (k < 0)
            for k in [-0.5, -1.0, -5.0]:
                pole_antiparallel = root + axis * k
                j, e = solve_two_bone(root, target, l1, l2, pole_antiparallel)
                self.assertTrue(np.all(np.isfinite(j)), f"NaN/Inf in joint for anti-parallel axis {axis} k={k}")
                self.assertTrue(np.all(np.isfinite(e)), f"NaN/Inf in end for anti-parallel axis {axis} k={k}")
                self.assertAlmostEqual(np.linalg.norm(j - root), l1, places=4)
                self.assertAlmostEqual(np.linalg.norm(e - j), l2, places=4)

            # Zero pole vector at root
            pole_zero = root.copy()
            j, e = solve_two_bone(root, target, l1, l2, pole_zero)
            self.assertTrue(np.all(np.isfinite(j)), f"NaN/Inf for zero pole on axis {axis}")
            self.assertTrue(np.all(np.isfinite(e)), f"NaN/Inf for zero pole on axis {axis}")
            self.assertAlmostEqual(np.linalg.norm(j - root), l1, places=4)
            self.assertAlmostEqual(np.linalg.norm(e - j), l2, places=4)

    def test_reach_limits_overextension_and_underextension(self):
        """Test overextension (d > l1+l2) and underextension (d < |l1-l2|) boundaries."""
        root = np.array([0., 0., 0.])
        pole = np.array([0., 0., 1.])
        dir_vec = np.array([0., 1., 0.])

        # 1. Overextension with l1=3, l2=3 (max reach 6)
        l1, l2 = 3.0, 3.0
        for dist in [6.0, 6.00001, 10.0, 100.0, 10000.0]:
            target = root + dir_vec * dist
            j, e = solve_two_bone(root, target, l1, l2, pole)
            self.assertTrue(np.all(np.isfinite(j)))
            self.assertTrue(np.all(np.isfinite(e)))
            self.assertAlmostEqual(np.linalg.norm(j - root), l1, places=3)
            self.assertAlmostEqual(np.linalg.norm(e - j), l2, places=3)
            # End should be clamped near max reach 6.0
            self.assertAlmostEqual(np.linalg.norm(e - root), min(dist, l1 + l2 - 1e-6), places=3)

        # 2. Underextension: Case A: l1=5, l2=2 (min reach 3, max reach 7)
        l1, l2 = 5.0, 2.0
        for dist in [3.0, 2.99999, 1.5, 0.5, 0.001]:
            target = root + dir_vec * dist
            j, e = solve_two_bone(root, target, l1, l2, pole)
            self.assertTrue(np.all(np.isfinite(j)))
            self.assertTrue(np.all(np.isfinite(e)))
            self.assertAlmostEqual(np.linalg.norm(j - root), l1, places=3)
            self.assertAlmostEqual(np.linalg.norm(e - j), l2, places=3)
            # End clamped near min reach |5-2| = 3.0
            self.assertAlmostEqual(np.linalg.norm(e - root), max(abs(l1-l2) + 1e-6, dist), places=3)

        # 3. Underextension: Case B: l1=2, l2=5 (min reach 3, max reach 7)
        l1, l2 = 2.0, 5.0
        for dist in [3.0, 2.99999, 1.5, 0.5, 0.001]:
            target = root + dir_vec * dist
            j, e = solve_two_bone(root, target, l1, l2, pole)
            self.assertTrue(np.all(np.isfinite(j)))
            self.assertTrue(np.all(np.isfinite(e)))
            self.assertAlmostEqual(np.linalg.norm(j - root), l1, places=3)
            self.assertAlmostEqual(np.linalg.norm(e - j), l2, places=3)
            self.assertAlmostEqual(np.linalg.norm(e - root), max(abs(l1-l2) + 1e-6, dist), places=3)

    def test_zero_length_bones_and_coincident_target(self):
        """Test zero-length bone segments and coincident root/target singularities."""
        root = np.array([10.0, 20.0, 30.0])
        pole = np.array([10.0, 20.0, 31.0])

        # l1 = 0, l2 = 5
        j, e = solve_two_bone(root, root + np.array([0., 4., 0.]), 0.0, 5.0, pole)
        self.assertTrue(np.all(np.isfinite(j)))
        self.assertTrue(np.all(np.isfinite(e)))
        self.assertAlmostEqual(np.linalg.norm(j - root), 0.0, places=4)

        # l1 = 5, l2 = 0
        j, e = solve_two_bone(root, root + np.array([0., 4., 0.]), 5.0, 0.0, pole)
        self.assertTrue(np.all(np.isfinite(j)))
        self.assertTrue(np.all(np.isfinite(e)))
        self.assertAlmostEqual(np.linalg.norm(j - root), 5.0, places=3)

        # l1 = 0, l2 = 0
        j, e = solve_two_bone(root, root + np.array([0., 4., 0.]), 0.0, 0.0, pole)
        self.assertTrue(np.all(np.isfinite(j)))
        self.assertTrue(np.all(np.isfinite(e)))

        # Coincident target: target == root (distance 0)
        j, e = solve_two_bone(root, root, 3.0, 3.0, pole)
        self.assertTrue(np.all(np.isfinite(j)))
        self.assertTrue(np.all(np.isfinite(e)))
        self.assertAlmostEqual(np.linalg.norm(j - root), 3.0, places=4)

    def test_rot_from_to_and_singularity_conditions(self):
        """Test rot_from_to matrix properties under 0 deg, 180 deg, and random 3D rotations."""
        test_vectors = [
            (np.array([1., 0., 0.]), np.array([1., 0., 0.])),      # Identity
            (np.array([1., 0., 0.]), np.array([-1., 0., 0.])),     # 180 deg on X
            (np.array([0., 1., 0.]), np.array([0., -1., 0.])),     # 180 deg on Y
            (np.array([0., 0., 1.]), np.array([0., 0., -1.])),     # 180 deg on Z
            (np.array([1., 0., 0.]), np.array([0., 1., 0.])),      # 90 deg X->Y
            (np.array([1., 1., 1.]), np.array([-1., -1., -1.])),   # 180 deg diagonal
            (np.array([0., 1., 0.]), np.array([1e-7, -1., 0.])),   # Near 180 deg
            (np.array([0., 1., 0.]), np.array([1e-7, 1., 0.])),    # Near 0 deg
        ]

        np.random.seed(42)
        for _ in range(100):
            a = np.random.randn(3)
            b = np.random.randn(3)
            test_vectors.append((a, b))

        for a, b in test_vectors:
            R = rot_from_to(a, b)
            self.assertTrue(np.all(np.isfinite(R)), f"rot_from_to produced NaN/Inf for a={a}, b={b}")
            
            # Check orthogonality: R @ R.T = I
            np.testing.assert_allclose(R @ R.T, np.eye(3), atol=1e-5,
                err_msg=f"Rotation matrix not orthogonal for a={a}, b={b}")
            
            # Check determinant = +1 (proper rotation, no reflection)
            self.assertAlmostEqual(np.linalg.det(R), 1.0, places=5)

            # Check that R transforms normalized a to normalized b
            na = a / np.linalg.norm(a)
            nb = b / np.linalg.norm(b)
            transformed = R @ na
            np.testing.assert_allclose(transformed, nb, atol=1e-5,
                err_msg=f"R @ a did not equal b for a={a}, b={b}")


if __name__ == '__main__':
    unittest.main()
