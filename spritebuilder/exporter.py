from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Dict, Tuple

from PIL import Image

from .animation import active_parts, evaluate_pose
from .project import Project, ProjectError
from .render import render_pose


def build_project(project: Project, output_directory: Path) -> Tuple[Path, Path]:
    try:
        output_directory.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise ProjectError(f"cannot create output directory {output_directory}: {exc}") from exc
    settings = project.export
    selected_clips = [(name, project.clips[name]) for name in settings.animations]
    if settings.trim:
        return _build_trimmed(project, selected_clips, output_directory)
    rows = len(settings.directions) * len(selected_clips)
    columns = max(clip.frames for _, clip in selected_clips)
    atlas = Image.new("RGBA", (columns * settings.width, rows * settings.height), (0, 0, 0, 0))
    metadata = _metadata(settings, atlas)
    row = 0
    for clip_name, clip in selected_clips:
        clip_meta = {"fps": clip.fps, "frame_duration_ms": 1000.0 / clip.fps,
                     "loop": clip.loop, "directions": []}
        for direction in settings.directions:
            frames = []
            for frame in range(clip.frames):
                x, y = frame * settings.width, row * settings.height
                image = render_pose(project, evaluate_pose(project, clip, frame), direction,
                                    parts=active_parts(project, clip, frame))
                atlas.alpha_composite(image, (x, y))
                frames.append({
                    "index": frame,
                    "rect": {"x": x, "y": y, "w": settings.width, "h": settings.height},
                    "pivot": {"x": x + settings.origin[0], "y": y + settings.origin[1]},
                })
            clip_meta["directions"].append({"angle": direction, "frames": frames})
            row += 1
        metadata["animations"][clip_name] = clip_meta
    return _write(settings, atlas, metadata, output_directory)


def _metadata(settings, atlas) -> Dict[str, Any]:
    return {
        "image": f"{settings.name}.png",
        "size": {"w": atlas.width, "h": atlas.height},
        "frame_size": {"w": settings.width, "h": settings.height},
        "coordinate_system": {"atlas_origin": "top-left", "world": "+X right, +Y up, +Z forward"},
        "animations": {},
    }


def _build_trimmed(project: Project, selected_clips, output_directory: Path) -> Tuple[Path, Path]:
    """Every frame cropped to its pixels and shelf-packed in order, one transparent pixel apart, into
    an atlas about as wide as it is tall. Rects and pivots locate each crop; empty frames have size 0."""
    settings = project.export
    rendered = []
    for clip_name, clip in selected_clips:
        poses = [evaluate_pose(project, clip, frame) for frame in range(clip.frames)]
        for direction in settings.directions:
            for frame in range(clip.frames):
                image = render_pose(project, poses[frame], direction, parts=active_parts(project, clip, frame))
                box = image.getchannel("A").getbbox() or (0, 0, 0, 0)
                rendered.append((clip_name, direction, frame, image.crop(box) if box[2] > box[0] else None, box))
    sizes = [(box[2] - box[0], box[3] - box[1]) for *_, box in rendered]
    width = max(max(w for w, _ in sizes) + 1, math.isqrt(max(sum((w + 1) * (h + 1) for w, h in sizes) - 1, 0)) + 1)
    places, x, y, row = [], 0, 0, 0
    for w, h in sizes:
        if x + w + 1 > width:
            x, y, row = 0, y + row, 0
        places.append((x, y))
        x, row = x + w + 1, max(row, h + 1)
    atlas = Image.new("RGBA", (width, y + row), (0, 0, 0, 0))
    metadata = _metadata(settings, atlas)
    for (clip_name, direction, frame, image, box), (x, y), (w, h) in zip(rendered, places, sizes):
        if image is not None:
            atlas.alpha_composite(image, (x, y))
        clip = project.clips[clip_name]
        clip_meta = metadata["animations"].setdefault(clip_name, {
            "fps": clip.fps, "frame_duration_ms": 1000.0 / clip.fps, "loop": clip.loop, "directions": []})
        if frame == 0:
            clip_meta["directions"].append({"angle": direction, "frames": []})
        clip_meta["directions"][-1]["frames"].append({
            "index": frame, "rect": {"x": x, "y": y, "w": w, "h": h},
            "pivot": {"x": x + settings.origin[0] - box[0], "y": y + settings.origin[1] - box[1]}})
    return _write(settings, atlas, metadata, output_directory)


def _write(settings, atlas, metadata, output_directory: Path) -> Tuple[Path, Path]:
    png_path = output_directory / f"{settings.name}.png"
    json_path = output_directory / f"{settings.name}.json"
    try:
        atlas.save(png_path)
        json_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    except OSError as exc:
        raise ProjectError(f"cannot write export files in {output_directory}: {exc}") from exc
    return png_path, json_path
