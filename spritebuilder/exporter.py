from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Tuple

from PIL import Image

from .animation import evaluate_pose
from .project import Project, ProjectError
from .render import render_pose


def build_project(project: Project, output_directory: Path) -> Tuple[Path, Path]:
    try:
        output_directory.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise ProjectError(f"cannot create output directory {output_directory}: {exc}") from exc
    settings = project.export
    selected_clips = [(name, project.clips[name]) for name in settings.animations]
    rows = len(settings.directions) * len(selected_clips)
    columns = max(clip.frames for _, clip in selected_clips)
    atlas = Image.new("RGBA", (columns * settings.width, rows * settings.height), (0, 0, 0, 0))
    metadata: Dict[str, Any] = {
        "image": f"{settings.name}.png",
        "size": {"w": atlas.width, "h": atlas.height},
        "frame_size": {"w": settings.width, "h": settings.height},
        "coordinate_system": {"atlas_origin": "top-left", "world": "+X right, +Y up, +Z forward"},
        "animations": {},
    }
    row = 0
    for clip_name, clip in selected_clips:
        clip_meta = {"fps": clip.fps, "frame_duration_ms": 1000.0 / clip.fps,
                     "loop": clip.loop, "directions": []}
        for direction in settings.directions:
            frames = []
            for frame in range(clip.frames):
                x, y = frame * settings.width, row * settings.height
                image = render_pose(project, evaluate_pose(project, clip, frame), direction)
                atlas.alpha_composite(image, (x, y))
                frames.append({
                    "index": frame,
                    "rect": {"x": x, "y": y, "w": settings.width, "h": settings.height},
                    "pivot": {"x": x + settings.origin[0], "y": y + settings.origin[1]},
                })
            clip_meta["directions"].append({"angle": direction, "frames": frames})
            row += 1
        metadata["animations"][clip_name] = clip_meta
    png_path = output_directory / f"{settings.name}.png"
    json_path = output_directory / f"{settings.name}.json"
    try:
        atlas.save(png_path)
        json_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    except OSError as exc:
        raise ProjectError(f"cannot write export files in {output_directory}: {exc}") from exc
    return png_path, json_path
