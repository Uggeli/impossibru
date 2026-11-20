"""Generate examples/voxel_buddy.yaml: a small generic robot built from voxel-grid parts.

It demonstrates sticker faces (thin face parts on a `face` bone swapped with part keys) and a
prop bone hidden with a null rig part. The tests also use it as the voxel-grid fixture.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import yaml

PALETTE = {
    "b": "#2F7DD1",  # body blue
    "B": "#1D4F8A",  # trim
    "w": "#F4F6FA",  # face plate
    "k": "#1E2230",  # eyes, joints
    "p": "#F59AB0",  # cheeks
    "y": "#FFC93C",  # spark
}


class Grid:
    def __init__(self, w: int, h: int, d: int):
        self.a = np.full((w, h, d), ".", dtype="<U1")
        self.w, self.h, self.d = w, h, d

    def fill(self, fn):
        for x in range(self.w):
            for y in range(self.h):
                for z in range(self.d):
                    c = fn(x, y, z)
                    if c:
                        self.a[x, y, z] = c

    def encode(self) -> str:
        out, prev, n = [], None, 0
        for y in range(self.h):
            for z in range(self.d):
                for x in range(self.w):
                    c = self.a[x, y, z]
                    if c == prev:
                        n += 1
                    else:
                        if prev is not None:
                            out.append((str(n) if n > 1 else "") + prev)
                        prev, n = c, 1
        out.append((str(n) if n > 1 else "") + prev)
        return "".join(out)

    def part(self, pivot):
        return {"size": [self.w, self.h, self.d], "voxels": self.encode(), "pivot": pivot}


def head():
    """Rounded box head with a flat white face plate on its front (+Z) side."""
    W, H, D = 17, 15, 15
    c = (W - 1) / 2, (H - 1) / 2, (D - 1) / 2
    g = Grid(W, H, D)

    def body(x, y, z):
        dx, dy, dz = (x - c[0]) / 8.4, (y - c[1]) / 7.4, (z - c[2]) / 7.4
        if dx ** 4 + dy ** 4 + dz ** 4 > 1:
            return None
        if z == D - 1 and abs(x - c[0]) <= 5 and abs(y - c[1]) <= 4:
            return "w"
        return "B" if y == 0 else "b"

    g.fill(body)
    return g.part([c[0], 0, c[2]])


FACES = ("open", "blink")


def face(name: str):
    """Thin face sticker (11x9x1) that sits half a voxel in front of the face plate."""
    g = Grid(11, 9, 1)

    def paint(x, y, z):
        dx, dy = x - 5, y - 4
        for ex in (-3, 3):
            if name == "open" and abs(dx - ex) <= 1 and 0 <= dy <= 2:
                return "w" if (dx - ex, dy) == (-1, 2) else "k"
            if name == "blink" and abs(dx - ex) <= 1 and dy == 1:
                return "k"
        if abs(dx) <= 1 and dy == -2 or abs(dx) == 2 and dy == -1:
            return "k"
        if abs(dx) == 4 and dy == -1:
            return "p"
        return None

    g.fill(paint)
    return g.part([5, 4, 0])


def box(w, h, d, color, trim=None):
    g = Grid(w, h, d)
    g.fill(lambda x, y, z: trim if (trim and y == 0) else color)
    return g.part([(w - 1) / 2, h - 1, (d - 1) / 2])


def spark():
    g = Grid(5, 5, 1)
    g.fill(lambda x, y, z: "y" if (x == 2 or y == 2) and not (x in (0, 4) and y in (0, 4)) else None)
    return g.part([2, 0, 0])


def key(frame, value, interp="smooth"):
    return {"frame": frame, "value": value, "interpolation": interp}


def part_key(frame, value):
    return {"frame": frame, "value": value}


def build():
    parts = {"head": head(), "torso": box(11, 9, 7, "b", "B"), "arm": box(3, 7, 3, "B"),
             "hand": box(3, 3, 3, "k"), "leg": box(3, 6, 3, "B"), "fx_spark": spark()}
    parts.update({f"face_{n}": face(n) for n in FACES})
    bones = {
        "root": {"translation": [0, 6, 0]},
        "torso": {"parent": "root", "part": "torso", "translation": [0, 9, 0]},
        "head": {"parent": "torso", "translation": [0, 1, 0], "part": "head"},
        # head-space: face plate centre, half a voxel proud of the plate
        "face": {"parent": "head", "translation": [0, 7, 7.5], "part": "face_open"},
        "fx_spark": {"parent": "head", "translation": [8, 15, 0], "part": None},
    }
    for side, sx in (("left", 1), ("right", -1)):
        bones[f"{side}_arm"] = {"parent": "torso", "translation": [sx * 7, 0, 0], "part": "arm"}
        bones[f"{side}_hand"] = {"parent": f"{side}_arm", "translation": [0, -7, 0], "part": "hand"}
        bones[f"{side}_leg"] = {"parent": "root", "translation": [sx * 3, 0, 0], "part": "leg"}

    zero = [0, 0, 0]
    animations = {
        "idle": {"frames": 8, "fps": 8, "loop": True, "bones": {
            "root": {"translation": [key(0, zero), key(4, [0, -0.5, 0])]},
            "head": {"rotation": [key(0, [0, 0, -3]), key(4, [0, 0, 3])]},
            "face": {"part": [part_key(5, "face_blink"), part_key(6, "face_open")]},
        }},
        "wave": {"frames": 8, "fps": 8, "loop": False, "bones": {
            "right_arm": {"rotation": [key(0, zero), key(2, [0, 0, -150]), key(4, [0, 0, -120]),
                                       key(6, [0, 0, -150]), key(7, zero)]},
            "fx_spark": {"part": [part_key(0, None), part_key(2, "fx_spark"), part_key(7, None)]},
        }},
    }
    return {
        "palette": PALETTE, "parts": parts, "rig": {"bones": bones}, "animations": animations,
        "export": {"name": "voxel_buddy", "size": [104, 136], "scale": 3, "origin": [52, 128],
                   "directions": [0, 45, 315], "normals": "surface", "shell": True, "trim": True,
                   "background": [0, 0, 0, 0]},
    }


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "examples/voxel_buddy.yaml")
    out.write_text(yaml.safe_dump(build(), sort_keys=False, width=1 << 20))
    print(f"wrote {out}")
