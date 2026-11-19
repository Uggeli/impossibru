from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple
import numpy as np

from .animation import (
    _world_from_local,
    euler_matrix,
    evaluate_rest_pose,
    norm,
    rot_from_to,
    slerp_matrix,
)
from .project import Clip, Project


class GaitSynthesizer:
    """Overgrowth-style walk/run cycle generator.

    Computes sinusoidal pelvis movement (bounce and lateral sway), stride phase,
    leg IK target arcing (for stance/swing foot planting), and counter-arm swing.
    """

    def __init__(
        self,
        speed: float = 1.0,
        stride_length: float = 4.0,
        stride_height: float = 2.0,
        hip_bounce: float = 0.5,
        arm_swing: float = 25.0,
        left_leg_chain: str = "left_leg",
        right_leg_chain: str = "right_leg",
        left_arm_bone: str = "left_upper_arm",
        right_arm_bone: str = "right_upper_arm",
        root_bone: str = "root",
    ):
        self.speed = float(speed)
        self.stride_length = float(stride_length)
        self.stride_height = float(stride_height)
        self.hip_bounce = float(hip_bounce)
        self.arm_swing = float(arm_swing)
        self.left_leg_chain = left_leg_chain
        self.right_leg_chain = right_leg_chain
        self.left_arm_bone = left_arm_bone
        self.right_arm_bone = right_arm_bone
        self.root_bone = root_bone

    def evaluate(
        self,
        time: float,
        project: Project,
        local_r: Dict[str, np.ndarray],
        local_t: Dict[str, np.ndarray],
        ik_targets: Dict[str, Dict[str, Any]],
    ) -> None:
        if self.speed <= 0:
            return

        frequency = self.speed
        phi = 2.0 * math.pi * frequency * time

        # Calculate leg phases (left leg 0..1, right leg offset by 0.5)
        u_left = (frequency * time) % 1.0
        u_right = (frequency * time + 0.5) % 1.0

        def calc_foot_offset(u: float) -> Tuple[float, float]:
            if u < 0.5:
                # Stance phase: foot planted, slides backward
                s = u / 0.5
                z = (self.stride_length / 2.0) * (1.0 - 2.0 * s)
                y = 0.0
            else:
                # Swing phase: foot lifts up in parabolic arc and moves forward
                s = (u - 0.5) / 0.5
                z = (self.stride_length / 2.0) * (2.0 * s - 1.0)
                y = self.stride_height * math.sin(math.pi * s)
            return y, z

        y_l, z_l = calc_foot_offset(u_left)
        y_r, z_r = calc_foot_offset(u_right)

        rest_world = evaluate_rest_pose(project)

        if self.left_leg_chain in project.ik_chains:
            chain_l = project.ik_chains[self.left_leg_chain]
            base_pos_l = rest_world[chain_l.end][:3, 3].copy()
            target_l = base_pos_l + np.array([0.0, y_l, z_l])
            mid_p = rest_world[chain_l.mid][:3, 3]
            pole_l = mid_p + np.array([0.0, 0.0, 5.0])
            ik_targets[self.left_leg_chain] = {
                "target": target_l,
                "pole": pole_l,
                "weight": 1.0,
            }

        if self.right_leg_chain in project.ik_chains:
            chain_r = project.ik_chains[self.right_leg_chain]
            base_pos_r = rest_world[chain_r.end][:3, 3].copy()
            target_r = base_pos_r + np.array([0.0, y_r, z_r])
            mid_p = rest_world[chain_r.mid][:3, 3]
            pole_r = mid_p + np.array([0.0, 0.0, 5.0])
            ik_targets[self.right_leg_chain] = {
                "target": target_r,
                "pole": pole_r,
                "weight": 1.0,
            }

        # Pelvis movement (vertical bounce & lateral sway)
        y_bounce = -self.hip_bounce * (0.5 - 0.5 * math.cos(2.0 * phi))
        x_sway = 0.5 * self.hip_bounce * math.sin(phi)
        z_roll = 3.0 * math.sin(phi)

        if self.root_bone in local_t:
            local_t[self.root_bone] = local_t[self.root_bone] + np.array([x_sway, y_bounce, 0.0])
        if self.root_bone in local_r:
            local_r[self.root_bone] = local_r[self.root_bone] @ euler_matrix([0.0, 0.0, z_roll])

        # Counter-arm swing (left arm swings opposite to left leg)
        arm_pitch = self.arm_swing * math.sin(phi)
        if self.left_arm_bone in local_r:
            local_r[self.left_arm_bone] = local_r[self.left_arm_bone] @ euler_matrix([arm_pitch, 0.0, 0.0])
        if self.right_arm_bone in local_r:
            local_r[self.right_arm_bone] = local_r[self.right_arm_bone] @ euler_matrix([-arm_pitch, 0.0, 0.0])


class PhysicsLeanSway:
    """Directional velocity tilt, turn banking, and landing compression springs."""

    def __init__(
        self,
        velocity: Sequence[float] = (0.0, 0.0, 0.0),
        acceleration: Sequence[float] = (0.0, 0.0, 0.0),
        turn_rate: float = 0.0,
        landing_impact: float = 0.0,
        pitch_factor: float = 5.0,
        roll_factor: float = 5.0,
        banking_factor: float = 10.0,
        stiffness: float = 100.0,
        damping: float = 10.0,
        root_bone: str = "root",
        torso_bone: str = "torso",
    ):
        self.velocity = np.asarray(velocity, dtype=float)
        self.acceleration = np.asarray(acceleration, dtype=float)
        self.turn_rate = float(turn_rate)
        self.landing_impact = float(landing_impact)
        self.pitch_factor = float(pitch_factor)
        self.roll_factor = float(roll_factor)
        self.banking_factor = float(banking_factor)
        self.stiffness = float(stiffness)
        self.damping = float(damping)
        self.root_bone = root_bone
        self.torso_bone = torso_bone

        self.compression_displacement = 0.0
        self.compression_velocity = 0.0

    def update(
        self,
        dt: float,
        velocity: Optional[Sequence[float]] = None,
        acceleration: Optional[Sequence[float]] = None,
        turn_rate: Optional[float] = None,
        landing_impact: Optional[float] = None,
    ) -> None:
        if velocity is not None:
            self.velocity = np.asarray(velocity, dtype=float)
        if acceleration is not None:
            self.acceleration = np.asarray(acceleration, dtype=float)
        if turn_rate is not None:
            self.turn_rate = float(turn_rate)
        impact = landing_impact if landing_impact is not None else self.landing_impact
        if impact > 0:
            self.compression_velocity -= float(impact)
            self.landing_impact = 0.0

        # Update damped spring harmonic oscillator for compression
        accel = -self.stiffness * self.compression_displacement - self.damping * self.compression_velocity
        self.compression_velocity += accel * dt
        self.compression_displacement += self.compression_velocity * dt

    def evaluate(
        self,
        local_r: Dict[str, np.ndarray],
        local_t: Dict[str, np.ndarray],
    ) -> None:
        a_x, a_y, a_z = self.acceleration[0], self.acceleration[1], self.acceleration[2]

        # Pitch lag: forward acceleration leans backward, deceleration leans forward
        theta_pitch = -a_z * self.pitch_factor

        # Roll lag & turn banking: lateral acceleration leans opposite, turn rate banks into turn
        theta_roll = -a_x * self.roll_factor - self.turn_rate * self.banking_factor

        target_bone = self.torso_bone if self.torso_bone in local_r else self.root_bone
        if target_bone in local_r:
            local_r[target_bone] = local_r[target_bone] @ euler_matrix([theta_pitch, 0.0, theta_roll])

        if self.root_bone in local_t:
            local_t[self.root_bone] = local_t[self.root_bone] + np.array([0.0, self.compression_displacement, 0.0])


class IdleBreathingGenerator:
    """Harmonic chest elevation, subtle pitch sway, and head balance adjustments."""

    def __init__(
        self,
        rate: float = 0.25,
        intensity: float = 1.0,
        chest_bone: str = "torso",
        head_bone: str = "head",
    ):
        self.rate = float(rate)
        self.intensity = float(intensity)
        self.chest_bone = chest_bone
        self.head_bone = head_bone

    def evaluate(
        self,
        time: float,
        local_r: Dict[str, np.ndarray],
        local_t: Dict[str, np.ndarray],
    ) -> None:
        phase = 2.0 * math.pi * self.rate * time
        sine = math.sin(phase)
        cosine = math.cos(phase)

        chest_y = 0.3 * self.intensity * (0.5 + 0.5 * sine)
        chest_pitch = 1.5 * self.intensity * sine

        if self.chest_bone in local_t:
            local_t[self.chest_bone] = local_t[self.chest_bone] + np.array([0.0, chest_y, 0.0])
        if self.chest_bone in local_r:
            local_r[self.chest_bone] = local_r[self.chest_bone] @ euler_matrix([chest_pitch, 0.0, 0.0])

        head_pitch = -0.7 * chest_pitch + 0.5 * self.intensity * cosine
        if self.head_bone in local_r:
            local_r[self.head_bone] = local_r[self.head_bone] @ euler_matrix([head_pitch, 0.0, 0.0])


class LookAtSolver:
    """Solves hierarchical rotation across spine/neck/head toward a 3D target coordinate."""

    def __init__(
        self,
        target: Sequence[float] = (0.0, 0.0, 10.0),
        head_bone: str = "head",
        neck_bone: Optional[str] = None,
        spine_bones: Optional[List[str]] = None,
        weights: Optional[Dict[str, float]] = None,
        max_angle: float = 75.0,
    ):
        self.target = np.asarray(target, dtype=float)
        self.head_bone = head_bone
        self.neck_bone = neck_bone
        self.spine_bones = spine_bones if spine_bones is not None else ["torso"]
        self.max_angle = float(max_angle)
        self.user_weights = weights

    def solve(
        self,
        project: Project,
        local_r: Dict[str, np.ndarray],
        local_t: Dict[str, np.ndarray],
        world: Dict[str, np.ndarray],
    ) -> Dict[str, np.ndarray]:
        # Gather hierarchy bones in topological order
        hierarchy_raw = list(self.spine_bones)
        if self.neck_bone and self.neck_bone not in hierarchy_raw:
            hierarchy_raw.append(self.neck_bone)
        if self.head_bone and self.head_bone not in hierarchy_raw:
            hierarchy_raw.append(self.head_bone)

        hierarchy = [b for b in project.bone_order if b in hierarchy_raw]
        if not hierarchy:
            return world

        if self.user_weights:
            weights = self.user_weights
        else:
            n = len(hierarchy)
            total = sum(range(1, n + 1))
            weights = {b: (i + 1) / total for i, b in enumerate(hierarchy)}

        current_world = world
        for b in hierarchy:
            current_world = _world_from_local(project, local_r, local_t)
            P = current_world[b][:3, 3]
            v_target = self.target - P
            dist = np.linalg.norm(v_target)
            if dist < 1e-6:
                continue
            v_target_dir = v_target / dist

            R_world = current_world[b][:3, :3]
            v_curr = norm(R_world @ np.array([0.0, 0.0, 1.0]))

            R_delta_world = rot_from_to(v_curr, v_target_dir)
            w = weights.get(b, 1.0)
            R_weighted_world = slerp_matrix(np.eye(3), R_delta_world, w)

            R_new_world = R_weighted_world @ R_world
            parent = project.bones[b].parent
            R_parent = current_world[parent][:3, :3] if parent else np.eye(3)
            R_new_local = R_parent.T @ R_new_world

            local_r[b] = R_new_local

        return _world_from_local(project, local_r, local_t)


class SpringBone:
    """Secondary physics spring bone component."""

    def __init__(
        self,
        name: str,
        stiffness: float = 0.1,
        damping: float = 0.8,
        gravity: Sequence[float] = (0.0, -9.8, 0.0),
    ):
        self.name = name
        self.stiffness = float(stiffness)
        self.damping = float(damping)
        self.gravity = np.asarray(gravity, dtype=float)
        self.current_tip: Optional[np.ndarray] = None
        self.prev_tip: Optional[np.ndarray] = None


class SpringBoneSolver:
    """Solves secondary physics motion for spring bones."""

    def __init__(self, springs: List[SpringBone]):
        self.springs = {s.name: s for s in springs}

    def evaluate(
        self,
        project: Project,
        dt: float,
        local_r: Dict[str, np.ndarray],
        local_t: Dict[str, np.ndarray],
        world: Dict[str, np.ndarray],
    ) -> None:
        for name, spring in self.springs.items():
            if name not in project.bones:
                continue
            bone_world = world[name]
            pos = bone_world[:3, 3]
            rot = bone_world[:3, :3]
            target_tip = pos + rot @ np.array([0.0, -2.0, 0.0])

            if spring.current_tip is None or spring.prev_tip is None:
                spring.current_tip = target_tip.copy()
                spring.prev_tip = target_tip.copy()

            vel = (spring.current_tip - spring.prev_tip) * spring.damping
            spring.prev_tip = spring.current_tip.copy()
            force = (target_tip - spring.current_tip) * spring.stiffness + spring.gravity * 0.01
            spring.current_tip = spring.current_tip + vel + force

            dir_to_tip = norm(spring.current_tip - pos)
            rest_dir = norm(rot @ np.array([0.0, -1.0, 0.0]))
            if np.linalg.norm(dir_to_tip) > 1e-6 and np.linalg.norm(rest_dir) > 1e-6:
                R_delta = rot_from_to(rest_dir, dir_to_tip)
                parent = project.bones[name].parent
                R_parent = world[parent][:3, :3] if parent else np.eye(3)
                R_new_world = R_delta @ rot
                local_r[name] = R_parent.T @ R_new_world


def apply_procedural(
    project: Project,
    clip: Optional[Clip],
    frame: int,
    time: float,
    procedural_config: Dict[str, Any],
    local_r: Dict[str, np.ndarray],
    local_t: Dict[str, np.ndarray],
    ik_targets: Dict[str, Dict[str, Any]],
) -> Tuple[Dict[str, np.ndarray], Dict[str, np.ndarray], Dict[str, Dict[str, Any]]]:
    """Applies configured procedural animation generators to local bone transforms and IK targets."""
    if not procedural_config:
        return local_r, local_t, ik_targets

    # 1. Gait
    gait_cfg = procedural_config.get("gait")
    if gait_cfg and isinstance(gait_cfg, dict):
        gait = GaitSynthesizer(
            speed=gait_cfg.get("speed", 1.0),
            stride_length=gait_cfg.get("stride_length", 4.0),
            stride_height=gait_cfg.get("stride_height", 2.0),
            hip_bounce=gait_cfg.get("hip_bounce", 0.5),
            arm_swing=gait_cfg.get("arm_swing", 25.0),
            left_leg_chain=gait_cfg.get("left_leg_chain", "left_leg"),
            right_leg_chain=gait_cfg.get("right_leg_chain", "right_leg"),
            left_arm_bone=gait_cfg.get("left_arm_bone", "left_upper_arm"),
            right_arm_bone=gait_cfg.get("right_arm_bone", "right_upper_arm"),
            root_bone=gait_cfg.get("root_bone", "root"),
        )
        gait.evaluate(time, project, local_r, local_t, ik_targets)

    # 2. Lean / Sway
    lean_cfg = procedural_config.get("lean")
    if lean_cfg and isinstance(lean_cfg, dict):
        lean = PhysicsLeanSway(
            velocity=lean_cfg.get("velocity", (0.0, 0.0, 0.0)),
            acceleration=lean_cfg.get("acceleration", (0.0, 0.0, 0.0)),
            turn_rate=lean_cfg.get("turn_rate", 0.0),
            landing_impact=lean_cfg.get("landing_impact", 0.0),
            pitch_factor=lean_cfg.get("pitch_factor", 5.0),
            roll_factor=lean_cfg.get("roll_factor", 5.0),
            banking_factor=lean_cfg.get("banking_factor", 10.0),
            stiffness=lean_cfg.get("stiffness", 100.0),
            damping=lean_cfg.get("damping", 10.0),
            root_bone=lean_cfg.get("root_bone", "root"),
            torso_bone=lean_cfg.get("torso_bone", "torso"),
        )
        dt = 1.0 / (clip.fps if clip and clip.fps > 0 else 10.0)
        if lean.landing_impact > 0:
            lean.update(dt, landing_impact=lean.landing_impact)
        lean.evaluate(local_r, local_t)

    # 3. Breathing
    breath_cfg = procedural_config.get("breathing")
    if breath_cfg and isinstance(breath_cfg, dict):
        breathing = IdleBreathingGenerator(
            rate=breath_cfg.get("rate", 0.25),
            intensity=breath_cfg.get("intensity", 1.0),
            chest_bone=breath_cfg.get("chest_bone", "torso"),
            head_bone=breath_cfg.get("head_bone", "head"),
        )
        breathing.evaluate(time, local_r, local_t)

    # 4. Look-At
    look_cfg = procedural_config.get("look_at")
    if look_cfg and isinstance(look_cfg, dict):
        look_at = LookAtSolver(
            target=look_cfg.get("target", (0.0, 0.0, 10.0)),
            head_bone=look_cfg.get("head_bone", "head"),
            neck_bone=look_cfg.get("neck_bone"),
            spine_bones=look_cfg.get("spine_bones", ["torso"]),
            weights=look_cfg.get("weights"),
            max_angle=look_cfg.get("max_angle", 75.0),
        )
        world = _world_from_local(project, local_r, local_t)
        look_at.solve(project, local_r, local_t, world)

    # 5. Spring Bones
    spring_cfg = procedural_config.get("spring_bones")
    if spring_cfg and isinstance(spring_cfg, list):
        springs = []
        for s in spring_cfg:
            if isinstance(s, dict) and "name" in s:
                springs.append(
                    SpringBone(
                        name=s["name"],
                        stiffness=s.get("stiffness", 0.1),
                        damping=s.get("damping", 0.8),
                        gravity=s.get("gravity", (0.0, -9.8, 0.0)),
                    )
                )
        if springs:
            solver = SpringBoneSolver(springs)
            world = _world_from_local(project, local_r, local_t)
            dt = 1.0 / (clip.fps if clip and clip.fps > 0 else 10.0)
            solver.evaluate(project, dt, local_r, local_t, world)

    return local_r, local_t, ik_targets
