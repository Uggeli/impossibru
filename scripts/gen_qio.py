"""Generate examples/qio.yaml: Qio, the PayiQ mascot, as voxel-grid parts.

Environment toggles (for experiments; defaults produce the shipped example):
  QIO_NORMALS  export.normals mode, default "surface".
  QIO_SHELL    "1" (default) enables export.shell, "0" disables it.
"""
from __future__ import annotations

import math
import os
import sys
from pathlib import Path

import numpy as np
import yaml

NORMALS = os.environ.get("QIO_NORMALS", "surface")
SHELL = os.environ.get("QIO_SHELL", "1") == "1"

PALETTE = {
    "r": "#E60012",  # primary red
    "R": "#B0000E",  # red trim / shadow
    "w": "#FFFFFF",
    "W": "#DDD8D8",  # soles, light grey
    "k": "#1A1A1A",  # charcoal
    "K": "#3C3C44",  # tablet screen
    "p": "#FF9EAE",  # cheeks
    "m": "#8A0A22",  # mouth
    "t": "#FF6F86",  # tongue
    "y": "#FFD23F",  # sparkle / unused accent
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

    def front_paint(self, fn, z_min=0):
        """Recolor the frontmost (max z) voxel of each x/y column."""
        for x in range(self.w):
            for y in range(self.h):
                col = np.nonzero(self.a[x, y, :] != ".")[0]
                if len(col) and col[-1] >= z_min:
                    c = fn(x, y)
                    if c:
                        self.a[x, y, col[-1]] = c

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
                            out.append(f"{n if n > 1 else ''}{prev}")
                        prev, n = c, 1
        out.append(f"{n if n > 1 else ''}{prev}")
        return "".join(out)

    def part(self, pivot):
        return {"size": [self.w, self.h, self.d], "pivot": [float(v) for v in pivot], "voxels": self.encode()}


def ellipsoid(cx, cy, cz, rx, ry, rz):
    return lambda x, y, z: ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 <= 1.0


def head(expression: str = "open"):
    """expression: open | blink (both eyes closed arcs) | wink (left eye, +X, closed)."""
    W, H, D = 29, 21, 24
    cx, cy, cz, R = 14, 10, 10, 9.6
    g = Grid(W, H, D)
    face_z = cz + 7  # recessed white face disc
    face_r = 7.2

    def body(x, y, z):
        dx, dy, dz = x - cx, y - cy, z - cz
        r = math.sqrt(dx * dx + dy * dy + dz * dz)
        rxy = math.sqrt(dx * dx + dy * dy)
        if r <= R:
            if rxy < face_r:
                if z > face_z:
                    return None
                return "w" if z == face_z else "r"
            return "r"
        # Q tail: a slanted bar leaving the ring at the lower right (character's left, +X)
        u = (dx - dy) / math.sqrt(2)
        v = (dx + dy) / math.sqrt(2)
        if 6.0 <= u <= 11.5 and abs(v) <= 1.8 and cz + 4 <= z <= cz + 11:
            return "r"
        # headphone cups (cylinders along X)
        ax = abs(dx)
        ry = math.sqrt(dy * dy + (z - cz) ** 2)
        if 8.5 <= ax <= 13.5 and ry <= 4.6:
            if ax > 12.5:
                if ry > 3.9:
                    return "k"
                return "r" if 1.4 <= ry <= 2.6 or (dy < -1.5 and z - cz > 1.5 and ry <= 3.4) else "w"
            if ax <= 9.5:
                return "k" if ry <= 3.6 else None
            return "w"
        # headband: arc over the top, just behind center
        if abs(z - (cz - 1)) <= 1 and 10.0 <= math.sqrt(dx * dx + dy * dy) <= 10.9 and dy >= 1.5:
            return "k"
        return None

    g.fill(body)

    def eye(x, y, ex):
        dx, dy = x - ex, y - (cy + 0.5)
        if (dx / 1.4) ** 2 + (dy / 2.0) ** 2 <= 1.0:
            return "w" if (dx < 0 and dy >= 1) else "k"
        return None

    def closed_eye(x, y, ex):
        # happy closed eye: a 3-wide "n" arc (ends one row below the crown)
        d = abs(x - ex)
        if (y == cy + 1 and d <= 1) or (y == cy and d == 1):
            return "k"
        return None

    closed = {"open": (), "blink": (cx - 3, cx + 3), "wink": (cx + 3,)}[expression]

    def face(x, y):
        dx, dy = x - cx, y - cy
        if math.sqrt(dx * dx + dy * dy) >= face_r:
            return None
        for ex in (cx - 3, cx + 3):
            c = closed_eye(x, y, ex) if ex in closed else eye(x, y, ex)
            if c:
                return c
        if 4 <= abs(dx) <= 5.5 and -2.5 <= dy <= -1.5:
            return "p"
        # open smile
        if abs(dx) <= 1.5 and -4 <= dy <= -2:
            if dy == -2 or (dy == -3 and abs(dx) <= 1.5) or (dy == -4 and abs(dx) <= 0.5):
                return "t" if dy == -4 or (dy == -3 and abs(dx) <= 0.5) else "m"
        return None

    g.front_paint(face, z_min=face_z)
    return g.part([cx, 1, cz])


def antenna():
    g = Grid(5, 8, 5)
    g.fill(lambda x, y, z: "k" if x == 2 and z == 2 and y <= 4 else None)
    g.fill(lambda x, y, z: ("w" if (x, y, z) == (1, 6, 3) else "r")
           if ellipsoid(2, 5.8, 2, 2.2, 2.2, 2.2)(x, y, z) else None)
    return g.part([2, 0, 2])


def torso():
    W, H, D = 13, 10, 9
    cx, cz = 6, 4
    g = Grid(W, H, D)

    def body(x, y, z):
        dx, dz = abs(x - cx), abs(z - cz)
        half_w = 5.6 + (0.6 if y <= 1 else 0) - (1.0 if y >= 8 else 0)
        half_d = 3.6 - (0.6 if y >= 8 else 0)
        if (dx / half_w) ** 4 + (dz / half_d) ** 4 > 1:
            return None
        if y == 0:
            return "R"  # hem
        # hood bunched at the back of the neck
        return "r"

    g.fill(body)
    g.fill(lambda x, y, z: "R" if y >= 8 and z <= 2 and abs(x - cx) <= 4 and ((x - cx) / 4.5) ** 2 + ((z - 1.5) / 2) ** 2 <= 1 else None)
    q = [".www.",
         "w...w",
         "w...w",
         "w..w.",
         ".ww.w"]

    def emblem(x, y):
        row = 6 - y
        col = x - (cx - 2)
        if 0 <= row < len(q) and 0 <= col < len(q[0]) and q[row][col] == "w":
            return "w"
        # drawstrings
        if x in (cx - 2, cx + 2) and y in (7, 8):
            return "w"
        # backpack straps
        if abs(x - cx) == 5 and y >= 5:
            return "k"
        return None

    g.front_paint(emblem)
    return g.part([cx, 0, cz])


def backpack():
    g = Grid(11, 8, 4)
    g.fill(lambda x, y, z: (("r" if y == 4 and z <= 1 else "k")
                            if ((x - 5) / 5.6) ** 4 + ((y - 3.5) / 4.2) ** 4 <= 1 and
                            (z >= 1 or (abs(x - 5) <= 4 and 1 <= y <= 6)) else None))
    return g.part([5, 0, 3])


def sleeve():
    g = Grid(5, 6, 5)
    g.fill(lambda x, y, z: ("R" if y == 0 else "r") if (x - 2) ** 2 + (z - 2) ** 2 <= 4.6 else None)
    return g.part([2, 5, 2])


def hand():
    g = Grid(5, 5, 5)
    g.fill(lambda x, y, z: "w" if ellipsoid(2, 2, 2, 2.4, 2.4, 2.4)(x, y, z) else None)
    return g.part([2, 4, 2])


def leg():
    g = Grid(5, 5, 5)
    g.fill(lambda x, y, z: "w" if (x - 2) ** 2 + (z - 2) ** 2 <= 4.6 else None)
    return g.part([2, 4, 2])


def shoe():
    W, H, D = 5, 4, 8
    g = Grid(W, H, D)

    def body(x, y, z):
        if not ellipsoid(2, 0.5, 3.8, 2.7, 3.4, 4.4)(x, y, z) or y > 3:
            return None
        if y == 0:
            return "W"
        if z >= 6 and y <= 2:
            return "w"  # toe cap
        if y == 2 and 3 <= z <= 4:
            return "w"  # stripe
        if y == 3:
            return "w" if abs(x - 2) <= 1 and 2 <= z <= 4 else "r"
        return "r"

    g.fill(body)
    return g.part([2, 3, 3])


def tablet():
    g = Grid(1, 10, 7)
    g.fill(lambda x, y, z: "K" if 1 <= y <= 8 and 1 <= z <= 5 else "k")
    return g.part([0, 2, 0])


def key(frame, value, interp="smooth"):
    return {"frame": frame, "value": value, "interpolation": interp}


def part_key(frame, value):
    return {"frame": frame, "value": value}


def build():
    parts = {
        "head": head(), "head_blink": head("blink"), "head_wink": head("wink"), "antenna": antenna(), "torso": torso(), "backpack": backpack(),
        "sleeve": sleeve(), "hand": hand(), "leg": leg(), "shoe": shoe(), "tablet": tablet(),
    }
    bones = {
        "root": {"translation": [0, 8.5, 0]},
        "torso": {"parent": "root", "part": "torso"},
        "backpack": {"parent": "torso", "translation": [0, 1, -4], "part": "backpack"},
        "head": {"parent": "torso", "translation": [0, 8, 0], "part": "head"},
        "antenna": {"parent": "head", "translation": [0, 19, -0.5], "part": "antenna"},
    }
    for side, sx in (("left", 1), ("right", -1)):
        bones[f"{side}_arm"] = {"parent": "torso", "translation": [sx * 7, 8, 0], "part": "sleeve",
                                "attachment": {"rotation": [0, 0, sx * 12]}}
        bones[f"{side}_hand"] = {"parent": f"{side}_arm", "translation": [0, -6, 0], "part": "hand"}
        bones[f"{side}_leg"] = {"parent": "root", "translation": [sx * 2.5, 0, 0], "part": "leg"}
        bones[f"{side}_foot"] = {"parent": f"{side}_leg", "translation": [0, -5, 0.5], "part": "shoe"}
    bones["tablet"] = {"parent": "left_hand", "translation": [0.5, -2, 2.5], "part": "tablet",
                       "attachment": {"rotation": [0, -30, 0]}}

    zero = [0, 0, 0]
    animations = {
        "idle": {"frames": 8, "fps": 8, "loop": True, "bones": {
            "root": {"translation": [key(0, zero), key(4, [0, -0.6, 0])]},
            "head": {"rotation": [key(0, [0, 0, -3]), key(4, [0, 0, 3])],
                     "part": [part_key(5, "head_blink"), part_key(6, "head")]},
            "antenna": {"rotation": [key(0, [0, 0, 10]), key(4, [0, 0, -10])]},
            "left_arm": {"rotation": [key(0, [-55, 0, 0])]},
            "right_arm": {"rotation": [key(0, [0, 0, -4]), key(4, [0, 0, 4])]},
        }},
        "walk": {"frames": 8, "fps": 10, "loop": True, "bones": {
            "root": {"translation": [key(0, zero), key(2, [0, 0.7, 0]), key(4, zero), key(6, [0, 0.7, 0])]},
            "left_leg": {"rotation": [key(0, [-30, 0, 0]), key(4, [30, 0, 0])]},
            "right_leg": {"rotation": [key(0, [30, 0, 0]), key(4, [-30, 0, 0])]},
            "left_foot": {"rotation": [key(0, [20, 0, 0]), key(2, [0, 0, 0]), key(4, [-15, 0, 0]), key(6, [0, 0, 0])]},
            "right_foot": {"rotation": [key(0, [-15, 0, 0]), key(2, [0, 0, 0]), key(4, [20, 0, 0]), key(6, [0, 0, 0])]},
            "left_arm": {"rotation": [key(0, [-55, 0, 0]), key(4, [-45, 0, 0])]},
            "right_arm": {"rotation": [key(0, [-25, 0, 0]), key(4, [25, 0, 0])]},
            "head": {"rotation": [key(0, [0, 0, -3]), key(4, [0, 0, 3])]},
            "antenna": {"rotation": [key(0, [-14, 0, 6]), key(2, [8, 0, 0]), key(4, [-14, 0, -6]), key(6, [8, 0, 0])]},
        }},
        "thumbs_up": {"frames": 8, "fps": 8, "loop": True, "bones": {
            "root": {"translation": [key(0, zero), key(4, [0, 0.5, 0])]},
            "right_arm": {"rotation": [key(0, [-60, 0, -150]), key(4, [-60, 0, -135])]},
            "left_arm": {"rotation": [key(0, [-55, 0, 0])]},
            "head": {"rotation": [key(0, [0, 0, 6]), key(4, [0, 0, 2])],
                     "part": [part_key(2, "head_wink"), part_key(6, "head")]},
            "antenna": {"rotation": [key(0, [0, 0, -12]), key(4, [0, 0, 12])]},
        }},
    }
    return {
        "palette": PALETTE, "parts": parts, "rig": {"bones": bones}, "animations": animations,
        "export": {"name": "qio", "size": [128, 168], "scale": 3, "origin": [64, 160],
                   "directions": [0, 45, 90, 135, 180, 225, 270, 315],
                   "normals": NORMALS, "shell": SHELL, "trim": True,
                   "background": [0, 0, 0, 0]},
    }


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "examples/qio.yaml")
    out.write_text(yaml.safe_dump(build(), sort_keys=False, width=1 << 20))
    print(f"wrote {out}")
