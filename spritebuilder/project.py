from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import re
import textwrap
from typing import Any, Dict, List, Mapping, Optional, Tuple

import numpy as np
import yaml

from .spring_bones import (CopyRotationConstraint, Constraint, MirrorConstraint,
                           SplineSpineConstraint, SpringBoneConfig)


class ProjectError(ValueError):
    """A user-facing project validation error."""


@dataclass
class VoxelPart:
    name: str
    positions: np.ndarray
    colors: np.ndarray
    normals: np.ndarray


@dataclass
class Bone:
    name: str
    parent: Optional[str]
    translation: np.ndarray
    rotation: np.ndarray
    part: Optional[str]
    part_translation: np.ndarray
    part_rotation: np.ndarray
    spring: Optional[SpringBoneConfig] = None


@dataclass
class IKChain:
    name: str
    root: str
    mid: str
    end: str


@dataclass
class Clip:
    name: str
    frames: int
    fps: float
    loop: bool
    bones: Dict[str, Mapping[str, Any]]
    ik: Dict[str, Mapping[str, Any]]
    procedural: Optional[Dict[str, Any]] = None


@dataclass
class ExportSettings:
    name: str
    width: int
    height: int
    scale: int
    origin: Tuple[float, float]
    directions: List[float]
    animations: List[str]
    background: Tuple[int, int, int, int]
    # Crop each frame to its pixels and shelf-pack the frames; False keeps one row per clip direction.
    trim: bool = False
    # Keep only voxels on a part's surface (the interior is never seen).
    shell: bool = False
    # "radial": a part-sized ellipsoid's normals; "surface": each voxel's normal points away from the
    # part's filled voxels within two voxels, so lighting follows the drawn shape.
    normals: str = "radial"


@dataclass
class Project:
    path: Path
    palette: Dict[str, Tuple[int, int, int, int]]
    parts: Dict[str, VoxelPart]
    bones: Dict[str, Bone]
    bone_order: List[str]
    ik_chains: Dict[str, IKChain]
    clips: Dict[str, Clip]
    export: ExportSettings
    spring_bones: Dict[str, SpringBoneConfig] = field(default_factory=dict)
    constraints: List[Constraint] = field(default_factory=list)

    def autorig(self, preset: str = "humanoid") -> Project:
        from .autorig import autorig_project
        return autorig_project(self, preset=preset)




def _vec(value: Any, label: str, length: int = 3) -> np.ndarray:
    if not isinstance(value, (list, tuple)) or len(value) != length:
        raise ProjectError(f"{label} must be a {length}-number list")
    try:
        return np.asarray(value, dtype=float)
    except (TypeError, ValueError) as exc:
        raise ProjectError(f"{label} must contain only numbers") from exc


def _color(value: Any, label: str) -> Tuple[int, int, int, int]:
    if isinstance(value, str):
        if not re.fullmatch(r"#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?", value):
            raise ProjectError(f"{label} must be #RRGGBB, #RRGGBBAA, or an RGB(A) list")
        raw = value[1:]
        vals = tuple(int(raw[i:i + 2], 16) for i in range(0, len(raw), 2))
    elif isinstance(value, (list, tuple)) and len(value) in (3, 4):
        vals = tuple(value)
    else:
        raise ProjectError(f"{label} must be #RRGGBB, #RRGGBBAA, or an RGB(A) list")
    if any(not isinstance(v, int) or v < 0 or v > 255 for v in vals):
        raise ProjectError(f"{label} channels must be integers from 0 to 255")
    return vals + (255,) if len(vals) == 3 else vals  # type: ignore[return-value]


def _grid(value: Any, label: str) -> List[str]:
    if not isinstance(value, str):
        raise ProjectError(f"{label} must be a multiline string")
    rows = textwrap.dedent(value).strip("\n").splitlines()
    if not rows or not rows[0]:
        raise ProjectError(f"{label} cannot be empty")
    width = len(rows[0])
    if any(len(row) != width for row in rows):
        raise ProjectError(f"{label} has ragged rows")
    return rows


def _validate_chars(rows: List[str], palette: Mapping[str, Any], label: str) -> None:
    for y, row in enumerate(rows):
        for x, char in enumerate(row):
            if char != "." and char not in palette:
                raise ProjectError(f"{label} uses unknown palette character {char!r} at row {y + 1}, column {x + 1}")


def _voxel_grid(name: str, spec: Mapping[str, Any], palette: Mapping[str, Tuple[int, int, int, int]]) -> VoxelPart:
    """A part given as a 3D grid: `size` [w, h, d] and `voxels`, run-length palette characters ('.' empty;
    an optional count before each character) in x-fastest, then z, then y (bottom up) order."""
    size = spec.get("size")
    if not isinstance(size, (list, tuple)) or len(size) != 3 or any(not isinstance(v, int) or v < 1 for v in size):
        raise ProjectError(f"parts.{name}.size must be three positive integers")
    text = spec["voxels"]
    if not isinstance(text, str):
        raise ProjectError(f"parts.{name}.voxels must be a string")
    cells: List[str] = []
    for count, char in re.findall(r"(\d*)(\D)", text):
        if char != "." and char not in palette:
            raise ProjectError(f"parts.{name}.voxels uses unknown palette character {char!r}")
        cells.extend(char * int(count or 1))
    w, h, d = size
    if len(cells) != w * h * d:
        raise ProjectError(f"parts.{name}.voxels has {len(cells)} cells, size needs {w * h * d}")
    cx, cy, cz = (w - 1) / 2, (h - 1) / 2, (d - 1) / 2
    pivot = _vec(spec.get("pivot", [cx, 0, cz]), f"parts.{name}.pivot")
    sx, sy, sz = max(cx, .5), max(cy, .5), max(cz, .5)
    positions, colors, normals = [], [], []
    for index, char in enumerate(cells):
        if char == ".":
            continue
        x, z, y = index % w, index // w % d, index // (w * d)
        radial = np.array([(x - cx) / sx, (y - cy) / sy, (z - cz) / sz])
        positions.append(np.array([x, y, z], dtype=float) - pivot)
        colors.append(palette[char])
        normals.append(radial / max(np.linalg.norm(radial), 1.0))
    if not positions:
        raise ProjectError(f"parts.{name} produces no voxels")
    return VoxelPart(name, np.asarray(positions), np.asarray(colors, dtype=np.uint8), np.asarray(normals))


def _voxelize(name: str, spec: Mapping[str, Any], palette: Mapping[str, Tuple[int, int, int, int]]) -> VoxelPart:
    if "voxels" in spec:
        return _voxel_grid(name, spec, palette)
    front = _grid(spec.get("front"), f"parts.{name}.front")
    back = _grid(spec.get("back"), f"parts.{name}.back")
    side = _grid(spec.get("side"), f"parts.{name}.side")
    for view_name, rows in (("front", front), ("back", back), ("side", side)):
        _validate_chars(rows, palette, f"parts.{name}.{view_name}")
    if len(front) != len(back) or len(front[0]) != len(back[0]):
        raise ProjectError(f"parts.{name}: front and back views must have equal dimensions")
    if len(front) != len(side):
        raise ProjectError(f"parts.{name}: front, back, and side views must have equal heights")
    for y in range(len(front)):
        for x in range(len(front[0])):
            if (front[y][x] == ".") != (back[y][x] == "."):
                raise ProjectError(f"parts.{name}: front/back silhouettes differ at row {y + 1}, column {x + 1}")

    h, w, d = len(front), len(front[0]), len(side[0])
    cx, cy, cz = (w - 1) / 2, (h - 1) / 2, (d - 1) / 2
    pivot = _vec(spec.get("pivot", [cx, 0, cz]), f"parts.{name}.pivot")
    positions, colors, normals = [], [], []
    sx, sy, sz = max(cx, .5), max(cy, .5), max(cz, .5)
    for row in range(h):
        for x in range(w):
            if front[row][x] == ".":
                continue
            for z in range(d):
                if side[row][z] == ".":
                    continue
                local = np.array([x, h - 1 - row, z], dtype=float) - pivot
                radial = np.array([(x - cx) / sx, ((h - 1 - row) - cy) / sy, (z - cz) / sz])
                normal = radial / max(np.linalg.norm(radial), 1.0)
                # A single side view paints both X-facing regions. Front/back win
                # where Z is the dominant horizontal surface direction.
                if abs(radial[2]) >= abs(radial[0]):
                    char = front[row][x] if radial[2] >= 0 else back[row][x]
                else:
                    char = side[row][z]
                positions.append(local)
                colors.append(palette[char])
                normals.append(normal)
    if not positions:
        raise ProjectError(f"parts.{name} produces no voxels")
    return VoxelPart(name, np.asarray(positions), np.asarray(colors, dtype=np.uint8), np.asarray(normals))


def _surface(part: VoxelPart, shell: bool, surface_normals: bool) -> VoxelPart:
    """Surface normals and/or the surface shell of a voxelized part, keeping voxel order."""
    cells = np.rint(part.positions - part.positions.min(axis=0)).astype(int)
    reach = 2
    grid = np.zeros(tuple(cells.max(axis=0) + 1 + 2 * reach), dtype=np.int64)
    grid[tuple((cells + reach).T)] = 1
    normals = part.normals
    if surface_normals:
        # Away from the filled voxels nearby: minus the sum of offsets to filled cells in a 5³ cube.
        pull = np.zeros(cells.shape, dtype=np.int64)
        for dx in range(-reach, reach + 1):
            for dy in range(-reach, reach + 1):
                for dz in range(-reach, reach + 1):
                    filled = grid[cells[:, 0] + reach + dx, cells[:, 1] + reach + dy, cells[:, 2] + reach + dz]
                    pull += filled[:, None] * np.array([dx, dy, dz])
        size = np.sqrt((pull * pull).sum(axis=1))
        normals = np.where(size[:, None] > 0, -pull / np.maximum(size, 1)[:, None], part.normals)
    keep = np.ones(len(cells), dtype=bool)
    if shell:
        keep[:] = False
        # Keep a voxel when any of its 26 neighbours is empty, so diagonal views cannot see through.
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    if dx or dy or dz:
                        keep |= grid[cells[:, 0] + reach + dx, cells[:, 1] + reach + dy, cells[:, 2] + reach + dz] == 0
    return VoxelPart(part.name, part.positions[keep], part.colors[keep], normals[keep])


def _topological_order(bones: Dict[str, Bone]) -> List[str]:
    order: List[str] = []
    visiting, done = set(), set()
    def visit(name: str) -> None:
        if name in visiting:
            raise ProjectError(f"rig has a parent cycle involving {name!r}")
        if name in done:
            return
        visiting.add(name)
        parent = bones[name].parent
        if parent:
            if parent not in bones:
                raise ProjectError(f"bone {name!r} references missing parent {parent!r}")
            visit(parent)
        visiting.remove(name)
        done.add(name)
        order.append(name)
    for bone_name in bones:
        visit(bone_name)
    return order


def _keys(track: Any, label: str, frames: int, width: int) -> None:
    if not isinstance(track, list) or not track:
        raise ProjectError(f"{label} must be a non-empty keyframe list")
    last = -1
    for key in track:
        if not isinstance(key, Mapping) or "frame" not in key or "value" not in key:
            raise ProjectError(f"{label} keys require frame and value")
        frame = key["frame"]
        if not isinstance(frame, int) or frame < 0 or frame >= frames or frame <= last:
            raise ProjectError(f"{label} frames must be unique, ascending integers in 0..{frames - 1}")
        last = frame
        if width == 0:
            pass
        elif width == 1:
            try:
                float(key["value"])
            except (TypeError, ValueError) as exc:
                raise ProjectError(f"{label} values must be numbers") from exc
        else:
            _vec(key["value"], f"{label}[{frame}].value", width)
        if key.get("interpolation", "linear") not in ("linear", "smooth", "step"):
            raise ProjectError(f"{label}[{frame}].interpolation must be linear, smooth, or step")


def load_project(path: Any) -> Project:
    project_path = Path(path)
    try:
        raw = yaml.safe_load(project_path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ProjectError(f"cannot read {project_path}: {exc}") from exc
    except yaml.YAMLError as exc:
        raise ProjectError(f"invalid YAML in {project_path}: {exc}") from exc
    return compile_project(raw, project_path)


def compile_project(raw: Any, path: Any = "<memory>") -> Project:
    """Validate and compile an already-parsed project document."""
    from .spring_bones import (CopyRotationConstraint, Constraint, MirrorConstraint,
                               SplineSpineConstraint, SpringBoneConfig)
    project_path = Path(path)
    if not isinstance(raw, Mapping):
        raise ProjectError("project root must be a mapping")


    pal_raw = raw.get("palette")
    if not isinstance(pal_raw, Mapping) or not pal_raw:
        raise ProjectError("palette must be a non-empty mapping")
    palette: Dict[str, Tuple[int, int, int, int]] = {}
    for char, value in pal_raw.items():
        if not isinstance(char, str) or len(char) != 1 or char == ".":
            raise ProjectError("palette keys must be single characters other than '.'")
        palette[char] = _color(value, f"palette.{char}")

    parts_raw = raw.get("parts")
    if not isinstance(parts_raw, Mapping) or not parts_raw:
        raise ProjectError("parts must be a non-empty mapping")
    parts = {str(name): _voxelize(str(name), spec, palette) for name, spec in parts_raw.items()
             if isinstance(spec, Mapping)}
    if len(parts) != len(parts_raw):
        raise ProjectError("every part must be a mapping")

    rig = raw.get("rig")
    if not isinstance(rig, Mapping) or not isinstance(rig.get("bones"), Mapping) or not rig["bones"]:
        raise ProjectError("rig.bones must be a non-empty mapping")
    bones: Dict[str, Bone] = {}
    for name, spec in rig["bones"].items():
        label = f"rig.bones.{name}"
        if not isinstance(spec, Mapping):
            raise ProjectError(f"{label} must be a mapping")
        parent = spec.get("parent")
        if parent is not None and not isinstance(parent, str):
            raise ProjectError(f"{label}.parent must be a bone name")
        part = spec.get("part")
        if part is not None and part not in parts:
            raise ProjectError(f"{label} references missing part {part!r}")
        attach = spec.get("attachment", {})
        if not isinstance(attach, Mapping):
            raise ProjectError(f"{label}.attachment must be a mapping")
        bones[str(name)] = Bone(str(name), parent,
            _vec(spec.get("translation", [0, 0, 0]), f"{label}.translation"),
            _vec(spec.get("rotation", [0, 0, 0]), f"{label}.rotation"), part,
            _vec(attach.get("translation", [0, 0, 0]), f"{label}.attachment.translation"),
            _vec(attach.get("rotation", [0, 0, 0]), f"{label}.attachment.rotation"))
    bone_order = _topological_order(bones)

    chains: Dict[str, IKChain] = {}
    chains_raw = rig.get("ik_chains", {})
    if not isinstance(chains_raw, Mapping):
        raise ProjectError("rig.ik_chains must be a mapping")
    for name, spec in chains_raw.items():
        if not isinstance(spec, Mapping):
            raise ProjectError(f"rig.ik_chains.{name} must be a mapping")
        names = [spec.get(k) for k in ("root", "mid", "end")]
        if any(n not in bones for n in names):
            raise ProjectError(f"IK chain {name!r} references a missing bone")
        if bones[names[1]].parent != names[0] or bones[names[2]].parent != names[1]:
            raise ProjectError(f"IK chain {name!r} must describe a direct root -> mid -> end hierarchy")
        chains[str(name)] = IKChain(str(name), *names)

    spring_bones: Dict[str, SpringBoneConfig] = {}
    sb_raw = rig.get("spring_bones")
    if sb_raw is not None:
        if not isinstance(sb_raw, Mapping):
            raise ProjectError("rig.spring_bones must be a mapping")
        for name, spec in sb_raw.items():
            if name not in bones:
                raise ProjectError(f"rig.spring_bones references missing bone {name!r}")
            if not isinstance(spec, Mapping):
                raise ProjectError(f"rig.spring_bones.{name} must be a mapping")
            stiffness = float(spec.get("stiffness", 100.0))
            damping = float(spec.get("damping", 10.0))
            mass = float(spec.get("mass", 1.0))
            drag = float(spec.get("drag", 0.1))
            if stiffness < 0 or damping < 0 or mass <= 0 or drag < 0:
                raise ProjectError(f"rig.spring_bones.{name} parameters must be non-negative (mass > 0)")
            gravity = _vec(spec.get("gravity", [0.0, -9.81, 0.0]), f"rig.spring_bones.{name}.gravity")
            limit_angle = spec.get("limit_angle", 45.0)
            if limit_angle is not None:
                try:
                    limit_angle = float(limit_angle)
                    if limit_angle < 0:
                        raise ValueError()
                except (TypeError, ValueError):
                    raise ProjectError(f"rig.spring_bones.{name}.limit_angle must be a non-negative number")
            cfg = SpringBoneConfig(str(name), stiffness, damping, mass, drag, gravity, limit_angle)
            spring_bones[str(name)] = cfg
            bones[str(name)].spring = cfg

    for name, spec in rig["bones"].items():
        if name in spring_bones:
            continue
        if isinstance(spec, Mapping) and "spring" in spec:
            sp_spec = spec["spring"]
            if not isinstance(sp_spec, Mapping):
                raise ProjectError(f"rig.bones.{name}.spring must be a mapping")
            stiffness = float(sp_spec.get("stiffness", 100.0))
            damping = float(sp_spec.get("damping", 10.0))
            mass = float(sp_spec.get("mass", 1.0))
            drag = float(sp_spec.get("drag", 0.1))
            if stiffness < 0 or damping < 0 or mass <= 0 or drag < 0:
                raise ProjectError(f"rig.bones.{name}.spring parameters must be non-negative (mass > 0)")
            gravity = _vec(sp_spec.get("gravity", [0.0, -9.81, 0.0]), f"rig.bones.{name}.spring.gravity")
            limit_angle = sp_spec.get("limit_angle", 45.0)
            if limit_angle is not None:
                try:
                    limit_angle = float(limit_angle)
                    if limit_angle < 0:
                        raise ValueError()
                except (TypeError, ValueError):
                    raise ProjectError(f"rig.bones.{name}.spring.limit_angle must be a non-negative number")
            cfg = SpringBoneConfig(str(name), stiffness, damping, mass, drag, gravity, limit_angle)
            spring_bones[str(name)] = cfg
            bones[str(name)].spring = cfg

    constraints: List[Constraint] = []
    c_raw = rig.get("constraints")
    if c_raw is not None:
        if isinstance(c_raw, Mapping):
            c_raw = list(c_raw.values())
        if not isinstance(c_raw, list):
            raise ProjectError("rig.constraints must be a list or mapping")
        for idx, spec in enumerate(c_raw):
            if not isinstance(spec, Mapping):
                raise ProjectError(f"rig.constraints[{idx}] must be a mapping")
            c_type = spec.get("type") or spec.get("kind")
            c_name = str(spec.get("name", f"constraint_{idx}"))
            if c_type in ("spline_spine", "spline"):
                b_list = spec.get("bones", [])
                if not isinstance(b_list, list) or not b_list:
                    raise ProjectError(f"constraint {c_name!r} must have a non-empty bones list")
                for b in b_list:
                    if b not in bones:
                        raise ProjectError(f"constraint {c_name!r} references missing bone {b!r}")
                driver = spec.get("driver")
                if driver is not None and driver not in bones:
                    raise ProjectError(f"constraint {c_name!r} references missing driver bone {driver!r}")
                tot_rot = spec.get("total_rotation")
                if tot_rot is not None:
                    tot_rot = tuple(_vec(tot_rot, f"constraint {c_name!r}.total_rotation"))
                constraints.append(SplineSpineConstraint(c_name, [str(b) for b in b_list], driver, tot_rot))
            elif c_type == "mirror":
                src = spec.get("source")
                tgt = spec.get("target")
                if src not in bones or tgt not in bones:
                    raise ProjectError(f"mirror constraint {c_name!r} references missing source or target bone")
                plane = str(spec.get("plane", "yz"))
                if plane.lower() not in ("yz", "xz", "xy", "x", "y", "z"):
                    raise ProjectError(f"mirror constraint {c_name!r} invalid plane {plane!r}")
                inf = float(spec.get("influence", 1.0))
                constraints.append(MirrorConstraint(c_name, str(src), str(tgt), plane, inf))
            elif c_type in ("copy_rotation", "copy_rot"):
                src = spec.get("source")
                tgt = spec.get("target")
                if src not in bones or tgt not in bones:
                    raise ProjectError(f"copy_rotation constraint {c_name!r} references missing source or target bone")
                inf = float(spec.get("influence", 1.0))
                axes = tuple(bool(x) for x in spec.get("axes", [True, True, True]))
                invert = tuple(bool(x) for x in spec.get("invert", [False, False, False]))
                constraints.append(CopyRotationConstraint(c_name, str(src), str(tgt), inf, axes, invert))
            else:
                raise ProjectError(f"unknown constraint type {c_type!r}")

    anim_raw = raw.get("animations")
    if not isinstance(anim_raw, Mapping) or not anim_raw:
        raise ProjectError("animations must be a non-empty mapping")
    clips: Dict[str, Clip] = {}
    for name, spec in anim_raw.items():
        label = f"animations.{name}"
        if not isinstance(spec, Mapping):
            raise ProjectError(f"{label} must be a mapping")
        frames, fps = spec.get("frames"), spec.get("fps")
        if not isinstance(frames, int) or frames < 1:
            raise ProjectError(f"{label}.frames must be a positive integer")
        if not isinstance(fps, (int, float)) or fps <= 0:
            raise ProjectError(f"{label}.fps must be positive")
        bone_tracks = spec.get("bones", {})
        ik_tracks = spec.get("ik", {})
        if not isinstance(bone_tracks, Mapping) or not isinstance(ik_tracks, Mapping):
            raise ProjectError(f"{label}.bones and .ik must be mappings")
        for bone_name, tracks in bone_tracks.items():
            if bone_name not in bones or not isinstance(tracks, Mapping):
                raise ProjectError(f"{label}.bones references invalid bone {bone_name!r}")
            for track_name, track in tracks.items():
                if track_name not in ("translation", "rotation", "part"):
                    raise ProjectError(f"{label}.bones.{bone_name}: unknown track {track_name!r}")
                track_label = f"{label}.bones.{bone_name}.{track_name}"
                if track_name == "part":
                    _keys(track, track_label, frames, 0)
                    for key in track:
                        if "interpolation" in key:
                            raise ProjectError(
                                f"{track_label}[{key['frame']}].interpolation is not allowed on part keys")
                        value = key["value"]
                        if value is not None and not isinstance(value, str):
                            raise ProjectError(
                                f"{track_label}[{key['frame']}].value must be a part name or null")
                        if value is not None and value not in parts:
                            raise ProjectError(f"{track_label} references missing part {value!r}")
                else:
                    _keys(track, track_label, frames, 3)
        for chain_name, tracks in ik_tracks.items():
            if chain_name not in chains or not isinstance(tracks, Mapping):
                raise ProjectError(f"{label}.ik references invalid chain {chain_name!r}")
            for track_name, track in tracks.items():
                widths = {"target": 3, "pole": 3, "weight": 1}
                if track_name not in widths:
                    raise ProjectError(f"{label}.ik.{chain_name}: unknown track {track_name!r}")
                _keys(track, f"{label}.ik.{chain_name}.{track_name}", frames, widths[track_name])
                if track_name == "weight" and any(not 0 <= float(k["value"]) <= 1 for k in track):
                    raise ProjectError(f"{label}.ik.{chain_name}.weight must stay within 0..1")
        proc_raw = spec.get("procedural")
        procedural = None
        if proc_raw is not None:
            if not isinstance(proc_raw, Mapping):
                raise ProjectError(f"{label}.procedural must be a mapping")
            procedural = dict(proc_raw)
        clips[str(name)] = Clip(str(name), frames, float(fps), bool(spec.get("loop", True)),
                                dict(bone_tracks), dict(ik_tracks), procedural)

    out = raw.get("export", {})
    if not isinstance(out, Mapping):
        raise ProjectError("export must be a mapping")
    size = out.get("size", [96, 96])
    if not isinstance(size, (list, tuple)) or len(size) != 2 or any(not isinstance(v, int) for v in size):
        raise ProjectError("export.size must be a two-integer list")
    width, height = size
    origin = _vec(out.get("origin", [width / 2, height - 8]), "export.origin", 2)
    scale = out.get("scale", 3)
    directions = out.get("directions", [0, 45, 90, 135, 180, 225, 270, 315])
    if width < 1 or height < 1 or not isinstance(scale, int) or scale < 1:
        raise ProjectError("export size and scale must be positive integers")
    if not isinstance(directions, list) or not directions or any(not isinstance(x, (int, float)) for x in directions):
        raise ProjectError("export.directions must be a non-empty number list")
    export_animations = out.get("animations", list(clips))
    if (not isinstance(export_animations, list) or not export_animations or
            any(not isinstance(name, str) for name in export_animations)):
        raise ProjectError("export.animations must be a non-empty animation-name list")
    if len(set(export_animations)) != len(export_animations):
        raise ProjectError("export.animations must not contain duplicates")
    missing_animations = [name for name in export_animations if name not in clips]
    if missing_animations:
        raise ProjectError(f"export.animations references missing animation {missing_animations[0]!r}")
    trim, shell, normals = out.get("trim", False), out.get("shell", False), out.get("normals", "radial")
    if not isinstance(trim, bool) or not isinstance(shell, bool):
        raise ProjectError("export.trim and export.shell must be booleans")
    if normals not in ("radial", "surface"):
        raise ProjectError("export.normals must be 'radial' or 'surface'")
    if shell or normals == "surface":
        parts = {name: _surface(part, shell, normals == "surface") for name, part in parts.items()}
    export = ExportSettings(str(out.get("name", project_path.stem)), width, height, scale,
                            (float(origin[0]), float(origin[1])), [float(x) for x in directions],
                            list(export_animations),
                            _color(out.get("background", [0, 0, 0, 0]), "export.background"), trim, shell, normals)
    return Project(project_path, palette, parts, bones, bone_order, chains, clips, export, spring_bones, constraints)
