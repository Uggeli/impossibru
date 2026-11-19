"""Dynamic secondary spring physics bones and constraints."""
from __future__ import annotations

from dataclasses import dataclass, field
import math
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np


@dataclass
class SpringBoneConfig:
    bone_name: str
    stiffness: float = 100.0
    damping: float = 10.0
    mass: float = 1.0
    drag: float = 0.1
    gravity: np.ndarray = field(default_factory=lambda: np.array([0.0, -9.81, 0.0]))
    limit_angle: Optional[float] = 45.0


@dataclass
class SplineSpineConstraint:
    name: str
    bones: List[str]
    driver: Optional[str] = None
    total_rotation: Optional[Tuple[float, float, float]] = None


@dataclass
class MirrorConstraint:
    name: str
    source: str
    target: str
    plane: str = "yz"
    influence: float = 1.0


@dataclass
class CopyRotationConstraint:
    name: str
    source: str
    target: str
    influence: float = 1.0
    axes: Tuple[bool, bool, bool] = (True, True, True)
    invert: Tuple[bool, bool, bool] = (False, False, False)


Constraint = Union[SplineSpineConstraint, MirrorConstraint, CopyRotationConstraint]


def _update_descendant_world_transforms(project: Any, parent_name: str,
                                        world_pose: Dict[str, np.ndarray],
                                        old_parent_rot: np.ndarray,
                                        new_parent_rot: np.ndarray) -> None:
    """Propagate rotation change of parent_name down to its descendant bones."""
    from .animation import matrix4
    r_delta = new_parent_rot @ old_parent_rot.T
    p_head = world_pose[parent_name][:3, 3]

    # Process bones in topological order after parent_name
    found = False
    for name in project.bone_order:
        if name == parent_name:
            found = True
            continue
        if not found:
            continue
        # Check if name is descendant of parent_name
        curr = project.bones[name].parent
        is_desc = False
        while curr:
            if curr == parent_name:
                is_desc = True
                break
            curr = project.bones[curr].parent
        if is_desc:
            w = world_pose[name]
            old_pos = w[:3, 3]
            old_rot = w[:3, :3]
            new_pos = p_head + r_delta @ (old_pos - p_head)
            new_rot = r_delta @ old_rot
            world_pose[name] = matrix4(new_rot, new_pos)


def evaluate_constraints(project: Any, world_pose: Dict[str, np.ndarray],
                         constraints: Optional[List[Constraint]] = None) -> Dict[str, np.ndarray]:
    """Evaluate bone constraints on a world pose and return the modified pose."""
    from .rigging import euler_from_matrix
    from .animation import euler_matrix, matrix4, slerp_matrix

    world = {name: mat.copy() for name, mat in world_pose.items()}
    if constraints is None:
        constraints = getattr(project, "constraints", [])
    if not constraints:
        return world

    for constraint in constraints:
        if isinstance(constraint, SplineSpineConstraint):
            bones = constraint.bones
            if not bones:
                continue
            n = len(bones)
            if constraint.driver and constraint.driver in project.bones:
                r_driver = world[constraint.driver][:3, :3]
                r_rest = euler_matrix(project.bones[constraint.driver].rotation)
                r_total = r_driver @ r_rest.T
            elif constraint.total_rotation is not None:
                r_total = euler_matrix(constraint.total_rotation)
            else:
                r_total = np.eye(3)

            angles = euler_from_matrix(r_total)
            per_vertebra = [a / n for a in angles]
            r_step = euler_matrix(per_vertebra)

            for b in bones:
                if b not in world:
                    continue
                old_rot = world[b][:3, :3].copy()
                new_rot = old_rot @ r_step
                world[b][:3, :3] = new_rot
                _update_descendant_world_transforms(project, b, world, old_rot, new_rot)

        elif isinstance(constraint, MirrorConstraint):
            src, tgt = constraint.source, constraint.target
            if src not in world or tgt not in world:
                continue
            plane = constraint.plane.lower()
            if plane in ("yz", "x"):
                m = np.diag([-1.0, 1.0, 1.0])
            elif plane in ("xz", "y"):
                m = np.diag([1.0, -1.0, 1.0])
            elif plane in ("xy", "z"):
                m = np.diag([1.0, 1.0, -1.0])
            else:
                m = np.diag([-1.0, 1.0, 1.0])

            src_world = world[src]
            p_mirrored = m @ src_world[:3, 3]
            r_mirrored = m @ src_world[:3, :3] @ m

            tgt_world = world[tgt]
            old_p = tgt_world[:3, 3]
            old_r = tgt_world[:3, :3].copy()

            inf = max(0.0, min(1.0, float(constraint.influence)))
            p_final = (1.0 - inf) * old_p + inf * p_mirrored
            r_final = slerp_matrix(old_r, r_mirrored, inf)

            world[tgt] = matrix4(r_final, p_final)
            _update_descendant_world_transforms(project, tgt, world, old_r, r_final)

        elif isinstance(constraint, CopyRotationConstraint):
            src, tgt = constraint.source, constraint.target
            if src not in world or tgt not in world:
                continue
            src_r = world[src][:3, :3]
            axes = constraint.axes
            invert = constraint.invert

            if not all(axes) or any(invert):
                angles = euler_from_matrix(src_r)
                mod_angles = []
                for i in range(3):
                    a = angles[i]
                    if invert[i]:
                        a = -a
                    if not axes[i]:
                        a = 0.0
                    mod_angles.append(a)
                src_r = euler_matrix(mod_angles)

            tgt_world = world[tgt]
            old_r = tgt_world[:3, :3].copy()
            inf = max(0.0, min(1.0, float(constraint.influence)))
            r_final = slerp_matrix(old_r, src_r, inf)

            world[tgt][:3, :3] = r_final
            _update_descendant_world_transforms(project, tgt, world, old_r, r_final)

    return world


class SpringBoneSolver:
    """3D Damped Harmonic Oscillator solver for secondary spring bones."""

    def __init__(self, project: Any):
        self.project = project
        self.spring_bones: Dict[str, SpringBoneConfig] = getattr(project, "spring_bones", {})
        self.local_tips: Dict[str, np.ndarray] = {}
        self.state: Dict[str, Dict[str, np.ndarray]] = {}

        # Compute rest pose to determine local tip vectors
        from .animation import evaluate_rest_pose
        rest_pose = evaluate_rest_pose(project)

        for bone_name in project.bone_order:
            if bone_name in self.spring_bones:
                self.local_tips[bone_name] = self._compute_local_tip(project, bone_name, rest_pose)

        self.reset(rest_pose)

    def _compute_local_tip(self, project: Any, bone_name: str, rest_pose: Dict[str, np.ndarray]) -> np.ndarray:
        # Find direct children of bone_name
        children = [name for name, bone in project.bones.items() if bone.parent == bone_name]
        b_head = rest_pose[bone_name][:3, 3]
        b_rot = rest_pose[bone_name][:3, :3]

        if children:
            child_positions = [rest_pose[c][:3, 3] for c in children]
            avg_child_world = np.mean(child_positions, axis=0)
            local_tip = b_rot.T @ (avg_child_world - b_head)
            if np.linalg.norm(local_tip) > 1e-6:
                return local_tip

        # Fallback to bone translation or default unit vector along bone direction
        bone_trans = project.bones[bone_name].translation
        if np.linalg.norm(bone_trans) > 1e-6:
            return bone_trans.copy()

        return np.array([0.0, 1.0, 0.0])

    def reset(self, world_pose: Optional[Dict[str, np.ndarray]] = None) -> None:
        """Reset solver state (velocities to 0, positions to kinematic target)."""
        if world_pose is None:
            from .animation import evaluate_rest_pose
            world_pose = evaluate_rest_pose(self.project)

        self.state.clear()
        for bone_name in self.project.bone_order:
            if bone_name in self.spring_bones:
                p_head = world_pose[bone_name][:3, 3]
                v_tip_local = self.local_tips[bone_name]
                target_tip = p_head + world_pose[bone_name][:3, :3] @ v_tip_local
                self.state[bone_name] = {
                    "pos": target_tip.copy(),
                    "vel": np.zeros(3, dtype=float),
                    "prev_head": p_head.copy(),
                }

    def step(self, world_pose: Dict[str, np.ndarray], dt: float) -> Dict[str, np.ndarray]:
        """Step spring physics forward by dt seconds."""
        from .animation import norm, rot_from_to

        updated_pose = {name: mat.copy() for name, mat in world_pose.items()}
        if not self.spring_bones:
            return updated_pose

        if dt <= 0:
            # Re-align tip positions with current pose without advancing velocity
            for bone_name in self.project.bone_order:
                if bone_name in self.spring_bones and bone_name in self.state:
                    p_head = updated_pose[bone_name][:3, 3]
                    v_tip_local = self.local_tips[bone_name]
                    target_tip = p_head + updated_pose[bone_name][:3, :3] @ v_tip_local
                    self.state[bone_name]["pos"] = target_tip.copy()
                    self.state[bone_name]["vel"] = np.zeros(3, dtype=float)
                    self.state[bone_name]["prev_head"] = p_head.copy()
            return updated_pose

        for bone_name in self.project.bone_order:
            if bone_name not in self.spring_bones:
                continue

            cfg = self.spring_bones[bone_name]
            p_head = updated_pose[bone_name][:3, 3].copy()
            v_tip_local = self.local_tips[bone_name]
            target_tip = p_head + updated_pose[bone_name][:3, :3] @ v_tip_local
            bone_len = float(np.linalg.norm(v_tip_local))
            if bone_len < 1e-6:
                bone_len = 1.0

            if bone_name not in self.state:
                self.state[bone_name] = {
                    "pos": target_tip.copy(),
                    "vel": np.zeros(3, dtype=float),
                    "prev_head": p_head.copy(),
                }

            st = self.state[bone_name]
            pos = st["pos"].copy()
            vel = st["vel"].copy()

            # Substepping for numerical stability
            substeps = max(1, int(math.ceil(dt / 0.002)))
            sub_dt = dt / substeps

            for _ in range(substeps):
                f_spring = -cfg.stiffness * (pos - target_tip)
                f_damping = -cfg.damping * vel
                f_drag = -cfg.drag * vel
                f_gravity = cfg.mass * np.asarray(cfg.gravity, dtype=float)
                accel = (f_spring + f_damping + f_drag + f_gravity) / max(1e-6, cfg.mass)

                vel = vel + accel * sub_dt
                pos = pos + vel * sub_dt

                # Angle limit constraint
                if cfg.limit_angle is not None and cfg.limit_angle < 180.0:
                    delta = pos - p_head
                    dist = float(np.linalg.norm(delta))
                    target_dir = norm(target_tip - p_head)
                    if dist > 1e-9:
                        dir_vec = delta / dist
                        dot_val = float(np.clip(np.dot(dir_vec, target_dir), -1.0, 1.0))
                        angle = math.acos(dot_val)
                        max_angle = math.radians(cfg.limit_angle)
                        if angle > max_angle:
                            u = target_dir
                            perp = dir_vec - np.dot(dir_vec, u) * u
                            perp_norm = float(np.linalg.norm(perp))
                            if perp_norm > 1e-9:
                                v = perp / perp_norm
                                dir_vec = math.cos(max_angle) * u + math.sin(max_angle) * v
                            else:
                                dir_vec = u
                            pos = p_head + dist * dir_vec

            st["vel"] = vel.copy()
            st["pos"] = pos.copy()
            st["prev_head"] = p_head.copy()

            # Compute bone rotation update to align bone tip with simulated tip
            target_dir = norm(target_tip - p_head)
            sim_dir = norm(pos - p_head)
            if np.linalg.norm(target_dir) > 1e-6 and np.linalg.norm(sim_dir) > 1e-6:
                r_rot = rot_from_to(target_dir, sim_dir)
                old_r = updated_pose[bone_name][:3, :3].copy()
                new_r = r_rot @ old_r
                updated_pose[bone_name][:3, :3] = new_r
                _update_descendant_world_transforms(self.project, bone_name, updated_pose, old_r, new_r)

        return updated_pose
