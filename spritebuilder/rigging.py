"""Rig-editor geometry and schema-preserving document operations."""
from __future__ import annotations

import copy
import math
from typing import Any, Dict, Mapping, Optional, Tuple

import numpy as np

from .animation import evaluate_pose, evaluate_rest_pose, matrix4
from .project import Project, ProjectError, compile_project
from .render import camera_yaw


def normalize_angle(value: float) -> float:
    value = (float(value) + 180.0) % 360.0 - 180.0
    return 0.0 if abs(value) < 1e-10 else value


def normalize_euler(values) -> list:
    return [normalize_angle(v) for v in values]


def euler_from_matrix(matrix: np.ndarray) -> list:
    """Inverse of animation.euler_matrix (Rx @ Ry @ Rz), in degrees."""
    r = np.asarray(matrix, dtype=float)[:3, :3]
    y = math.asin(max(-1.0, min(1.0, float(r[0, 2]))))
    cy = math.cos(y)
    if abs(cy) > 1e-7:
        x = math.atan2(-r[1, 2], r[2, 2])
        z = math.atan2(-r[0, 1], r[0, 0])
    else:
        # At gimbal lock choose z=0; the represented rotation stays exact.
        x = math.atan2(r[2, 1], r[1, 1])
        z = 0.0
    return normalize_euler(np.degrees([x, y, z]))


def project_point(project: Project, point, yaw: float) -> Tuple[float, float, float]:
    camera_point = camera_yaw(float(yaw)) @ np.asarray(point, dtype=float)
    return (float(project.export.origin[0] + camera_point[0] * project.export.scale),
            float(project.export.origin[1] - camera_point[1] * project.export.scale),
            float(camera_point[2]))


def unproject_point(project: Project, screen, depth: float, yaw: float) -> np.ndarray:
    x = (float(screen[0]) - project.export.origin[0]) / project.export.scale
    y = (project.export.origin[1] - float(screen[1])) / project.export.scale
    return camera_yaw(float(yaw)).T @ np.array([x, y, float(depth)])


def overlay_geometry(project: Project, pose: Mapping[str, np.ndarray], yaw: float,
                     clip=None, frame: int = 0) -> Dict[str, Any]:
    bones = []
    for name in project.bone_order:
        point = project_point(project, pose[name][:3, 3], yaw)
        parent = project.bones[name].parent
        bones.append({"name": name, "parent": parent, "x": point[0], "y": point[1],
                      "depth": point[2]})
    chains = []
    colors = ("#ff6b6b", "#63d7ff", "#d58cff", "#ffd166", "#70e000")
    for index, (name, chain) in enumerate(project.ik_chains.items()):
        item = {"name": name, "root": chain.root, "mid": chain.mid, "end": chain.end,
                "color": colors[index % len(colors)]}
        if clip is not None and name in clip.ik:
            from .animation import sample_track
            tracks = clip.ik[name]
            for kind in ("target", "pole"):
                value = sample_track(tracks.get(kind), frame, clip.loop, clip.frames)
                if value is not None:
                    x, y, depth = project_point(project, value, yaw)
                    item[kind] = {"x": x, "y": y, "depth": depth}
        chains.append(item)
    return {"width": project.export.width, "height": project.export.height,
            "bones": bones, "chains": chains}


def chain_suggestions(project: Project) -> list:
    result = []
    for end in project.bone_order:
        mid = project.bones[end].parent
        root = project.bones[mid].parent if mid else None
        if root:
            result.append({"root": root, "mid": mid, "end": end})
    return result


def reparent_document(document: Mapping[str, Any], bone_name: str,
                      new_parent: Optional[str], path="<memory>") -> Dict[str, Any]:
    project = compile_project(document, path)
    if bone_name not in project.bones:
        raise ProjectError(f"unknown bone {bone_name!r}")
    if new_parent is not None and new_parent not in project.bones:
        raise ProjectError(f"unknown parent bone {new_parent!r}")
    if bone_name == new_parent:
        raise ProjectError("a bone cannot parent itself")
    cursor = new_parent
    while cursor:
        if cursor == bone_name:
            raise ProjectError("reparent would create a parent cycle")
        cursor = project.bones[cursor].parent
    # Chains must still be direct after the operation.
    for chain in project.ik_chains.values():
        parents = {chain.mid: chain.root, chain.end: chain.mid}
        if bone_name in parents and new_parent != parents[bone_name]:
            raise ProjectError(f"reparent would invalidate IK chain {chain.name!r}")
        if new_parent == bone_name and chain.mid == new_parent:
            raise ProjectError(f"reparent would invalidate IK chain {chain.name!r}")

    pose = evaluate_rest_pose(project)
    parent_world = pose[new_parent] if new_parent else np.eye(4)
    local = np.linalg.inv(parent_world) @ pose[bone_name]
    result = copy.deepcopy(document)
    spec = result["rig"]["bones"][bone_name]
    if new_parent is None:
        spec.pop("parent", None)
    else:
        spec["parent"] = new_parent
    spec["translation"] = [float(v) for v in local[:3, 3]]
    spec["rotation"] = euler_from_matrix(local[:3, :3])
    compile_project(result, path)
    return result


def set_key(keys: list, frame: int, value, interpolation="linear") -> None:
    key = {"frame": int(frame), "value": value, "interpolation": interpolation}
    for index, current in enumerate(keys):
        if current["frame"] == frame:
            # Preserve an explicitly selected interpolation on replacement.
            key["interpolation"] = current.get("interpolation", interpolation)
            keys[index] = key
            return
    keys.append(key)
    keys.sort(key=lambda item: item["frame"])


def drag_document(document: Mapping[str, Any], kind: str, name: str, screen,
                  yaw: float, depth: float, mode="rest", clip_name=None,
                  frame: int = 0, path="<memory>") -> Dict[str, Any]:
    project = compile_project(document, path)
    world = unproject_point(project, screen, depth, yaw)
    result = copy.deepcopy(document)
    if kind == "joint":
        if name not in project.bones:
            raise ProjectError(f"unknown bone {name!r}")
        if mode == "rest":
            parent = project.bones[name].parent
            pose = evaluate_rest_pose(project)
            local = np.linalg.inv(pose[parent]) @ np.r_[world, 1.0] if parent else np.r_[world, 1.0]
            result["rig"]["bones"][name]["translation"] = [float(v) for v in local[:3]]
        else:
            if clip_name not in project.clips:
                raise ProjectError(f"unknown animation {clip_name!r}")
            clip = project.clips[clip_name]
            if not 0 <= frame < clip.frames:
                raise ProjectError(f"frame must be in 0..{clip.frames - 1}")
            parent = project.bones[name].parent
            target_bone = parent or name
            tracks = result["animations"][clip_name].setdefault("bones", {}).setdefault(target_bone, {})
            if parent is None:
                value = (world - project.bones[name].translation).tolist()
                set_key(tracks.setdefault("translation", []), frame, value)
            else:
                from .animation import sample_track
                for chain_name, chain in project.ik_chains.items():
                    chain_tracks = clip.ik.get(chain_name, {})
                    target = sample_track(chain_tracks.get("target"), frame, clip.loop, clip.frames)
                    weight_v = sample_track(chain_tracks.get("weight"), frame, clip.loop, clip.frames)
                    weight = float(weight_v) if weight_v is not None else 1.0
                    if parent in (chain.root, chain.mid) and target is not None and weight > 0:
                        raise ProjectError(
                            f"bone {parent!r} is controlled by IK chain {chain_name!r}; drag its IK target")
                pose = evaluate_pose(project, clip, frame)
                pivot = pose[parent][:3, 3]
                old = pose[name][:3, 3] - pivot
                new = world - pivot
                camera = camera_yaw(yaw)
                a, b = camera @ old, camera @ new
                angle = math.degrees(math.atan2(a[0]*b[1]-a[1]*b[0], a[0]*b[0]+a[1]*b[1]))
                current = [0.0, 0.0, 0.0]
                existing = clip.bones.get(parent, {}).get("rotation", [])
                sampled = sample_track(existing, frame, clip.loop, clip.frames)
                if sampled is not None:
                    current = sampled.tolist()
                # Camera-normal world rotation is represented by the closest
                # editor Euler component (front/back Z, side X).
                axis = 0 if abs(math.sin(math.radians(yaw))) > .707 else 2
                current[axis] = normalize_angle(current[axis] - angle)
                set_key(tracks.setdefault("rotation", []), frame, current)
    elif kind in ("target", "pole"):
        if mode != "animate" or clip_name not in project.clips or name not in project.ik_chains:
            raise ProjectError("IK handles require an animation clip and valid chain")
        tracks = result["animations"][clip_name].setdefault("ik", {}).setdefault(name, {})
        set_key(tracks.setdefault(kind, []), frame, [float(v) for v in world])
    else:
        raise ProjectError("drag kind must be joint, target, or pole")
    compile_project(result, path)
    return result
