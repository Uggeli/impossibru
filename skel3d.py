#!/usr/bin/env python3
"""
Full pipeline:
  ASCII part views (front + side)  --shape-from-silhouette-->  colored voxels
  voxels on a 3D skeleton  -->  3D two-bone IK  -->  spin camera  -->  bake PNG sheets
"""
import math
import numpy as np
from PIL import Image

# --------------------------------------------------------------------------
# palette
# --------------------------------------------------------------------------
PAL = {
    '.': None,
    's': (240, 196, 154),   # skin
    'h': (74, 48, 34),      # hair
    'e': (34, 26, 26),      # eye
    'r': (208, 70, 70),     # shirt
    'b': (62, 100, 176),    # pants
    'n': (96, 62, 42),      # shoe
}

# --------------------------------------------------------------------------
# 1. ASCII VIEWS  ->  VOXELS  (shape from silhouette)
# --------------------------------------------------------------------------
def rrect(w, h, char, r=None):
    """rounded-rect char grid (w wide, h tall)."""
    if r is None:
        r = min(w, h) / 2.0
    cx = (w - 1) / 2.0
    g = [['.'] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            inside = False
            if r <= y <= h - 1 - r:
                inside = abs(x - cx) <= (w - 1) / 2.0 + 0.5
            else:
                ey = r if y < r else h - 1 - r
                if (x - cx) ** 2 + (y - ey) ** 2 <= ((w - 1) / 2.0) ** 2 + 0.5:
                    inside = True
            if inside:
                g[y][x] = char
    return g

def ellipse(w, h, char):
    cx, cy = (w - 1) / 2.0, (h - 1) / 2.0
    rx, ry = w / 2.0, h / 2.0
    g = [['.'] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0:
                g[y][x] = char
    return g

def voxelize(front, side, radial='xz', extra_paint=None, flip_y=False):
    """front: X-Y char grid (width x height). side: Z-Y grid (depth x height).
       heights must match. Voxel exists where BOTH silhouettes are solid.
       Returns (pos Nx3 float, col Nx3 uint8, nrm Nx3 float) in LOCAL space.
       flip_y=False: proximal joint at y=0 (grid top), long axis +Y down the bone.
       flip_y=True : pivot at grid BOTTOM, grid-top rises to +Y (for head)."""
    H = len(front)
    W = len(front[0])
    D = len(side[0])
    cx, cz = (W - 1) / 2.0, (D - 1) / 2.0
    cy = (H - 1) / 2.0
    pos, col, nrm = [], [], []
    for y in range(H):
        for x in range(W):
            fc = front[y][x]
            if fc == '.':
                continue
            for z in range(D):
                sc = side[y][z]
                if sc == '.':
                    continue
                c = fc
                if extra_paint:
                    c = extra_paint(x, y, z, W, H, D, fc)
                rgb = PAL[c]
                if rgb is None:
                    continue
                ly = float(H - 1 - y) if flip_y else float(y)
                pos.append((x - cx, ly, z - cz))
                col.append(rgb)
                ny = -(y - cy) if flip_y else (y - cy)
                if radial == 'full':
                    n = (x - cx, ny, z - cz)
                else:  # cylinder: radial in X-Z only
                    n = (x - cx, 0.0, z - cz)
                nrm.append(n)
    pos = np.array(pos, float)
    col = np.array(col, np.uint8)
    nrm = np.array(nrm, float)
    ln = np.linalg.norm(nrm, axis=1, keepdims=True)
    ln[ln == 0] = 1
    nrm = nrm / ln
    return pos, col, nrm

def capsule_part(length, width, depth, char):
    return voxelize(rrect(width, length, char), rrect(depth, length, char), 'xz')

# ---- head with face painted on the FRONT (+Z) hemisphere -----------------
def head_part():
    W = D = 16
    H = 16
    front = ellipse(W, H, 's')
    side = ellipse(D, H, 's')
    # hair on top + back; eyes on front. (grid y=0 is TOP -> hair.)
    def paint(x, y, z, W, H, D, fc):
        cx, cy, cz = (W-1)/2, (H-1)/2, (D-1)/2
        top = (y - cy) < H * 0.02
        back = (z - cz) < D * 0.02 and (y - cy) < H * 0.34
        if top or back:
            return 'h'
        # eyes: on the front surface, slightly above center
        if (z - cz) > D * 0.26 and -1.6 < (y - cy) < 0.8:
            if 1.6 < abs(x - cx) < 3.8:
                return 'e'
        return 's'
    return voxelize(front, side, 'full', extra_paint=paint, flip_y=True)

# --------------------------------------------------------------------------
# component library (voxel units) ; bone lengths == part lengths
# --------------------------------------------------------------------------
UP_ARM, LO_ARM = 13, 13
UP_LEG, LO_LEG = 15, 15
TORSO = 20
PARTS = {
    'upper_arm': capsule_part(UP_ARM, 6, 6, 'r'),
    'lower_arm': capsule_part(LO_ARM, 5, 5, 'r'),   # (hand handled below)
    'upper_leg': capsule_part(UP_LEG, 8, 8, 'b'),
    'lower_leg': capsule_part(LO_LEG, 7, 7, 'b'),
    'torso':     capsule_part(TORSO, 17, 10, 'r'),
    'foot':      capsule_part(10, 5, 8, 'n'),
    'hand':      voxelize(ellipse(5, 5, 's'), ellipse(5, 5, 's'), 'full'),
    'head':      head_part(),
}
print('voxel counts:', {k: len(v[0]) for k, v in PARTS.items()})

# --------------------------------------------------------------------------
# math helpers
# --------------------------------------------------------------------------
def norm(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v

def rot_from_to(a, b):
    """rotation mapping unit a -> unit b (minimal / roll-free)."""
    a = norm(np.asarray(a, float)); b = norm(np.asarray(b, float))
    v = np.cross(a, b); c = float(np.dot(a, b))
    if c > 0.99999:
        return np.eye(3)
    if c < -0.99999:
        # 180 deg about any perpendicular axis
        ax = norm(np.cross(a, [1, 0, 0]) if abs(a[0]) < 0.9 else np.cross(a, [0, 1, 0]))
        vx = np.array([[0, -ax[2], ax[1]], [ax[2], 0, -ax[0]], [-ax[1], ax[0], 0]])
        return np.eye(3) + 2 * vx @ vx
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1 / (1 + c))

def look_rot(ydir, fwd):
    """basis mapping local +Y->ydir, local +Z->(fwd made orthogonal)."""
    y = norm(np.asarray(ydir, float))
    z = np.asarray(fwd, float); z = norm(z - np.dot(z, y) * y)
    x = np.cross(y, z)
    return np.column_stack([x, y, z])

def ik2_3d(root, target, l1, l2, pole):
    """3D two-bone IK. pole = direction the mid-joint should bend toward."""
    root = np.asarray(root, float); target = np.asarray(target, float)
    d = target - root
    dist = np.linalg.norm(d)
    dist = max(abs(l1 - l2) + 1e-3, min(l1 + l2 - 1e-3, dist))
    dirn = norm(d)
    # in-plane perpendicular pointing toward the pole
    pole = np.asarray(pole, float)
    bend = pole - np.dot(pole, dirn) * dirn
    if np.linalg.norm(bend) < 1e-6:
        bend = np.cross(dirn, [0, 0, 1])
    bend = norm(bend)
    cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
    A = math.acos(max(-1.0, min(1.0, cosA)))
    joint = root + l1 * (math.cos(A) * dirn + math.sin(A) * bend)
    endeff = root + dist * dirn
    return joint, endeff

# --------------------------------------------------------------------------
# 2. RIG + WALK (3D)   character faces +Z, up = +Y, walks along +Z
# --------------------------------------------------------------------------
GROUND = 0.0
PELVIS_Y = UP_LEG + LO_LEG - 2          # stand height above ground
STRIDE, LIFT = 16, 9
HIP_DX, SHO_DX = 4.0, 6.5               # left/right offsets (X = sideways)

def foot_target(phase, side):
    frac = phase % 1.0
    zc = 0.0
    if frac < 0.5:
        t = frac / 0.5
        zc = STRIDE / 2 - STRIDE * t
        yc = GROUND
    else:
        t = (frac - 0.5) / 0.5
        zc = -STRIDE / 2 + STRIDE * t
        yc = GROUND + LIFT * math.sin(math.pi * t)
    return np.array([side * HIP_DX, yc, zc])

def pose_bones(phase):
    """Return list of (part_name, R 3x3, P world-proximal) for this frame."""
    bob = 1.6 * abs(math.sin(2 * math.pi * phase * 2))
    pelvis = np.array([0.0, PELVIS_Y - bob, 0.0])
    neck = pelvis + np.array([0.0, TORSO, 1.2])          # slight forward lean (+Z)
    fwd = np.array([0.0, 0.0, 1.0])                      # character faces +Z
    up = np.array([0.0, 1.0, 0.0])
    bones = []

    # torso (pelvis -> neck), keep facing
    bones.append(('torso', look_rot(neck - pelvis, fwd), pelvis))
    # head sits above neck
    bones.append(('head', look_rot(up, fwd), neck + np.array([0, -1.0, 0])))

    for side in (+1, -1):     # +1 = character's left? just two legs/arms
        # ---- leg ----
        hip = pelvis + np.array([side * HIP_DX, 0, 0])
        tgt = foot_target(phase + (0.0 if side > 0 else 0.5), side)
        knee, endeff = ik2_3d(hip, tgt, UP_LEG, LO_LEG, pole=fwd)   # knee -> +Z
        bones.append(('upper_leg', rot_from_to(up * -1, knee - hip) if False
                      else rot_from_to([0, 1, 0], knee - hip), hip))
        bones.append(('lower_leg', rot_from_to([0, 1, 0], endeff - knee), knee))
        bones.append(('foot', look_rot(fwd, up), endeff + np.array([0, -1, 2.5])))

        # ---- arm ----
        sho = neck + np.array([side * SHO_DX, -1.0, 0])
        swing = 9 * math.sin(2 * math.pi * (phase + (0.5 if side > 0 else 0.0)))
        hand_t = sho + np.array([0, -(UP_ARM + LO_ARM) * 0.82, swing])
        elbow, hend = ik2_3d(sho, hand_t, UP_ARM, LO_ARM, pole=-fwd)  # elbow -> -Z
        bones.append(('upper_arm', rot_from_to([0, 1, 0], elbow - sho), sho))
        bones.append(('lower_arm', rot_from_to([0, 1, 0], hend - elbow), elbow))
        bones.append(('hand', np.eye(3), hend))
    return bones

# --------------------------------------------------------------------------
# 3. RENDER : spin camera around +Y, orthographic, z-buffer splat
# --------------------------------------------------------------------------
CW, CH = 60, 84
SS = 5                                        # pixels per voxel (voxels drawn as cubes)
ORIGIN = np.array([CW / 2.0, CH - 12.0])      # where pelvis lands (voxel units)
LIGHT = norm(np.array([-0.35, 0.55, 0.75]))

def cam_yaw(theta):
    c, s = math.cos(theta), math.sin(theta)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])   # world -> camera

# tile offsets so each voxel paints an SSxSS block (centered) -> cubes tile solid
_OX, _OY = np.meshgrid(np.arange(SS) - SS // 2, np.arange(SS) - SS // 2)
_OX = _OX.ravel(); _OY = _OY.ravel()

def render(phase, theta):
    Ry = cam_yaw(theta)
    P_all, C_all, N_all = [], [], []
    for name, R, P in pose_bones(phase):
        lp, lc, ln = PARTS[name]
        P_all.append((R @ lp.T).T + P)
        C_all.append(lc)
        N_all.append((R @ ln.T).T)
    world = np.concatenate(P_all); col = np.concatenate(C_all).astype(float)
    wn = np.concatenate(N_all)

    cam = (Ry @ world.T).T
    camn = (Ry @ wn.T).T
    sh = 0.35 + 0.65 * np.clip(camn @ LIGHT, 0, 1)
    rgb = np.clip(col * sh[:, None], 0, 255).astype(np.uint8)

    W, H = CW * SS, CH * SS
    bx = np.round((ORIGIN[0] + cam[:, 0]) * SS).astype(int)
    by = np.round((ORIGIN[1] - cam[:, 1]) * SS).astype(int)
    depth = cam[:, 2]
    # expand each voxel into an SSxSS block
    px = (bx[:, None] + _OX[None, :]).ravel()
    py = (by[:, None] + _OY[None, :]).ravel()
    pd = np.repeat(depth, SS * SS)
    pc = np.repeat(rgb, SS * SS, axis=0)
    m = (px >= 0) & (px < W) & (py >= 0) & (py < H)
    px, py, pd, pc = px[m], py[m], pd[m], pc[m]
    order = np.argsort(pd, kind='stable')       # far first -> near overwrites
    px, py, pc = px[order], py[order], pc[order]
    buf = np.zeros((H, W, 4), np.uint8)
    buf[py, px, :3] = pc
    buf[py, px, 3] = 255
    return Image.fromarray(buf, 'RGBA')

# --------------------------------------------------------------------------
if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == 'test':
        render(0.15, math.radians(35)).save('/home/claude/v3_test.png')
        print('test frame saved')
    else:
        DIRS = 8
        FRAMES = 8
        cellw, cellh = CW * 3, CH * 3        # sheet tile size
        bg = Image.new('RGBA', (cellw * FRAMES, cellh * DIRS), (26, 28, 34, 255))
        for d in range(DIRS):
            for f in range(FRAMES):
                im = render(f / FRAMES, math.radians(d * 360 / DIRS))
                bg.alpha_composite(im.resize((cellw, cellh), Image.NEAREST),
                                   (f * cellw, d * cellh))
        bg.save('/home/claude/v3_sheet.png')

        # turntable gif: fixed mid-stride pose, spin 360
        spin = [render(0.12, math.radians(a)) for a in range(0, 360, 15)]
        spin[0].save('/home/claude/v3_turntable.gif', save_all=True,
                     append_images=spin[1:], duration=90, loop=0, disposal=2)

        # one-direction walk gif (3/4 view)
        wk = [render(f / 16, math.radians(35)) for f in range(16)]
        wk[0].save('/home/claude/v3_walk.gif', save_all=True,
                   append_images=wk[1:], duration=90, loop=0, disposal=2)
        print('rendered', DIRS, 'directions x', FRAMES, 'frames')