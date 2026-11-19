"""Autorigging Engine: Silhouette/Volume analysis and preset rig generators."""
from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from .project import Project, ProjectError, VoxelPart, compile_project


@dataclass
class PartAnalysis:
    name: str
    bbox_min: np.ndarray  # shape (3,)
    bbox_max: np.ndarray  # shape (3,)
    dimensions: np.ndarray  # shape (3,) [dx, dy, dz]
    centroid: np.ndarray  # shape (3,) local mean
    volume: int
    height: float  # dy
    width: float   # dx
    depth: float   # dz
    silhouette_front: np.ndarray  # 2D bool mask
    silhouette_back: np.ndarray   # 2D bool mask
    silhouette_side: np.ndarray   # 2D bool mask


@dataclass
class ContactSurface:
    part_a: str
    part_b: str
    contact_point_a: np.ndarray  # Local contact point on part_a
    contact_point_b: np.ndarray  # Local contact point on part_b
    midpoint: np.ndarray        # Midpoint between contact points
    direction: np.ndarray       # Direction vector from A to B
    contact_count: int
    min_distance: float


def analyze_part(part: VoxelPart) -> PartAnalysis:
    """Compute 3D bounding box, centroid, volume, and silhouettes for a VoxelPart."""
    pos = part.positions
    if pos.size == 0:
        raise ProjectError(f"part {part.name!r} has no voxels to analyze")

    bbox_min = pos.min(axis=0)
    bbox_max = pos.max(axis=0)
    dimensions = bbox_max - bbox_min + 1.0
    centroid = pos.mean(axis=0)
    volume = len(pos)

    # 2D projection silhouettes (front, back, side)
    dx, dy, dz = int(dimensions[0]), int(dimensions[1]), int(dimensions[2])
    front_mask = np.zeros((dy, dx), dtype=bool)
    back_mask = np.zeros((dy, dx), dtype=bool)
    side_mask = np.zeros((dy, dz), dtype=bool)

    for p in pos:
        ix = int(round(p[0] - bbox_min[0]))
        iy = int(round(p[1] - bbox_min[1]))
        iz = int(round(p[2] - bbox_min[2]))
        if 0 <= ix < dx and 0 <= iy < dy:
            front_mask[iy, ix] = True
            back_mask[iy, ix] = True
        if 0 <= iz < dz and 0 <= iy < dy:
            side_mask[iy, iz] = True

    return PartAnalysis(
        name=part.name,
        bbox_min=bbox_min,
        bbox_max=bbox_max,
        dimensions=dimensions,
        centroid=centroid,
        volume=volume,
        height=float(dimensions[1]),
        width=float(dimensions[0]),
        depth=float(dimensions[2]),
        silhouette_front=front_mask,
        silhouette_back=back_mask,
        silhouette_side=side_mask,
    )


analyze_voxel_part = analyze_part


def analyze_project(project: Project) -> Dict[str, PartAnalysis]:
    """Compute geometry analysis for all voxel parts in a Project."""
    return {name: analyze_part(part) for name, part in project.parts.items()}


def analyze_contact_surface(part_a: VoxelPart, part_b: VoxelPart, threshold: float = 2.0) -> ContactSurface:
    """Analyze contact/adjacency surface between two voxel parts."""
    pos_a = part_a.positions
    pos_b = part_b.positions

    min_a = pos_a.min(axis=0)
    max_a = pos_a.max(axis=0)
    min_b = pos_b.min(axis=0)
    max_b = pos_b.max(axis=0)

    # Candidate boundary contact pairs between part_a and part_b
    candidates = [
        ("top_a_bot_b", pos_a[:, 1] >= max_a[1] - 1.0, pos_b[:, 1] <= min_b[1] + 1.0, np.array([0.0, 1.0, 0.0])),
        ("bot_a_top_b", pos_a[:, 1] <= min_a[1] + 1.0, pos_b[:, 1] >= max_b[1] - 1.0, np.array([0.0, -1.0, 0.0])),
        ("right_a_left_b", pos_a[:, 0] >= max_a[0] - 1.0, pos_b[:, 0] <= min_b[0] + 1.0, np.array([1.0, 0.0, 0.0])),
        ("left_a_right_b", pos_a[:, 0] <= min_a[0] + 1.0, pos_b[:, 0] >= max_b[0] - 1.0, np.array([-1.0, 0.0, 0.0])),
    ]

    best_match = None
    best_dist = float("inf")

    for name, mask_a, mask_b, dir_vec in candidates:
        if mask_a.any() and mask_b.any():
            pt_a = pos_a[mask_a].mean(axis=0)
            pt_b = pos_b[mask_b].mean(axis=0)
            if name in ("top_a_bot_b", "bot_a_top_b"):
                transverse_dist = float(np.linalg.norm(pt_a[[0, 2]] - pt_b[[0, 2]]))
            else:
                transverse_dist = float(np.linalg.norm(pt_a[[1, 2]] - pt_b[[1, 2]]))
            if transverse_dist < best_dist:
                best_dist = transverse_dist
                best_match = (pt_a, pt_b, dir_vec, int(mask_a.sum() + mask_b.sum()))

    if best_match:
        pt_a, pt_b, direction, count = best_match
        min_dist = float(best_dist)
    else:
        pt_a = pos_a.mean(axis=0)
        pt_b = pos_b.mean(axis=0)
        direction = np.array([0.0, 1.0, 0.0])
        count = 1
        min_dist = 0.0

    midpoint = (pt_a + pt_b) / 2.0

    return ContactSurface(
        part_a=part_a.name,
        part_b=part_b.name,
        contact_point_a=pt_a,
        contact_point_b=pt_b,
        midpoint=midpoint,
        direction=direction,
        contact_count=count,
        min_distance=min_dist,
    )



def find_contact_surfaces(project: Project, threshold: float = 2.0) -> List[ContactSurface]:
    """Find contact surfaces between all pairs of parts in a project."""
    parts = list(project.parts.values())
    results: List[ContactSurface] = []
    for i in range(len(parts)):
        for j in range(i + 1, len(parts)):
            results.append(analyze_contact_surface(parts[i], parts[j], threshold=threshold))
    return results


def _find_part_name(parts: Dict[str, VoxelPart], candidates: List[str]) -> Optional[str]:
    """Find matching part name in project parts dictionary from candidate names."""
    for cand in candidates:
        if cand in parts:
            return cand
    # Fallback to case-insensitive or partial match
    for cand in candidates:
        for name in parts:
            if cand.lower() == name.lower():
                return name
    return None


def generate_humanoid_rig(project: Project) -> Dict[str, Any]:
    """Generate autorig bones and ik_chains for a humanoid character model."""
    analyses = analyze_project(project)
    parts = project.parts

    # Resolve part names
    torso_part = _find_part_name(parts, ["torso", "chest", "body", "spine"])
    head_part = _find_part_name(parts, ["head", "head_part"])

    arm_l_part = _find_part_name(parts, ["upper_arm_l", "upper_arm_left", "upper_arm", "arm_upper"])
    arm_r_part = _find_part_name(parts, ["upper_arm_r", "upper_arm_right", "upper_arm", "arm_upper"])

    forearm_l_part = _find_part_name(parts, ["lower_arm_l", "lower_arm_left", "lower_arm", "arm_lower", "forearm_l"])
    forearm_r_part = _find_part_name(parts, ["lower_arm_r", "lower_arm_right", "lower_arm", "arm_lower", "forearm_r"])

    hand_l_part = _find_part_name(parts, ["hand_l", "hand_left", "hand"])
    hand_r_part = _find_part_name(parts, ["hand_r", "hand_right", "hand"])

    thigh_l_part = _find_part_name(parts, ["upper_leg_l", "upper_leg_left", "upper_leg", "leg_upper"])
    thigh_r_part = _find_part_name(parts, ["upper_leg_r", "upper_leg_right", "upper_leg", "leg_upper"])

    shin_l_part = _find_part_name(parts, ["lower_leg_l", "lower_leg_left", "lower_leg", "leg_lower"])
    shin_r_part = _find_part_name(parts, ["lower_leg_r", "lower_leg_right", "lower_leg", "leg_lower"])

    foot_l_part = _find_part_name(parts, ["foot_l", "foot_left", "foot", "feet"])
    foot_r_part = _find_part_name(parts, ["foot_r", "foot_right", "foot", "feet"])

    # Measure dimensions for bone offsets
    torso_h = analyses[torso_part].height if torso_part in analyses else 10.0
    torso_w = analyses[torso_part].width if torso_part in analyses else 8.0

    arm_h = analyses[arm_l_part].height if arm_l_part in analyses else 6.0
    forearm_h = analyses[forearm_l_part].height if forearm_l_part in analyses else 6.0

    thigh_h = analyses[thigh_l_part].height if thigh_l_part in analyses else 7.0
    shin_h = analyses[shin_l_part].height if shin_l_part in analyses else 7.0

    leg_total_h = thigh_h + shin_h
    shoulder_x = round(torso_w / 2.0) + 1.0 if torso_part in analyses else 5.0
    shoulder_y = max(torso_h - 2.0, 1.0) if torso_part in analyses else 8.0
    head_y = torso_h - 1.0 if torso_part in analyses else 9.0
    hip_x = max(round(analyses[thigh_l_part].width / 2.0), 2.0) if thigh_l_part in analyses else 2.0

    bones: Dict[str, Any] = {}
    ik_chains: Dict[str, Any] = {}

    # Root bone
    bones["root"] = {
        "translation": [0, int(leg_total_h), 0],
        "attachment": {},
    }

    # Torso bone
    if torso_part:
        bones["torso"] = {
            "parent": "root",
            "part": torso_part,
        }

    # Head bone
    if head_part:
        bones["head"] = {
            "parent": "torso" if "torso" in bones else "root",
            "translation": [0, int(head_y), 0],
            "part": head_part,
        }

    # Left Arm
    if arm_l_part:
        bones["left_upper_arm"] = {
            "parent": "torso" if "torso" in bones else "root",
            "translation": [int(shoulder_x), int(shoulder_y), 0],
            "part": arm_l_part,
            "attachment": {"rotation": [0, 0, 180]},
        }
        if forearm_l_part:
            bones["left_lower_arm"] = {
                "parent": "left_upper_arm",
                "translation": [0, -int(arm_h), 0],
                "part": forearm_l_part,
                "attachment": {"rotation": [0, 0, 180]},
            }
            if hand_l_part and hand_l_part != forearm_l_part and hand_l_part != arm_l_part:
                bones["left_hand"] = {
                    "parent": "left_lower_arm",
                    "translation": [0, -int(forearm_h), 0],
                    "part": hand_l_part,
                }

    # Right Arm
    if arm_r_part:
        bones["right_upper_arm"] = {
            "parent": "torso" if "torso" in bones else "root",
            "translation": [-int(shoulder_x), int(shoulder_y), 0],
            "part": arm_r_part,
            "attachment": {"rotation": [0, 0, 180]},
        }
        if forearm_r_part:
            bones["right_lower_arm"] = {
                "parent": "right_upper_arm",
                "translation": [0, -int(arm_h), 0],
                "part": forearm_r_part,
                "attachment": {"rotation": [0, 0, 180]},
            }
            if hand_r_part and hand_r_part != forearm_r_part and hand_r_part != arm_r_part:
                bones["right_hand"] = {
                    "parent": "right_lower_arm",
                    "translation": [0, -int(forearm_h), 0],
                    "part": hand_r_part,
                }

    # Left Leg
    if thigh_l_part:
        bones["left_upper_leg"] = {
            "parent": "root",
            "translation": [int(hip_x), 0, 0],
            "part": thigh_l_part,
            "attachment": {"rotation": [0, 0, 180]},
        }
        if shin_l_part:
            bones["left_lower_leg"] = {
                "parent": "left_upper_leg",
                "translation": [0, -int(thigh_h), 0],
                "part": shin_l_part,
                "attachment": {"rotation": [0, 0, 180]},
            }
            if foot_l_part:
                bones["left_foot"] = {
                    "parent": "left_lower_leg",
                    "translation": [0, -int(shin_h), 0],
                    "part": foot_l_part,
                }
                ik_chains["left_leg"] = {
                    "root": "left_upper_leg",
                    "mid": "left_lower_leg",
                    "end": "left_foot",
                }

    # Right Leg
    if thigh_r_part:
        bones["right_upper_leg"] = {
            "parent": "root",
            "translation": [-int(hip_x), 0, 0],
            "part": thigh_r_part,
            "attachment": {"rotation": [0, 0, 180]},
        }
        if shin_r_part:
            bones["right_lower_leg"] = {
                "parent": "right_upper_leg",
                "translation": [0, -int(thigh_h), 0],
                "part": shin_r_part,
                "attachment": {"rotation": [0, 0, 180]},
            }
            if foot_r_part:
                bones["right_foot"] = {
                    "parent": "right_lower_leg",
                    "translation": [0, -int(shin_h), 0],
                    "part": foot_r_part,
                }
                ik_chains["right_leg"] = {
                    "root": "right_upper_leg",
                    "mid": "right_lower_leg",
                    "end": "right_foot",
                }

    return {"bones": bones, "ik_chains": ik_chains}


def generate_quadruped_rig(project: Project) -> Dict[str, Any]:
    """Generate autorig bones and ik_chains for a quadruped (4-legged) character model."""
    analyses = analyze_project(project)
    parts = project.parts

    torso_part = _find_part_name(parts, ["torso", "body", "spine", "chest"])
    head_part = _find_part_name(parts, ["head", "head_part"])

    fl_upper = _find_part_name(parts, ["upper_leg_fl", "front_left_upper_leg", "upper_leg_l", "upper_leg"])
    fl_lower = _find_part_name(parts, ["lower_leg_fl", "front_left_lower_leg", "lower_leg_l", "lower_leg"])
    fl_foot = _find_part_name(parts, ["foot_fl", "front_left_foot", "foot_l", "foot"])

    fr_upper = _find_part_name(parts, ["upper_leg_fr", "front_right_upper_leg", "upper_leg_r", "upper_leg"])
    fr_lower = _find_part_name(parts, ["lower_leg_fr", "front_right_lower_leg", "lower_leg_r", "lower_leg"])
    fr_foot = _find_part_name(parts, ["foot_fr", "front_right_foot", "foot_r", "foot"])

    bl_upper = _find_part_name(parts, ["upper_leg_bl", "back_left_upper_leg", "upper_leg_l", "upper_leg"])
    bl_lower = _find_part_name(parts, ["lower_leg_bl", "back_left_lower_leg", "lower_leg_l", "lower_leg"])
    bl_foot = _find_part_name(parts, ["foot_bl", "back_left_foot", "foot_l", "foot"])

    br_upper = _find_part_name(parts, ["upper_leg_br", "back_right_upper_leg", "upper_leg_r", "upper_leg"])
    br_lower = _find_part_name(parts, ["lower_leg_br", "back_right_lower_leg", "lower_leg_r", "lower_leg"])
    br_foot = _find_part_name(parts, ["foot_br", "back_right_foot", "foot_r", "foot"])

    torso_h = analyses[torso_part].height if torso_part in analyses else 8.0
    torso_w = analyses[torso_part].width if torso_part in analyses else 8.0
    torso_d = analyses[torso_part].depth if torso_part in analyses else 10.0

    thigh_h = analyses[fl_upper].height if fl_upper in analyses else 6.0
    shin_h = analyses[fl_lower].height if fl_lower in analyses else 6.0
    leg_total_h = thigh_h + shin_h

    leg_x = max(round(torso_w / 2.0) - 1.0, 2.0)
    front_z = round(torso_d / 3.0)
    back_z = -round(torso_d / 3.0)

    bones: Dict[str, Any] = {}
    ik_chains: Dict[str, Any] = {}

    bones["root"] = {
        "translation": [0, int(leg_total_h), 0],
        "attachment": {},
    }

    if torso_part:
        bones["torso"] = {
            "parent": "root",
            "part": torso_part,
        }

    if head_part:
        bones["head"] = {
            "parent": "torso" if "torso" in bones else "root",
            "translation": [0, int(torso_h), int(front_z)],
            "part": head_part,
        }

    # Front Left Leg
    if fl_upper:
        bones["front_left_upper_leg"] = {
            "parent": "torso" if "torso" in bones else "root",
            "translation": [int(leg_x), 0, int(front_z)],
            "part": fl_upper,
            "attachment": {"rotation": [0, 0, 180]},
        }
        if fl_lower:
            bones["front_left_lower_leg"] = {
                "parent": "front_left_upper_leg",
                "translation": [0, -int(thigh_h), 0],
                "part": fl_lower,
                "attachment": {"rotation": [0, 0, 180]},
            }
            if fl_foot:
                bones["front_left_foot"] = {
                    "parent": "front_left_lower_leg",
                    "translation": [0, -int(shin_h), 0],
                    "part": fl_foot,
                }
                ik_chains["front_left_leg"] = {
                    "root": "front_left_upper_leg",
                    "mid": "front_left_lower_leg",
                    "end": "front_left_foot",
                }

    # Front Right Leg
    if fr_upper:
        bones["front_right_upper_leg"] = {
            "parent": "torso" if "torso" in bones else "root",
            "translation": [-int(leg_x), 0, int(front_z)],
            "part": fr_upper,
            "attachment": {"rotation": [0, 0, 180]},
        }
        if fr_lower:
            bones["front_right_lower_leg"] = {
                "parent": "front_right_upper_leg",
                "translation": [0, -int(thigh_h), 0],
                "part": fr_lower,
                "attachment": {"rotation": [0, 0, 180]},
            }
            if fr_foot:
                bones["front_right_foot"] = {
                    "parent": "front_right_lower_leg",
                    "translation": [0, -int(shin_h), 0],
                    "part": fr_foot,
                }
                ik_chains["front_right_leg"] = {
                    "root": "front_right_upper_leg",
                    "mid": "front_right_lower_leg",
                    "end": "front_right_foot",
                }

    # Back Left Leg
    if bl_upper:
        bones["back_left_upper_leg"] = {
            "parent": "root",
            "translation": [int(leg_x), 0, int(back_z)],
            "part": bl_upper,
            "attachment": {"rotation": [0, 0, 180]},
        }
        if bl_lower:
            bones["back_left_lower_leg"] = {
                "parent": "back_left_upper_leg",
                "translation": [0, -int(thigh_h), 0],
                "part": bl_lower,
                "attachment": {"rotation": [0, 0, 180]},
            }
            if bl_foot:
                bones["back_left_foot"] = {
                    "parent": "back_left_lower_leg",
                    "translation": [0, -int(shin_h), 0],
                    "part": bl_foot,
                }
                ik_chains["back_left_leg"] = {
                    "root": "back_left_upper_leg",
                    "mid": "back_left_lower_leg",
                    "end": "back_left_foot",
                }

    # Back Right Leg
    if br_upper:
        bones["back_right_upper_leg"] = {
            "parent": "root",
            "translation": [-int(leg_x), 0, int(back_z)],
            "part": br_upper,
            "attachment": {"rotation": [0, 0, 180]},
        }
        if br_lower:
            bones["back_right_lower_leg"] = {
                "parent": "back_right_upper_leg",
                "translation": [0, -int(thigh_h), 0],
                "part": br_lower,
                "attachment": {"rotation": [0, 0, 180]},
            }
            if br_foot:
                bones["back_right_foot"] = {
                    "parent": "back_right_lower_leg",
                    "translation": [0, -int(shin_h), 0],
                    "part": br_foot,
                }
                ik_chains["back_right_leg"] = {
                    "root": "back_right_upper_leg",
                    "mid": "back_right_lower_leg",
                    "end": "back_right_foot",
                }

    return {"bones": bones, "ik_chains": ik_chains}


def generate_creature_rig(project: Project) -> Dict[str, Any]:
    """Generate generic autorig bones and ik_chains for custom creature models."""
    analyses = analyze_project(project)
    parts = project.parts

    # Find main body part (largest volume or named torso/body)
    torso_part = _find_part_name(parts, ["torso", "body", "spine", "chest", "core"])
    if not torso_part:
        # Pick part with maximum volume
        torso_part = max(analyses, key=lambda p: analyses[p].volume)

    # Use humanoid setup as base for creature, adapting any extra parts
    rig = generate_humanoid_rig(project)
    bones = rig["bones"]
    ik_chains = rig["ik_chains"]

    # Check for tail part
    tail_part = _find_part_name(parts, ["tail"])
    if tail_part and "tail" not in bones:
        torso_d = analyses[torso_part].depth if torso_part in analyses else 4.0
        bones["tail"] = {
            "parent": "root",
            "translation": [0, 0, -int(round(torso_d / 2.0))],
            "part": tail_part,
        }

    # Check for wing parts
    wing_l_part = _find_part_name(parts, ["wing_l", "wing_left", "wing"])
    wing_r_part = _find_part_name(parts, ["wing_r", "wing_right", "wing"])
    if wing_l_part and "left_wing" not in bones:
        torso_w = analyses[torso_part].width if torso_part in analyses else 8.0
        bones["left_wing"] = {
            "parent": "torso" if "torso" in bones else "root",
            "translation": [int(round(torso_w / 2.0)), int(round(analyses[torso_part].height * 0.7)), 0],
            "part": wing_l_part,
        }
    if wing_r_part and "right_wing" not in bones:
        torso_w = analyses[torso_part].width if torso_part in analyses else 8.0
        bones["right_wing"] = {
            "parent": "torso" if "torso" in bones else "root",
            "translation": [-int(round(torso_w / 2.0)), int(round(analyses[torso_part].height * 0.7)), 0],
            "part": wing_r_part,
        }

    return {"bones": bones, "ik_chains": ik_chains}


def generate_rig(project: Project, preset: str = "humanoid") -> Dict[str, Any]:
    """Generate rig dict (bones and ik_chains) using the specified preset."""
    preset = preset.lower()
    if preset == "humanoid":
        return generate_humanoid_rig(project)
    elif preset == "quadruped":
        return generate_quadruped_rig(project)
    elif preset == "creature":
        return generate_creature_rig(project)
    else:
        raise ProjectError(f"unknown autorig preset: {preset!r} (expected humanoid, quadruped, or creature)")


def autorig_project(project: Project, preset: str = "humanoid") -> Project:
    """Autorig a Project object and return a new compiled Project instance."""
    from .project import Bone, IKChain, _topological_order
    rig = generate_rig(project, preset=preset)
    bones: Dict[str, Bone] = {}
    for name, spec in rig["bones"].items():
        parent = spec.get("parent")
        part = spec.get("part")
        attach = spec.get("attachment", {})
        bones[name] = Bone(
            name=name,
            parent=parent,
            translation=np.asarray(spec.get("translation", [0, 0, 0]), dtype=float),
            rotation=np.asarray(spec.get("rotation", [0, 0, 0]), dtype=float),
            part=part,
            part_translation=np.asarray(attach.get("translation", [0, 0, 0]), dtype=float),
            part_rotation=np.asarray(attach.get("rotation", [0, 0, 0]), dtype=float),
        )
    bone_order = _topological_order(bones)

    ik_chains: Dict[str, IKChain] = {}
    for name, spec in rig["ik_chains"].items():
        ik_chains[name] = IKChain(name, spec["root"], spec["mid"], spec["end"])

    return Project(
        path=project.path,
        palette=project.palette,
        parts=project.parts,
        bones=bones,
        bone_order=bone_order,
        ik_chains=ik_chains,
        clips=project.clips,
        export=project.export,
    )



def autorig_document_data(data: Dict[str, Any], preset: str = "humanoid") -> Dict[str, Any]:
    """Autorig a project document data dictionary in-place / copy and return updated dict."""
    if not isinstance(data, dict):
        raise ProjectError("project document must be a dict mapping")

    # Temporarily compile project to run geometry analysis
    temp_project = compile_project(data)
    rig = generate_rig(temp_project, preset=preset)

    result = copy.deepcopy(data)
    result["rig"] = rig

    # Prune any tracks in animations referencing bones/chains that no longer exist
    new_bones = set(rig.get("bones", {}))
    new_chains = set(rig.get("ik_chains", {}))
    for clip in result.get("animations", {}).values():
        if isinstance(clip, dict):
            if "bones" in clip and isinstance(clip["bones"], dict):
                clip["bones"] = {b: t for b, t in clip["bones"].items() if b in new_bones}
            if "ik" in clip and isinstance(clip["ik"], dict):
                clip["ik"] = {c: t for c, t in clip["ik"].items() if c in new_chains}

    # Validate updated project
    compile_project(result)
    return result
