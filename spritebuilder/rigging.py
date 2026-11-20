"""Rig-editor geometry and schema-preserving document operations."""
from __future__ import annotations

import copy
import math
from typing import Any, Dict, Mapping, Optional, Tuple

import numpy as np

from .animation import evaluate_pose, evaluate_rest_pose, euler_matrix, sample_track
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
                     clip=None, frame: int = 0, offset=(0.0, 0.0),
                     size=None) -> Dict[str, Any]:
    width, height = size or (project.export.width, project.export.height)
    bones = []
    for name in project.bone_order:
        point = project_point(project, pose[name][:3, 3], yaw)
        parent = project.bones[name].parent
        bones.append({"name": name, "parent": parent,
                      "x": point[0] + offset[0], "y": point[1] + offset[1],
                      "depth": point[2]})
    chains = []
    colors = ("#ff6b6b", "#63d7ff", "#d58cff", "#ffd166", "#70e000")
    for index, (name, chain) in enumerate(project.ik_chains.items()):
        item = {"name": name, "root": chain.root, "mid": chain.mid, "end": chain.end,
                "color": colors[index % len(colors)]}
        if clip is not None and name in clip.ik:
            tracks = clip.ik[name]
            weight = sample_track(tracks.get("weight"), frame, clip.loop, clip.frames)
            item["weight"] = float(weight) if weight is not None else 1.0
            for kind in ("target", "pole"):
                value = sample_track(tracks.get(kind), frame, clip.loop, clip.frames)
                if value is not None:
                    x, y, depth = project_point(project, value, yaw)
                    item[kind] = {"x": x + offset[0], "y": y + offset[1], "depth": depth}
        chains.append(item)
    return {"width": width, "height": height, "offset": list(offset),
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
                  frame: int = 0, path="<memory>", start=None) -> Dict[str, Any]:
    project = compile_project(document, path)
    world = unproject_point(project, screen, depth, yaw)
    result = copy.deepcopy(document)
    clip = None
    if mode == "animate":
        if clip_name not in project.clips:
            raise ProjectError(f"unknown animation {clip_name!r}")
        clip = project.clips[clip_name]
        if not 0 <= frame < clip.frames:
            raise ProjectError(f"frame must be in 0..{clip.frames - 1}")
    elif mode != "rest":
        raise ProjectError("mode must be rest or animate")

    if kind in ("joint", "rotate"):
        if name not in project.bones:
            raise ProjectError(f"unknown bone {name!r}")
        pose = evaluate_pose(project, clip, frame) if clip else evaluate_rest_pose(project)
        bone = project.bones[name]
        if kind == "joint" and clip and bone.parent:
            # A joint is the endpoint of the incoming segment.
            for chain_name, chain in project.ik_chains.items():
                tracks = clip.ik.get(chain_name, {})
                weight = sample_track(tracks.get("weight"), frame, clip.loop, clip.frames)
                if weight is not None and float(weight) <= 0:
                    continue
                if name == chain.end:
                    kind, name = "target", chain_name
                    break
                if bone.parent in (chain.root, chain.mid) and tracks.get("target"):
                    raise ProjectError(f"drag the target of IK chain {chain_name!r}")
            else:
                start = project_point(project, pose[name][:3, 3], yaw)[:2]
                kind, name = "rotate", bone.parent

    if kind in ("target", "pole"):
        if not clip or name not in project.ik_chains:
            raise ProjectError("IK handles require an animation clip and valid chain")
        tracks = result["animations"][clip_name].setdefault("ik", {}).setdefault(name, {})
        set_key(tracks.setdefault(kind, []), frame, world.tolist())
    elif kind in ("joint", "rotate"):
        bone = project.bones[name]
        parent = pose[bone.parent] if bone.parent else np.eye(4)
        if kind == "rotate":
            if not isinstance(start, (list, tuple)) or len(start) != 2:
                raise ProjectError("rotation requires a starting screen point")
            pivot = project_point(project, pose[name][:3, 3], yaw)[:2]
            old, new = np.array(start) - pivot, np.array(screen) - pivot
            if min(np.linalg.norm(old), np.linalg.norm(new)) < 1e-7:
                return result
            angle = math.degrees(math.atan2(old[1]*new[0] - old[0]*new[1], old @ new))
            camera = camera_yaw(yaw)
            delta = camera.T @ euler_matrix([0, 0, angle]) @ camera
            local = parent[:3, :3].T @ delta @ pose[name][:3, :3]
            if clip:
                local = euler_matrix(bone.rotation).T @ local
            track, value = "rotation", euler_from_matrix(local)
        else:
            local = (np.linalg.inv(parent) @ np.r_[world, 1.0])[:3]
            track, value = "translation", (local - bone.translation if clip else local).tolist()
        if clip:
            tracks = result["animations"][clip_name].setdefault("bones", {}).setdefault(name, {})
            set_key(tracks.setdefault(track, []), frame, value)
        else:
            result["rig"]["bones"][name][track] = value
    else:
        raise ProjectError("unknown rig drag kind")
    compile_project(result, path)
    return result
