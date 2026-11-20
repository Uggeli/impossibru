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


def head():
    """Blank head: red ring, white face disc (stickers from face() sit in front of it)."""
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

    return g.part([cx, 1, cz])


FACES = ("happy", "blink", "wink", "excited", "thinking", "surprised", "content", "worried")
FACE_SIZE = 15  # sticker grid, centred on the face disc
FACE_OFFSET = [0, 9, 8]  # face bone in head space: disc centre, one voxel in front of the disc


def face(name: str):
    """Thin face sticker. Grid x/y are face-local with (0, 0) at the disc centre; +x = character's left."""
    if name not in FACES:
        raise ValueError(name)
    n = FACE_SIZE
    half = n // 2
    g = Grid(n, n, 1)
    ex = 3  # eye centres at x = +-3

    def open_eye(dx, dy):
        if (dx / 1.6) ** 2 + ((dy - 0.5) / 2.2) ** 2 <= 1.0:  # 3x4 oval with a glint
            return "w" if (dx, dy) == (-1, 2) else "k"
        return None

    def small_eye(dx, dy):
        return "k" if abs(dx) <= 0.5 and 0 <= dy <= 1 else None

    def round_eye(dx, dy):
        if abs(dx) <= 1 and 0 <= dy <= 2:  # 3x3 wide-open stare with a glint
            return "w" if (dx, dy) == (-1, 2) else "k"
        return None

    def closed_eye(dx, dy):
        d = abs(dx)
        return "k" if (dy == 1 and d <= 1) or (dy == 0 and d == 1) else None

    def star_eye(dx, dy):
        dy -= 0.5
        if abs(dx) + abs(dy) <= 1.5 or (abs(dx) <= 0.5 and abs(dy) <= 2.5) or (abs(dy) <= 0.5 and abs(dx) <= 2.0):
            return "y"
        return None

    eyes = {
        "happy": (open_eye, open_eye), "blink": (closed_eye, closed_eye), "wink": (open_eye, closed_eye),
        "excited": (star_eye, star_eye), "thinking": (small_eye, small_eye), "surprised": (round_eye, round_eye),
        "content": (closed_eye, closed_eye), "worried": (open_eye, open_eye),
    }[name]  # (character's right eye at -x, left eye at +x)

    def brows(dx, dy):
        if name == "thinking":  # left brow raised and slanted, right brow flat
            return (dx in (2, 3, 4) and dy == 3 + (dx == 3) + (dx == 4)) or (dx in (-4, -3, -2) and dy == 3)
        if name == "surprised":
            return abs(dx) in (2, 3, 4) and dy == 4
        if name == "worried":  # inner ends up
            return abs(dx) in (2, 3, 4) and dy == 4 + (abs(dx) == 2)
        return False

    def mouth(dx, dy):
        if name in ("happy", "blink", "wink"):
            if abs(dx) <= 1.5 and -4 <= dy <= -2:
                if dy == -2 or dy == -3 or (dy == -4 and abs(dx) <= 0.5):
                    return "t" if dy == -4 or (dy == -3 and abs(dx) <= 0.5) else "m"
        elif name == "excited":  # wide open grin
            if abs(dx) <= 2 and -5 <= dy <= -2 and not (dy == -5 and abs(dx) == 2):
                return "t" if dy <= -4 and abs(dx) <= 1 else "m"
        elif name == "thinking":
            if dy == -3 and -1 <= dx <= 2:
                return "m"
        elif name == "surprised":
            if abs(dx) <= 1 and -5 <= dy <= -3 and not (abs(dx) == 1 and dy in (-3, -5)):
                return "m" if (dx, dy) != (0, -4) else "t"
            if abs(dx) == 1 and dy in (-3, -5):
                return None
        elif name == "content":
            if (abs(dx) == 2 and dy == -2) or (abs(dx) <= 1 and dy == -3):
                return "m"
        elif name == "worried":
            if abs(dx) <= 2 and dy == (-3 if dx % 2 == 0 else -2):
                return "m"
        return None

    def paint(x, y, z):
        dx, dy = x - half, y - half
        if dx * dx + dy * dy >= 42:  # stay on the disc
            return None
        for i, cx_ in enumerate((-ex, ex)):
            c = eyes[i](dx - cx_, dy)
            if c:
                return c
        if brows(dx, dy):
            return "k"
        c = mouth(dx, dy)
        if c:
            return c
        if name not in ("thinking", "worried") and 4 <= abs(dx) <= 5.5 and -2.5 <= dy <= -1.5:
            return "p"
        return None

    g.fill(paint)
    return g.part([half, half, 0])


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


FX = ("fx_question", "fx_exclaim", "fx_stars", "fx_note", "fx_swirl")


def glyph(rows, depth=2):
    """Flat prop drawn as text rows (top row first); pivot at the bottom centre."""
    h, w = len(rows), max(len(r) for r in rows)
    g = Grid(w, h, depth)
    g.fill(lambda x, y, z: (rows[h - 1 - y].ljust(w)[x] if rows[h - 1 - y].ljust(w)[x] not in ". " else None))
    return g.part([(w - 1) / 2, 0, (depth - 1) / 2])


def fx_question():
    return glyph([".rrr.", "r...r", "....r", "..rr.", "..r..", ".....", "..r.."])


def fx_exclaim():
    return glyph(["r.r", "r.r", "r.r", "r.r", "...", "r.r"])


def fx_stars():
    star = ["..y..", "..y..", "yyyyy", "..y..", "..y.."]
    small = [".....", ".....", "..y..", ".yyy.", "..y.."]
    gap = "." * 23
    return glyph([a + gap + b for a, b in zip(star, small)])


def fx_note():
    return glyph(["..rrr", "..r.r", "..r..", "..r..", "rrr..", "rrr.."])


def fx_swirl():
    """White whirlwind under the feet: three broken rings narrowing downward."""
    W, H, D = 13, 4, 13
    g = Grid(W, H, D)
    c = (W - 1) / 2

    def body(x, y, z):
        r = math.hypot(x - c, z - c)
        target = (2.0, 3.6, 5.2, 6.0)[y]
        a = math.degrees(math.atan2(z - c, x - c)) + y * 70
        if abs(r - target) <= 0.6 and (a % 360) < 250:
            return "w"
        return None

    g.fill(body)
    return g.part([c, H - 1, c])


def key(frame, value, interp="smooth"):
    return {"frame": frame, "value": value, "interpolation": interp}


def part_key(frame, value):
    return {"frame": frame, "value": value}


def aim(dx, dy, dz):
    """Arm rotation [x, 0, z] that points a hanging (-Y) arm along torso-space direction (dx, dy, dz).

    Rotation order is X then Z (euler XYZ); x is kept in (-270, 90] so raising swings forward."""
    n = math.sqrt(dx * dx + dy * dy + dz * dz)
    dx, dy, dz = dx / n, dy / n, dz / n
    z = math.asin(max(-1.0, min(1.0, dx)))
    c = math.cos(z)
    x = math.degrees(math.atan2(-dz / c, -dy / c)) if c > 1e-6 else 0.0
    if x > 90:
        x -= 360
    return [round(x, 1), 0, round(math.degrees(z), 1)]


def show(spans, part, frames):
    """Part keys that show `part` on frames [a, b) for each (a, b) in spans, hidden elsewhere."""
    keys = {0: None}
    for a, b in spans:
        if b < frames:
            keys[b] = None
    for a, b in spans:
        keys[a] = part
    return [part_key(f, v) for f, v in sorted(keys.items())]


TABLET_ARM = [-55, 0, 0]  # left arm holding the tablet in front (rest pose for most clips)


def assistant_clips():
    """The AI-assistant vocabulary (see docs/superpowers/specs/2026-11-20-qio-expressions-vocabulary-design.md)."""
    zero = [0, 0, 0]
    lin = "linear"
    return {
        "float": {"frames": 8, "fps": 8, "loop": True, "bones": {
            "root": {"translation": [key(0, [0, 3, 0]), key(4, [0, 4, 0])]},
            "left_leg": {"rotation": [key(0, [-35, 0, 4])]},
            "right_leg": {"rotation": [key(0, [-25, 0, -4]), key(4, [-35, 0, -4])]},
            "left_foot": {"rotation": [key(0, [35, 0, 0])]},
            "right_foot": {"rotation": [key(0, [30, 0, 0])]},
            "left_arm": {"rotation": [key(0, TABLET_ARM)]},
            "right_arm": {"rotation": [key(0, [0, 0, -25]), key(4, [0, 0, -35])]},
            "head": {"rotation": [key(0, [0, 0, -2]), key(4, [0, 0, 2])]},
            "antenna": {"rotation": [key(0, [-10, 0, 0]), key(4, [10, 0, 0])]},
            "fx_swirl": {"rotation": [key(f, [0, f * 45, 0], lin) for f in (0, 2, 4, 6)],
                         "part": [part_key(0, "fx_swirl")]},
        }},
        "listen": {"frames": 8, "fps": 8, "loop": True, "bones": {
            "root": {"translation": [key(0, zero), key(4, [0, -0.4, 0])]},
            "head": {"rotation": [key(0, [0, 0, 9]), key(4, [0, 0, 12])]},
            "right_arm": {"rotation": [key(0, aim(-0.3, 1, 0.25))]},
            "left_arm": {"rotation": [key(0, TABLET_ARM)]},
            "face": {"part": [part_key(0, "face_happy"), part_key(6, "face_blink"), part_key(7, "face_happy")]},
            "antenna": {"rotation": [key(0, [0, 0, -8]), key(4, [0, 0, 8])]},
        }},
        "think": {"frames": 10, "fps": 8, "loop": True, "bones": {
            "root": {"translation": [key(0, zero), key(5, [0, -0.4, 0])]},
            "head": {"rotation": [key(0, [-6, 0, -8]), key(5, [-6, 0, -11])]},
            "right_arm": {"rotation": [key(0, aim(0.7, 0.12, 0.7))]},
            "left_arm": {"rotation": [key(0, TABLET_ARM)]},
            "face": {"part": [part_key(0, "face_thinking")]},
            "fx_question": {"translation": [key(0, zero), key(5, [0, 1, 0])],
                            "part": show([(2, 10)], "fx_question", 10)},
            "antenna": {"rotation": [key(0, [0, 0, 6]), key(5, [0, 0, -6])]},
        }},
        "present": {"frames": 10, "fps": 10, "loop": False, "bones": {
            "root": {"translation": [key(0, zero), key(2, [0, -0.8, 0]), key(4, [0, 1.2, 0]), key(6, zero)]},
            "left_arm": {"rotation": [key(0, TABLET_ARM), key(4, aim(0.15, 0.45, 1))]},
            "right_arm": {"rotation": [key(0, [0, 0, -4]), key(4, aim(0.25, 0.4, 1))]},
            "head": {"rotation": [key(0, zero), key(4, [6, 0, 4])]},
            "face": {"part": [part_key(0, "face_happy"), part_key(3, "face_excited")]},
            "fx_stars": {"part": show([(3, 10)], "fx_stars", 10)},
            "antenna": {"rotation": [key(0, zero), key(4, [-16, 0, 0]), key(7, [8, 0, 0]), key(9, zero)]},
        }},
        "confused": {"frames": 10, "fps": 10, "loop": False, "bones": {
            "torso": {"translation": [key(0, zero), key(3, [0, 0.6, 0]), key(9, [0, 0.3, 0])]},
            "left_arm": {"rotation": [key(0, TABLET_ARM), key(3, aim(1, -0.2, 0.5))]},
            "right_arm": {"rotation": [key(0, [0, 0, -4]), key(3, aim(-1, -0.2, 0.5))]},
            "head": {"rotation": [key(0, zero), key(3, [0, 0, -12]), key(9, [0, 0, -9])]},
            "face": {"part": [part_key(0, "face_happy"), part_key(2, "face_worried")]},
            "fx_question": {"part": show([(3, 10)], "fx_question", 10)},
            "antenna": {"rotation": [key(0, zero), key(3, [0, 0, 18]), key(6, [0, 0, -8]), key(9, [0, 0, 4])]},
        }},
        "celebrate": {"frames": 12, "fps": 12, "loop": False, "bones": {
            "root": {"translation": [key(0, zero), key(2, [0, -1.5, 0]), key(5, [0, 4, 0]),
                                     key(8, [0, 1, 0]), key(9, [0, -1, 0]), key(11, zero)]},
            "left_leg": {"rotation": [key(0, zero), key(2, [-20, 0, 0]), key(5, [-35, 0, 6]), key(8, [-10, 0, 0]), key(10, zero)]},
            "right_leg": {"rotation": [key(0, zero), key(2, [-20, 0, 0]), key(5, [-35, 0, -6]), key(8, [-10, 0, 0]), key(10, zero)]},
            "left_foot": {"rotation": [key(0, zero), key(5, [35, 0, 0]), key(9, zero)]},
            "right_foot": {"rotation": [key(0, zero), key(5, [35, 0, 0]), key(9, zero)]},
            "left_arm": {"rotation": [key(0, TABLET_ARM), key(3, aim(0.85, 0.55, 0.15)), key(9, aim(0.9, 0.45, 0.15)), key(11, TABLET_ARM)]},
            "right_arm": {"rotation": [key(0, [0, 0, -4]), key(3, aim(-0.85, 0.55, 0.15)), key(9, aim(-0.9, 0.45, 0.15)), key(11, [0, 0, -4])]},
            "head": {"rotation": [key(0, zero), key(2, [8, 0, 0]), key(5, [-8, 0, 0]), key(9, zero)]},
            "face": {"part": [part_key(0, "face_happy"), part_key(3, "face_excited"), part_key(11, "face_happy")]},
            "fx_stars": {"part": show([(4, 11)], "fx_stars", 12)},
            "antenna": {"rotation": [key(0, zero), key(2, [14, 0, 0]), key(5, [-20, 0, 0]), key(8, [10, 0, 0]), key(11, zero)]},
        }},
        "wave": {"frames": 12, "fps": 10, "loop": False, "bones": {
            "root": {"translation": [key(0, zero), key(6, [0, 0.4, 0]), key(11, zero)]},
            "right_arm": {"rotation": [key(0, [0, 0, -4]), key(2, aim(-0.75, 0.75, 0.15)), key(4, aim(-0.35, 1, 0.15)),
                                       key(6, aim(-0.75, 0.75, 0.15)), key(8, aim(-0.35, 1, 0.15)), key(11, [0, 0, -4])]},
            "left_arm": {"rotation": [key(0, TABLET_ARM)]},
            "head": {"rotation": [key(0, zero), key(4, [0, 0, -8]), key(9, [0, 0, -5]), key(11, zero)]},
            "face": {"part": [part_key(0, "face_happy"), part_key(4, "face_wink"), part_key(8, "face_happy")]},
            "antenna": {"rotation": [key(0, zero), key(3, [0, 0, 12]), key(6, [0, 0, -12]), key(9, [0, 0, 8]), key(11, zero)]},
        }},
        "surprised": {"frames": 10, "fps": 10, "loop": False, "bones": {
            "root": {"translation": [key(0, zero), key(2, [0, 2, -1.5]), key(4, [0, 0, -1.5]), key(5, [0, -0.6, -1.5]),
                                     key(7, [0, 0, -1.5])]},
            "left_arm": {"rotation": [key(0, TABLET_ARM), key(2, aim(0.8, 0.5, 0.4)), key(7, aim(0.6, 0.1, 0.6))]},
            "right_arm": {"rotation": [key(0, [0, 0, -4]), key(2, aim(-0.8, 0.5, 0.4)), key(7, aim(-0.6, 0.1, 0.6))]},
            "head": {"rotation": [key(0, zero), key(2, [-10, 0, 0]), key(6, [-4, 0, 0])]},
            "face": {"part": [part_key(0, "face_happy"), part_key(1, "face_surprised")]},
            "fx_exclaim": {"part": show([(1, 9)], "fx_exclaim", 10)},
            "antenna": {"rotation": [key(0, zero), key(2, [-25, 0, 0]), key(5, [15, 0, 0]), key(8, [-5, 0, 0])]},
        }},
        "content": {"frames": 12, "fps": 6, "loop": True, "bones": {
            "torso": {"rotation": [key(0, [0, 0, -4]), key(6, [0, 0, 4])]},
            "head": {"rotation": [key(0, [0, 0, -6]), key(6, [0, 0, 6])]},
            "left_arm": {"rotation": [key(0, TABLET_ARM)]},
            "right_arm": {"rotation": [key(0, [0, 0, -2]), key(6, [0, 0, -8])]},
            "face": {"part": [part_key(0, "face_content")]},
            "fx_note": {"translation": [key(0, zero), key(6, [0, 1.5, 0])],
                        "part": show([(0, 4), (6, 10)], "fx_note", 12)},
            "antenna": {"rotation": [key(0, [0, 0, 10]), key(6, [0, 0, -10])]},
        }},
    }


POINT_HEIGHTS = {"up": 1.1, "level": 0.05, "down": -1.0}  # arm direction dy per height


def point_clips():
    """point_{side}_{height}: shown at yaw 45 (right) / 315 (left); points with the arm nearer the target."""
    zero = [0, 0, 0]
    clips = {}
    for side, sx in (("right", 1), ("left", -1)):  # +X (character's left) is screen-right at yaw 45
        arm, other = ("left", "right") if side == "right" else ("right", "left")
        other_rest = TABLET_ARM if other == "left" else [0, 0, -4]
        arm_rest = TABLET_ARM if arm == "left" else [0, 0, -4]
        for height, dy in POINT_HEIGHTS.items():
            target = aim(sx * 1.0, dy, 0.8)
            overshoot = aim(sx * 1.0, dy + 0.15, 0.7)
            clips[f"point_{side}_{height}"] = {"frames": 8, "fps": 10, "loop": False, "bones": {
                "root": {"translation": [key(0, zero), key(2, [0, 0.6, 0]), key(4, zero)]},
                "torso": {"rotation": [key(0, zero), key(4, [0, sx * 8, 0])]},
                f"{arm}_arm": {"rotation": [key(0, arm_rest), key(3, overshoot), key(5, target)],
                               # reach: shoulder slides forward/out so the hand clears the big head
                               "translation": [key(0, zero), key(4, [sx * 1, 1, 2.5])]},
                f"{other}_arm": {"rotation": [key(0, other_rest)]},
                "head": {"rotation": [key(0, zero), key(4, [-6 * dy, sx * 12, -sx * 4])]},
                "face": {"part": [part_key(0, "face_happy"), part_key(3, "face_wink"), part_key(5, "face_happy")]},
                "antenna": {"rotation": [key(0, zero), key(3, [0, 0, -sx * 14]), key(6, [0, 0, sx * 6]), key(7, zero)]},
            }}
    return clips


def build():
    parts = {
        "head": head(), "antenna": antenna(), "torso": torso(), "backpack": backpack(),
        "sleeve": sleeve(), "hand": hand(), "leg": leg(), "shoe": shoe(), "tablet": tablet(),
    }
    parts.update({f"face_{n}": face(n) for n in FACES})
    parts.update({"fx_question": fx_question(), "fx_exclaim": fx_exclaim(), "fx_stars": fx_stars(),
                  "fx_note": fx_note(), "fx_swirl": fx_swirl()})
    bones = {
        "root": {"translation": [0, 8.5, 0]},
        "torso": {"parent": "root", "part": "torso"},
        "backpack": {"parent": "torso", "translation": [0, 1, -4], "part": "backpack"},
        "head": {"parent": "torso", "translation": [0, 8, 0], "part": "head"},
        "face": {"parent": "head", "translation": FACE_OFFSET, "part": "face_happy"},
        # effect props: hidden (part None) until a clip's part keys show them
        "fx_question": {"parent": "head", "translation": [12, 18, 2], "part": None},
        "fx_exclaim": {"parent": "head", "translation": [12, 18, 2], "part": None},
        "fx_stars": {"parent": "head", "translation": [0, 14, 4], "part": None},
        "fx_note": {"parent": "head", "translation": [12, 17, 2], "part": None},
        "fx_swirl": {"parent": "root", "translation": [0, -9, 0], "part": None},
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
            "head": {"rotation": [key(0, [0, 0, -3]), key(4, [0, 0, 3])]},
            "face": {"part": [part_key(5, "face_blink"), part_key(6, "face_happy")]},
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
        "thumbs_up": {"frames": 8, "fps": 8, "loop": False, "bones": {
            "root": {"translation": [key(0, zero), key(4, [0, 0.5, 0])]},
            "right_arm": {"rotation": [key(0, [-60, 0, -150]), key(4, [-60, 0, -135])]},
            "left_arm": {"rotation": [key(0, [-55, 0, 0])]},
            "head": {"rotation": [key(0, [0, 0, 6]), key(4, [0, 0, 2])]},
            "face": {"part": [part_key(2, "face_wink"), part_key(6, "face_happy")]},
            "antenna": {"rotation": [key(0, [0, 0, -12]), key(4, [0, 0, 12])]},
        }},
    }
    animations.update(assistant_clips())
    animations.update(point_clips())
    return {
        "palette": PALETTE, "parts": parts, "rig": {"bones": bones}, "animations": animations,
        "export": {"name": "qio", "size": [128, 168], "scale": 3, "origin": [64, 160],
                   "directions": [0, 45, 315],
                   "normals": NORMALS, "shell": SHELL, "trim": True,
                   "background": [0, 0, 0, 0]},
    }


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "examples/qio.yaml")
    out.write_text(yaml.safe_dump(build(), sort_keys=False, width=1 << 20))
    print(f"wrote {out}")
