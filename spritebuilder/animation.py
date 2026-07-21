from __future__ import annotations

import math
from typing import Dict, Mapping, Tuple

import numpy as np

from .project import Clip, Project


def norm(v: np.ndarray) -> np.ndarray:
    length = np.linalg.norm(v)
    return v / length if length > 1e-9 else v


def euler_matrix(degrees) -> np.ndarray:
    """XYZ local Euler angles in degrees."""
    x, y, z = np.radians(np.asarray(degrees, dtype=float))
    cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return rx @ ry @ rz


def matrix4(rotation=None, translation=None) -> np.ndarray:
    result = np.eye(4)
    if rotation is not None:
        result[:3, :3] = rotation
    if translation is not None:
        result[:3, 3] = translation
    return result


def quat_from_matrix(m: np.ndarray) -> np.ndarray:
    # Stable branch form, returned as w,x,y,z.
    trace = np.trace(m)
    if trace > 0:
        s = math.sqrt(trace + 1.0) * 2
        q = np.array([.25 * s, (m[2, 1] - m[1, 2]) / s,
                      (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s])
    else:
        i = int(np.argmax(np.diag(m)))
        if i == 0:
            s = math.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
            q = np.array([(m[2, 1] - m[1, 2]) / s, .25 * s,
                          (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s])
        elif i == 1:
            s = math.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
            q = np.array([(m[0, 2] - m[2, 0]) / s, (m[0, 1] + m[1, 0]) / s,
                          .25 * s, (m[1, 2] + m[2, 1]) / s])
        else:
            s = math.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
            q = np.array([(m[1, 0] - m[0, 1]) / s, (m[0, 2] + m[2, 0]) / s,
                          (m[1, 2] + m[2, 1]) / s, .25 * s])
    return norm(q)


def matrix_from_quat(q: np.ndarray) -> np.ndarray:
    w, x, y, z = norm(q)
    return np.array([
        [1 - 2*y*y - 2*z*z, 2*x*y - 2*z*w, 2*x*z + 2*y*w],
        [2*x*y + 2*z*w, 1 - 2*x*x - 2*z*z, 2*y*z - 2*x*w],
        [2*x*z - 2*y*w, 2*y*z + 2*x*w, 1 - 2*x*x - 2*y*y],
    ])


def slerp_matrix(a: np.ndarray, b: np.ndarray, t: float) -> np.ndarray:
    qa, qb = quat_from_matrix(a), quat_from_matrix(b)
    dot = float(np.dot(qa, qb))
    if dot < 0:
        qb, dot = -qb, -dot
    if dot > .9995:
        return matrix_from_quat(norm(qa + t * (qb - qa)))
    angle = math.acos(max(-1, min(1, dot)))
    return matrix_from_quat((math.sin((1-t)*angle)*qa + math.sin(t*angle)*qb) / math.sin(angle))


def rot_from_to(a, b) -> np.ndarray:
    a, b = norm(np.asarray(a, float)), norm(np.asarray(b, float))
    v, c = np.cross(a, b), float(np.dot(a, b))
    if c > .999999:
        return np.eye(3)
    if c < -.999999:
        axis = norm(np.cross(a, [1, 0, 0]) if abs(a[0]) < .9 else np.cross(a, [0, 1, 0]))
        return 2 * np.outer(axis, axis) - np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx / (1 + c)


def _track_segment(keys, frame: int, loop: bool, frames: int):
    if not keys:
        return None, None, 0.0
    exact = next((key for key in keys if key["frame"] == frame), None)
    if exact is not None:
        return exact, exact, 0.0
    previous = [key for key in keys if key["frame"] < frame]
    following = [key for key in keys if key["frame"] > frame]
    if previous and following:
        left, right, position = previous[-1], following[0], frame
    elif loop and len(keys) > 1:
        if previous:
            left, right, position = previous[-1], keys[0], frame
            right = dict(right, frame=right["frame"] + frames)
        else:
            left, right, position = dict(keys[-1], frame=keys[-1]["frame"] - frames), keys[0], frame
    else:
        key = previous[-1] if previous else following[0]
        return key, key, 0.0
    if left.get("interpolation", "linear") == "step":
        return left, left, 0.0
    t = (position - left["frame"]) / (right["frame"] - left["frame"])
    if left.get("interpolation", "linear") == "smooth":
        t = t * t * (3 - 2 * t)
    return left, right, t


def sample_track(keys, frame: int, loop: bool, frames: int):
    """Sample numeric/vector keys; interpolation belongs to the preceding key."""
    left, right, t = _track_segment(keys, frame, loop, frames)
    if left is None:
        return None
    return np.asarray(left["value"], float) * (1 - t) + np.asarray(right["value"], float) * t


def sample_rotation(keys, frame: int, loop: bool, frames: int) -> np.ndarray:
    left, right, t = _track_segment(keys, frame, loop, frames)
    if left is None:
        return np.eye(3)
    return slerp_matrix(euler_matrix(left["value"]), euler_matrix(right["value"]), t)


def _world_from_local(project: Project, local_r: Dict[str, np.ndarray], local_t: Dict[str, np.ndarray]) -> Dict[str, np.ndarray]:
    world = {}
    for name in project.bone_order:
        local = matrix4(local_r[name], local_t[name])
        parent = project.bones[name].parent
        world[name] = world[parent] @ local if parent else local
    return world


def evaluate_rest_pose(project: Project) -> Dict[str, np.ndarray]:
    """Evaluate bone origins in the authored rest pose.

    Kept separate from :func:`evaluate_pose` so editor operations never need a
    synthetic animation clip and cannot accidentally apply IK.
    """
    local_r = {name: euler_matrix(project.bones[name].rotation)
               for name in project.bone_order}
    local_t = {name: project.bones[name].translation.copy()
               for name in project.bone_order}
    return _world_from_local(project, local_r, local_t)


def solve_two_bone(root, target, l1, l2, pole) -> Tuple[np.ndarray, np.ndarray]:
    root, target, pole = np.asarray(root, float), np.asarray(target, float), np.asarray(pole, float)
    delta = target - root
    raw_distance = np.linalg.norm(delta)
    direction = norm(delta) if raw_distance > 1e-9 else np.array([0., -1., 0.])
    distance = max(abs(l1-l2) + 1e-6, min(l1+l2 - 1e-6, raw_distance))
    bend = pole - np.dot(pole, direction) * direction
    if np.linalg.norm(bend) < 1e-6:
        bend = np.cross(direction, [0, 0, 1])
        if np.linalg.norm(bend) < 1e-6:
            bend = np.cross(direction, [1, 0, 0])
    bend = norm(bend)
    cos_angle = (l1*l1 + distance*distance - l2*l2) / (2*l1*distance)
    angle = math.acos(max(-1, min(1, cos_angle)))
    joint = root + l1 * (math.cos(angle)*direction + math.sin(angle)*bend)
    end = root + distance * direction
    return joint, end


def evaluate_pose(project: Project, clip: Clip, frame: int) -> Dict[str, np.ndarray]:
    local_r, local_t = {}, {}
    for name in project.bone_order:
        bone, tracks = project.bones[name], clip.bones.get(name, {})
        translation = sample_track(tracks.get("translation"), frame, clip.loop, clip.frames)
        rotation = sample_rotation(tracks.get("rotation"), frame, clip.loop, clip.frames)
        local_t[name] = bone.translation + (translation if translation is not None else 0)
        local_r[name] = euler_matrix(bone.rotation) @ rotation
    world = _world_from_local(project, local_r, local_t)

    for chain_name, tracks in clip.ik.items():
        weight_v = sample_track(tracks.get("weight"), frame, clip.loop, clip.frames)
        weight = float(weight_v) if weight_v is not None else 1.0
        target = sample_track(tracks.get("target"), frame, clip.loop, clip.frames)
        if target is None or weight <= 0:
            continue
        pole = sample_track(tracks.get("pole"), frame, clip.loop, clip.frames)
        pole = pole if pole is not None else np.array([0., 0., 1.])
        chain = project.ik_chains[chain_name]
        root_p, mid_p, end_p = (world[n][:3, 3].copy() for n in (chain.root, chain.mid, chain.end))
        l1, l2 = np.linalg.norm(mid_p-root_p), np.linalg.norm(end_p-mid_p)
        joint, end = solve_two_bone(root_p, target, l1, l2, pole)
        original_root, original_mid = local_r[chain.root].copy(), local_r[chain.mid].copy()

        root_world_r = rot_from_to(mid_p-root_p, joint-root_p) @ world[chain.root][:3, :3]
        root_parent = project.bones[chain.root].parent
        parent_r = world[root_parent][:3, :3] if root_parent else np.eye(3)
        solved_root = parent_r.T @ root_world_r
        local_r[chain.root] = solved_root
        world = _world_from_local(project, local_r, local_t)
        mid_p2, end_p2 = world[chain.mid][:3, 3], world[chain.end][:3, 3]
        mid_world_r = rot_from_to(end_p2-mid_p2, end-mid_p2) @ world[chain.mid][:3, :3]
        solved_mid = world[chain.root][:3, :3].T @ mid_world_r

        local_r[chain.root] = slerp_matrix(original_root, solved_root, weight)
        local_r[chain.mid] = slerp_matrix(original_mid, solved_mid, weight)
        world = _world_from_local(project, local_r, local_t)
    return world
