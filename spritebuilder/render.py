from __future__ import annotations

import math
from typing import Dict

import numpy as np
from PIL import Image

from .animation import euler_matrix, matrix4, norm
from .project import Project


LIGHT = norm(np.array([-.35, .55, .75]))


def camera_yaw(degrees: float) -> np.ndarray:
    angle = math.radians(degrees)
    c, s = math.cos(angle), math.sin(angle)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def _conservative_pixels(projected: np.ndarray, scale: int):
    """Pixel coordinates covering a voxel's projected interval.

    The extra boundary pixel deliberately overlaps neighboring voxels. This
    prevents half-voxel pivots and subpixel animation from opening transparent
    seams when projected centers round in opposite directions.
    """
    start_x = np.floor(projected[:, 0] - scale / 2).astype(int)
    start_y = np.floor(projected[:, 1] - scale / 2).astype(int)
    ox, oy = np.meshgrid(np.arange(scale + 1), np.arange(scale + 1))
    px = (start_x[:, None] + ox.ravel()[None, :]).ravel()
    py = (start_y[:, None] + oy.ravel()[None, :]).ravel()
    return px, py, (scale + 1) ** 2


def render_pose(project: Project, pose: Dict[str, np.ndarray], direction: float) -> Image.Image:
    positions, colors, normals = [], [], []
    for name in project.bone_order:
        bone = project.bones[name]
        if not bone.part:
            continue
        part = project.parts[bone.part]
        attachment = matrix4(euler_matrix(bone.part_rotation), bone.part_translation)
        transform = pose[name] @ attachment
        positions.append((transform[:3, :3] @ part.positions.T).T + transform[:3, 3])
        normals.append((transform[:3, :3] @ part.normals.T).T)
        colors.append(part.colors)
    settings = project.export
    image = np.empty((settings.height, settings.width, 4), dtype=np.uint8)
    image[:] = settings.background
    if not positions:
        return Image.fromarray(image, "RGBA")
    world = np.concatenate(positions)
    normal = np.concatenate(normals)
    color = np.concatenate(colors).astype(float)
    camera = camera_yaw(direction)
    camera_points = (camera @ world.T).T
    camera_normals = (camera @ normal.T).T
    shade = .35 + .65 * np.clip(camera_normals @ LIGHT, 0, 1)
    rgb = np.clip(color[:, :3] * shade[:, None], 0, 255).astype(np.uint8)
    alpha = color[:, 3].astype(np.uint8)

    scale = settings.scale
    projected = np.column_stack((settings.origin[0] + camera_points[:, 0] * scale,
                                 settings.origin[1] - camera_points[:, 1] * scale))
    px, py, footprint = _conservative_pixels(projected, scale)
    depth = np.repeat(camera_points[:, 2], footprint)
    out_rgb = np.repeat(rgb, footprint, axis=0)
    out_alpha = np.repeat(alpha, footprint)
    mask = (px >= 0) & (px < settings.width) & (py >= 0) & (py < settings.height)
    px, py, depth, out_rgb, out_alpha = px[mask], py[mask], depth[mask], out_rgb[mask], out_alpha[mask]
    order = np.argsort(depth, kind="stable")
    px, py, out_rgb, out_alpha = px[order], py[order], out_rgb[order], out_alpha[order]
    image[py, px, :3] = out_rgb
    image[py, px, 3] = out_alpha
    return Image.fromarray(image, "RGBA")


def render_part(project: Project, part_name: str, direction: float, size: int = 320) -> Image.Image:
    """Render one part centered and automatically scaled for editor previews."""
    if part_name not in project.parts:
        raise ValueError(f"unknown part {part_name!r}")
    part = project.parts[part_name]
    camera = camera_yaw(direction)
    points = (camera @ part.positions.T).T
    normals = (camera @ part.normals.T).T
    span_x = max(float(np.ptp(points[:, 0])), 1.0)
    span_y = max(float(np.ptp(points[:, 1])), 1.0)
    scale = max(1, min(16, int((size - 40) / max(span_x, span_y))))
    center_x = float((points[:, 0].min() + points[:, 0].max()) / 2)
    center_y = float((points[:, 1].min() + points[:, 1].max()) / 2)
    projected = np.column_stack((size / 2 + (points[:, 0] - center_x) * scale,
                                 size / 2 - (points[:, 1] - center_y) * scale))
    shade = .35 + .65 * np.clip(normals @ LIGHT, 0, 1)
    rgb = np.clip(part.colors[:, :3].astype(float) * shade[:, None], 0, 255).astype(np.uint8)
    alpha = part.colors[:, 3]
    px, py, footprint = _conservative_pixels(projected, scale)
    depth = np.repeat(points[:, 2], footprint)
    out_rgb = np.repeat(rgb, footprint, axis=0)
    out_alpha = np.repeat(alpha, footprint)
    mask = (px >= 0) & (px < size) & (py >= 0) & (py < size)
    order = np.argsort(depth[mask], kind="stable")
    image = np.zeros((size, size, 4), dtype=np.uint8)
    image[py[mask][order], px[mask][order], :3] = out_rgb[mask][order]
    image[py[mask][order], px[mask][order], 3] = out_alpha[mask][order]
    return Image.fromarray(image, "RGBA")
