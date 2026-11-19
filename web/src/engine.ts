import type { Color, Key, ProjectDocument, Vec3 } from './types';

export class ProjectError extends Error {}

export type Mat = number[];
export const I = (): Mat => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export const mul = (a: Mat, b: Mat): Mat =>
  a.map((_, i) => {
    const r = i >> 2,
      c = i & 3;
    return (
      a[r * 4] * b[c] +
      a[r * 4 + 1] * b[c + 4] +
      a[r * 4 + 2] * b[c + 8] +
      a[r * 4 + 3] * b[c + 12]
    );
  });

export const mv = (m: Mat, v: number[]): number[] => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3],
  m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7],
  m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11],
];

export const euler = (d: Vec3): Mat => {
  const [x, y, z] = d.map((v) => (v * Math.PI) / 180),
    cx = Math.cos(x),
    sx = Math.sin(x),
    cy = Math.cos(y),
    sy = Math.sin(y),
    cz = Math.cos(z),
    sz = Math.sin(z);
  return [
    cy * cz,
    -cy * sz,
    sy,
    0,
    cx * sz + sx * sy * cz,
    cx * cz - sx * sy * sz,
    -sx * cy,
    0,
    sx * sz - cx * sy * cz,
    sx * cz + cx * sy * sz,
    cx * cy,
    0,
    0,
    0,
    0,
    1,
  ];
};

export const transform = (
  r: Vec3 | undefined = [0, 0, 0],
  t: Vec3 | undefined = [0, 0, 0]
): Mat => {
  r = r || [0, 0, 0];
  t = t || [0, 0, 0];
  const m = euler(r);
  m[3] = t[0];
  m[7] = t[1];
  m[11] = t[2];
  return m;
};

export const norm = (v: number[]): number[] => {
  const n = Math.hypot(...v);
  return n > 1e-9 ? v.map((x) => x / n) : v;
};

export const normalizeAngle = (v: number): number => {
  const x = (v + 180) % 360;
  const y = (x < 0 ? x + 360 : x) - 180;
  return Math.abs(y) < 1e-10 ? 0 : y;
};

export const inverseRigid = (m: Mat): Mat => [
  m[0],
  m[4],
  m[8],
  -(m[0] * m[3] + m[4] * m[7] + m[8] * m[11]),
  m[1],
  m[5],
  m[9],
  -(m[1] * m[3] + m[5] * m[7] + m[9] * m[11]),
  m[2],
  m[6],
  m[10],
  -(m[2] * m[3] + m[6] * m[7] + m[10] * m[11]),
  0,
  0,
  0,
  1,
];

export const eulerFrom = (m: Mat): Vec3 => {
  const y = Math.asin(Math.max(-1, Math.min(1, m[2]))),
    cy = Math.cos(y),
    x =
      Math.abs(cy) > 1e-7
        ? Math.atan2(-m[6], m[10])
        : Math.atan2(m[9], m[5]),
    z = Math.abs(cy) > 1e-7 ? Math.atan2(-m[1], m[0]) : 0;
  return [x, y, z].map((v) => normalizeAngle((v * 180) / Math.PI)) as Vec3;
};

// 3D Vector & Matrix3 helpers for IK solver
export const vAdd = (a: Vec3 | number[], b: Vec3 | number[]): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const vSub = (a: Vec3 | number[], b: Vec3 | number[]): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const vScale = (a: Vec3 | number[], s: number): Vec3 => [
  a[0] * s,
  a[1] * s,
  a[2] * s,
];
export const vDot = (a: Vec3 | number[], b: Vec3 | number[]): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vCross = (a: Vec3 | number[], b: Vec3 | number[]): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const vNorm = (v: Vec3 | number[]): Vec3 => {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 1e-9 ? [v[0] / len, v[1] / len, v[2] / len] : [v[0], v[1], v[2]];
};
export const vLen = (v: Vec3 | number[]): number => Math.hypot(v[0], v[1], v[2]);

export const mul3 = (a: number[], b: number[]): number[] => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
  a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
  a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
  a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
  a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
  a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
  a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];

export const transpose3 = (m: number[]): number[] => [
  m[0],
  m[3],
  m[6],
  m[1],
  m[4],
  m[7],
  m[2],
  m[5],
  m[8],
];

export const extractR3 = (m: Mat): number[] => [
  m[0],
  m[1],
  m[2],
  m[4],
  m[5],
  m[6],
  m[8],
  m[9],
  m[10],
];

export const mat4FromR3T = (r: number[], t: Vec3 | number[]): Mat => [
  r[0],
  r[1],
  r[2],
  t[0],
  r[3],
  r[4],
  r[5],
  t[1],
  r[6],
  r[7],
  r[8],
  t[2],
  0,
  0,
  0,
  1,
];

export function rotFromTo(a: Vec3 | number[], b: Vec3 | number[]): number[] {
  const na = vNorm(a),
    nb = vNorm(b);
  const v = vCross(na, nb);
  const c = vDot(na, nb);
  if (c > 0.999999) {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
  if (c < -0.999999) {
    let axis =
      Math.abs(na[0]) < 0.9 ? vCross(na, [1, 0, 0]) : vCross(na, [0, 1, 0]);
    axis = vNorm(axis);
    return [
      2 * axis[0] * axis[0] - 1,
      2 * axis[0] * axis[1],
      2 * axis[0] * axis[2],
      2 * axis[1] * axis[0],
      2 * axis[1] * axis[1] - 1,
      2 * axis[1] * axis[2],
      2 * axis[2] * axis[0],
      2 * axis[2] * axis[1],
      2 * axis[2] * axis[2] - 1,
    ];
  }
  const factor = 1 / (1 + c);
  const v0 = v[0],
    v1 = v[1],
    v2 = v[2];
  const vx2_00 = -v1 * v1 - v2 * v2,
    vx2_01 = v0 * v1,
    vx2_02 = v0 * v2;
  const vx2_10 = v0 * v1,
    vx2_11 = -v0 * v0 - v2 * v2,
    vx2_12 = v1 * v2;
  const vx2_20 = v0 * v2,
    vx2_21 = v1 * v2,
    vx2_22 = -v0 * v0 - v1 * v1;
  return [
    1 + vx2_00 * factor,
    -v2 + vx2_01 * factor,
    v1 + vx2_02 * factor,
    v2 + vx2_10 * factor,
    1 + vx2_11 * factor,
    -v0 + vx2_12 * factor,
    -v1 + vx2_20 * factor,
    v0 + vx2_21 * factor,
    1 + vx2_22 * factor,
  ];
}

export function quatFromMatrix3(m: number[]): [number, number, number, number] {
  const trace = m[0] + m[4] + m[8];
  let q: [number, number, number, number];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1.0) * 2;
    q = [0.25 * s, (m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s];
  } else {
    if (m[0] > m[4] && m[0] > m[8]) {
      const s = Math.sqrt(1.0 + m[0] - m[4] - m[8]) * 2;
      q = [(m[7] - m[5]) / s, 0.25 * s, (m[1] + m[3]) / s, (m[2] + m[6]) / s];
    } else if (m[4] > m[8]) {
      const s = Math.sqrt(1.0 + m[4] - m[0] - m[8]) * 2;
      q = [(m[2] - m[6]) / s, (m[1] + m[3]) / s, 0.25 * s, (m[5] + m[7]) / s];
    } else {
      const s = Math.sqrt(1.0 + m[8] - m[0] - m[4]) * 2;
      q = [(m[3] - m[1]) / s, (m[2] + m[6]) / s, (m[5] + m[7]) / s, 0.25 * s];
    }
  }
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  return len > 1e-9 ? [q[0] / len, q[1] / len, q[2] / len, q[3] / len] : [1, 0, 0, 0];
}

export function matrix3FromQuat(q: [number, number, number, number]): number[] {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  const [w, x, y, z] =
    len > 1e-9 ? [q[0] / len, q[1] / len, q[2] / len, q[3] / len] : [1, 0, 0, 0];
  return [
    1 - 2 * y * y - 2 * z * z,
    2 * x * y - 2 * z * w,
    2 * x * z + 2 * y * w,
    2 * x * y + 2 * z * w,
    1 - 2 * x * x - 2 * z * z,
    2 * y * z - 2 * x * w,
    2 * x * z - 2 * y * w,
    2 * y * z + 2 * x * w,
    1 - 2 * x * x - 2 * y * y,
  ];
}

export function slerpMatrix3(a: number[], b: number[], t: number): number[] {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const qa = quatFromMatrix3(a);
  let qb = quatFromMatrix3(b);
  let dot = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
  if (dot < 0) {
    qb = [-qb[0], -qb[1], -qb[2], -qb[3]];
    dot = -dot;
  }
  if (dot > 0.9995) {
    return matrix3FromQuat([
      qa[0] + t * (qb[0] - qa[0]),
      qa[1] + t * (qb[1] - qa[1]),
      qa[2] + t * (qb[2] - qa[2]),
      qa[3] + t * (qb[3] - qa[3]),
    ]);
  }
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const sinAngle = Math.sin(angle);
  const scaleA = Math.sin((1 - t) * angle) / sinAngle;
  const scaleB = Math.sin(t * angle) / sinAngle;
  return matrix3FromQuat([
    scaleA * qa[0] + scaleB * qb[0],
    scaleA * qa[1] + scaleB * qb[1],
    scaleA * qa[2] + scaleB * qb[2],
    scaleA * qa[3] + scaleB * qb[3],
  ]);
}

export function solveTwoBone(
  root: Vec3,
  target: Vec3,
  l1: number,
  l2: number,
  pole: Vec3
): [Vec3, Vec3] {
  const delta = vSub(target, root);
  const raw = vLen(delta);
  const dir = raw > 1e-9 ? vNorm(delta) : [0, -1, 0];
  const dist = Math.max(
    Math.abs(l1 - l2) + 1e-6,
    Math.min(l1 + l2 - 1e-6, raw)
  );
  const relPole = vSub(pole, root);
  let bend = vSub(relPole, vScale(dir, vDot(relPole, dir)));
  if (vLen(bend) < 1e-6) {
    bend = vCross(dir, [0, 0, 1]);
    if (vLen(bend) < 1e-6) {
      bend = vCross(dir, [1, 0, 0]);
    }
  }
  bend = vNorm(bend);
  const denom = Math.max(1e-9, 2 * l1 * dist);
  const cosAngle = (l1 * l1 + dist * dist - l2 * l2) / denom;
  const angle = Math.acos(Math.max(-1.0, Math.min(1.0, cosAngle)));
  const joint = vAdd(
    root,
    vScale(
      vAdd(vScale(dir, Math.cos(angle)), vScale(bend, Math.sin(angle))),
      l1
    )
  );
  const end = vAdd(root, vScale(dir, dist));
  return [joint as Vec3, end as Vec3];
}

export function reparent(
  d: ProjectDocument,
  name: string,
  parent: string | null
): ProjectDocument {
  validateProject(d);
  if (!d.rig.bones[name]) throw new ProjectError(`unknown bone '${name}'`);
  let cursor = parent;
  while (cursor) {
    if (cursor === name)
      throw new ProjectError('reparent would create a parent cycle');
    cursor = d.rig.bones[cursor]?.parent || null;
  }
  const world = pose(d),
    local = parent
      ? mul(inverseRigid(world[parent]), world[name])
      : world[name],
    out = structuredClone(d),
    b = out.rig.bones[name];
  if (parent) b.parent = parent;
  else delete b.parent;
  b.translation = [local[3], local[7], local[11]];
  b.rotation = eulerFrom(local);
  validateProject(out);
  return out;
}

const rows = (s: unknown, label: string): string[] => {
  if (typeof s !== 'string')
    throw new ProjectError(`${label} must be a multiline string`);
  const r = s.replace(/^\n|\n$/g, '').split('\n');
  if (!r.length || !r[0]) throw new ProjectError(`${label} cannot be empty`);
  if (r.some((x) => x.length !== r[0].length))
    throw new ProjectError(`${label} has ragged rows`);
  return r;
};

const vec = (v: unknown, l: string, n = 3): number[] => {
  if (
    !Array.isArray(v) ||
    v.length !== n ||
    v.some((x) => typeof x !== 'number' || !Number.isFinite(x))
  )
    throw new ProjectError(`${l} must be a ${n}-number list`);
  return v as number[];
};

function validateSpringConfig(spec: any, label: string) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new ProjectError(`${label} must be a mapping`);
  }
  const stiffness = Number(spec.stiffness ?? 100);
  const damping = Number(spec.damping ?? 10);
  const mass = Number(spec.mass ?? 1);
  const drag = Number(spec.drag ?? 0.1);
  if (
    isNaN(stiffness) ||
    isNaN(damping) ||
    isNaN(mass) ||
    isNaN(drag) ||
    stiffness < 0 ||
    damping < 0 ||
    mass <= 0 ||
    drag < 0
  ) {
    throw new ProjectError(
      `${label} parameters must be non-negative (mass > 0)`
    );
  }
  if (spec.gravity !== undefined) vec(spec.gravity, `${label}.gravity`, 3);
  if (spec.limit_angle !== undefined && spec.limit_angle !== null) {
    const lim = Number(spec.limit_angle);
    if (isNaN(lim) || lim < 0) {
      throw new ProjectError(
        `${label}.limit_angle must be a non-negative number`
      );
    }
  }
}

function validateKeys(
  track: any,
  label: string,
  frames: number,
  width: number
) {
  if (!Array.isArray(track) || !track.length) {
    throw new ProjectError(`${label} must be a non-empty keyframe list`);
  }
  let last = -1;
  for (const key of track) {
    if (
      !key ||
      typeof key !== 'object' ||
      Array.isArray(key) ||
      !('frame' in key) ||
      !('value' in key)
    ) {
      throw new ProjectError(`${label} keys require frame and value`);
    }
    const frame = key.frame;
    if (
      !Number.isInteger(frame) ||
      frame < 0 ||
      frame >= frames ||
      frame <= last
    ) {
      throw new ProjectError(
        `${label} frames must be unique, ascending integers in 0..${frames - 1}`
      );
    }
    last = frame;
    if (width === 1) {
      if (typeof key.value !== 'number' || !Number.isFinite(key.value)) {
        throw new ProjectError(`${label} values must be numbers`);
      }
    } else {
      vec(key.value, `${label}[${frame}].value`, width);
    }
    const interp = key.interpolation ?? 'linear';
    if (interp !== 'linear' && interp !== 'smooth' && interp !== 'step') {
      throw new ProjectError(
        `${label}[${frame}].interpolation must be linear, smooth, or step`
      );
    }
  }
}

export function validateProject(d: ProjectDocument): ProjectDocument {
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    throw new ProjectError('project root must be a mapping');
  }

  // 1. Palette
  if (
    !d.palette ||
    typeof d.palette !== 'object' ||
    Array.isArray(d.palette) ||
    !Object.keys(d.palette).length
  ) {
    throw new ProjectError('palette must be a non-empty mapping');
  }
  for (const [k, c] of Object.entries(d.palette)) {
    if (typeof k !== 'string' || k.length !== 1 || k === '.') {
      throw new ProjectError(
        "palette keys must be single characters other than '.'"
      );
    }
    color(c, `palette.${k}`);
  }

  // 2. Parts
  if (
    !d.parts ||
    typeof d.parts !== 'object' ||
    Array.isArray(d.parts) ||
    !Object.keys(d.parts).length
  ) {
    throw new ProjectError('parts must be a non-empty mapping');
  }
  for (const [n, p] of Object.entries(d.parts)) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      throw new ProjectError('every part must be a mapping');
    }
    const f = rows(p.front, `parts.${n}.front`),
      b = rows(p.back, `parts.${n}.back`),
      s = rows(p.side, `parts.${n}.side`);
    for (const [vn, g] of [
      ['front', f],
      ['back', b],
      ['side', s],
    ] as const) {
      g.forEach((r, y) =>
        [...r].forEach((ch, x) => {
          if (ch !== '.' && !d.palette[ch]) {
            throw new ProjectError(
              `parts.${n}.${vn} uses unknown palette character '${ch}' at row ${y + 1}, column ${x + 1}`
            );
          }
        })
      );
    }
    if (f.length !== b.length || f[0].length !== b[0].length) {
      throw new ProjectError(
        `parts.${n}: front and back views must have equal dimensions`
      );
    }
    if (f.length !== s.length) {
      throw new ProjectError(
        `parts.${n}: front, back, and side views must have equal heights`
      );
    }
    f.forEach((r, y) =>
      [...r].forEach((ch, x) => {
        if ((ch === '.') !== (b[y][x] === '.')) {
          throw new ProjectError(
            `parts.${n}: front/back silhouettes differ at row ${y + 1}, column ${x + 1}`
          );
        }
      })
    );

    // Voxel count validation
    const h = f.length,
      w = f[0].length,
      dLen = s[0].length;
    let voxelCount = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (f[y][x] === '.') continue;
        for (let z = 0; z < dLen; z++) {
          if (s[y][z] !== '.') voxelCount++;
        }
      }
    }
    if (voxelCount === 0) {
      throw new ProjectError(`parts.${n} produces no voxels`);
    }

    if (p.pivot !== undefined) vec(p.pivot, `parts.${n}.pivot`, 3);
  }

  // 3. Rig Bones
  if (
    !d.rig ||
    typeof d.rig !== 'object' ||
    Array.isArray(d.rig) ||
    !d.rig.bones ||
    typeof d.rig.bones !== 'object' ||
    Array.isArray(d.rig.bones) ||
    !Object.keys(d.rig.bones).length
  ) {
    throw new ProjectError('rig.bones must be a non-empty mapping');
  }
  const bones = d.rig.bones;
  for (const [name, spec] of Object.entries(bones)) {
    const label = `rig.bones.${name}`;
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new ProjectError(`${label} must be a mapping`);
    }
    if (
      spec.parent !== undefined &&
      spec.parent !== null &&
      typeof spec.parent !== 'string'
    ) {
      throw new ProjectError(`${label}.parent must be a bone name`);
    }
    if (
      spec.part !== undefined &&
      spec.part !== null &&
      !d.parts[spec.part]
    ) {
      throw new ProjectError(`${label} references missing part '${spec.part}'`);
    }
    if (spec.translation !== undefined)
      vec(spec.translation, `${label}.translation`, 3);
    if (spec.rotation !== undefined) vec(spec.rotation, `${label}.rotation`, 3);
    if (spec.attachment !== undefined) {
      if (
        !spec.attachment ||
        typeof spec.attachment !== 'object' ||
        Array.isArray(spec.attachment)
      ) {
        throw new ProjectError(`${label}.attachment must be a mapping`);
      }
      if (spec.attachment.translation !== undefined) {
        vec(
          spec.attachment.translation,
          `${label}.attachment.translation`,
          3
        );
      }
      if (spec.attachment.rotation !== undefined) {
        vec(spec.attachment.rotation, `${label}.attachment.rotation`, 3);
      }
    }
    if (spec.spring !== undefined) {
      validateSpringConfig(spec.spring, `${label}.spring`);
    }
  }

  // Cycle & parent existence check
  const visiting = new Set<string>(),
    done = new Set<string>();
  const visit = (n: string) => {
    if (visiting.has(n))
      throw new ProjectError(`rig has a parent cycle involving '${n}'`);
    if (done.has(n)) return;
    visiting.add(n);
    const b = bones[n];
    if (b.parent) {
      if (!bones[b.parent])
        throw new ProjectError(
          `bone '${n}' references missing parent '${b.parent}'`
        );
      visit(b.parent);
    }
    visiting.delete(n);
    done.add(n);
  };
  Object.keys(bones).forEach(visit);

  // 4. IK Chains
  const chains = d.rig.ik_chains || {};
  if (typeof chains !== 'object' || Array.isArray(chains)) {
    throw new ProjectError('rig.ik_chains must be a mapping');
  }
  for (const [name, spec] of Object.entries(chains)) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new ProjectError(`rig.ik_chains.${name} must be a mapping`);
    }
    const { root, mid, end } = spec;
    if (
      !root ||
      !mid ||
      !end ||
      !bones[root] ||
      !bones[mid] ||
      !bones[end]
    ) {
      throw new ProjectError(`IK chain '${name}' references a missing bone`);
    }
    if (bones[mid].parent !== root || bones[end].parent !== mid) {
      throw new ProjectError(
        `IK chain '${name}' must describe a direct root -> mid -> end hierarchy`
      );
    }
  }

  // 5. Spring Bones (Rig level)
  if (d.rig.spring_bones !== undefined) {
    if (
      !d.rig.spring_bones ||
      typeof d.rig.spring_bones !== 'object' ||
      Array.isArray(d.rig.spring_bones)
    ) {
      throw new ProjectError('rig.spring_bones must be a mapping');
    }
    for (const [name, spec] of Object.entries(d.rig.spring_bones)) {
      if (!bones[name])
        throw new ProjectError(
          `rig.spring_bones references missing bone '${name}'`
        );
      validateSpringConfig(spec, `rig.spring_bones.${name}`);
    }
  }

  // 6. Constraints
  if (d.rig.constraints !== undefined) {
    let cList = d.rig.constraints;
    if (typeof cList === 'object' && cList !== null && !Array.isArray(cList))
      cList = Object.values(cList);
    if (!Array.isArray(cList))
      throw new ProjectError('rig.constraints must be a list or mapping');
    cList.forEach((spec: any, idx: number) => {
      if (!spec || typeof spec !== 'object' || Array.isArray(spec))
        throw new ProjectError(`rig.constraints[${idx}] must be a mapping`);
      const cType = spec.type || spec.kind;
      const cName = spec.name || `constraint_${idx}`;
      if (cType === 'spline_spine' || cType === 'spline') {
        if (!Array.isArray(spec.bones) || !spec.bones.length) {
          throw new ProjectError(
            `constraint '${cName}' must have a non-empty bones list`
          );
        }
        for (const b of spec.bones) {
          if (!bones[b])
            throw new ProjectError(
              `constraint '${cName}' references missing bone '${b}'`
            );
        }
        if (
          spec.driver !== undefined &&
          spec.driver !== null &&
          !bones[spec.driver]
        ) {
          throw new ProjectError(
            `constraint '${cName}' references missing driver bone '${spec.driver}'`
          );
        }
        if (spec.total_rotation !== undefined)
          vec(spec.total_rotation, `constraint '${cName}'.total_rotation`, 3);
      } else if (cType === 'mirror') {
        if (!bones[spec.source] || !bones[spec.target]) {
          throw new ProjectError(
            `mirror constraint '${cName}' references missing source or target bone`
          );
        }
        const plane = String(spec.plane || 'yz').toLowerCase();
        if (!['yz', 'xz', 'xy', 'x', 'y', 'z'].includes(plane)) {
          throw new ProjectError(
            `mirror constraint '${cName}' invalid plane '${spec.plane}'`
          );
        }
      } else if (cType === 'copy_rotation' || cType === 'copy_rot') {
        if (!bones[spec.source] || !bones[spec.target]) {
          throw new ProjectError(
            `copy_rotation constraint '${cName}' references missing source or target bone`
          );
        }
      } else {
        throw new ProjectError(`unknown constraint type '${cType}'`);
      }
    });
  }

  // 7. Animations
  if (
    !d.animations ||
    typeof d.animations !== 'object' ||
    Array.isArray(d.animations) ||
    !Object.keys(d.animations).length
  ) {
    throw new ProjectError('animations must be a non-empty mapping');
  }
  for (const [name, clip] of Object.entries(d.animations)) {
    const label = `animations.${name}`;
    if (!clip || typeof clip !== 'object' || Array.isArray(clip)) {
      throw new ProjectError(`${label} must be a mapping`);
    }
    if (!Number.isInteger(clip.frames) || clip.frames < 1) {
      throw new ProjectError(`${label}.frames must be a positive integer`);
    }
    if (
      typeof clip.fps !== 'number' ||
      clip.fps <= 0 ||
      !Number.isFinite(clip.fps)
    ) {
      throw new ProjectError(`${label}.fps must be positive`);
    }
    const boneTracks = clip.bones ?? {};
    const ikTracks = clip.ik ?? {};
    if (
      typeof boneTracks !== 'object' ||
      Array.isArray(boneTracks) ||
      typeof ikTracks !== 'object' ||
      Array.isArray(ikTracks)
    ) {
      throw new ProjectError(`${label}.bones and .ik must be mappings`);
    }
    for (const [bName, tracks] of Object.entries(boneTracks)) {
      if (!bones[bName])
        throw new ProjectError(
          `${label}.bones references invalid bone '${bName}'`
        );
      if (!tracks || typeof tracks !== 'object' || Array.isArray(tracks)) {
        throw new ProjectError(`${label}.bones.${bName} must be a mapping`);
      }
      for (const [tName, track] of Object.entries(tracks)) {
        if (tName !== 'translation' && tName !== 'rotation') {
          throw new ProjectError(
            `${label}.bones.${bName}: unknown track '${tName}'`
          );
        }
        validateKeys(track, `${label}.bones.${bName}.${tName}`, clip.frames, 3);
      }
    }
    for (const [cName, tracks] of Object.entries(ikTracks)) {
      if (!chains[cName])
        throw new ProjectError(
          `${label}.ik references invalid chain '${cName}'`
        );
      if (!tracks || typeof tracks !== 'object' || Array.isArray(tracks)) {
        throw new ProjectError(`${label}.ik.${cName} must be a mapping`);
      }
      for (const [tName, track] of Object.entries(tracks)) {
        if (tName !== 'target' && tName !== 'pole' && tName !== 'weight') {
          throw new ProjectError(
            `${label}.ik.${cName}: unknown track '${tName}'`
          );
        }
        const width = tName === 'weight' ? 1 : 3;
        validateKeys(track, `${label}.ik.${cName}.${tName}`, clip.frames, width);
        if (tName === 'weight' && Array.isArray(track)) {
          if (
            track.some(
              (k: any) =>
                typeof k.value !== 'number' ||
                !Number.isFinite(k.value) ||
                k.value < 0 ||
                k.value > 1
            )
          ) {
            throw new ProjectError(
              `${label}.ik.${cName}.weight must stay within 0..1`
            );
          }
        }
      }
    }
    if (
      clip.procedural !== undefined &&
      (typeof clip.procedural !== 'object' ||
        Array.isArray(clip.procedural) ||
        clip.procedural === null)
    ) {
      throw new ProjectError(`${label}.procedural must be a mapping`);
    }
  }

  // 8. Export
  const ex = d.export || {};
  if (typeof ex !== 'object' || Array.isArray(ex)) {
    throw new ProjectError('export must be a mapping');
  }
  if (ex.size !== undefined) {
    if (
      !Array.isArray(ex.size) ||
      ex.size.length !== 2 ||
      !ex.size.every((v) => Number.isInteger(v))
    ) {
      throw new ProjectError('export.size must be a two-integer list');
    }
    if (ex.size[0] < 1 || ex.size[1] < 1) {
      throw new ProjectError('export size and scale must be positive integers');
    }
  }
  if (ex.scale !== undefined && (!Number.isInteger(ex.scale) || ex.scale < 1)) {
    throw new ProjectError('export size and scale must be positive integers');
  }
  if (ex.origin !== undefined) vec(ex.origin, 'export.origin', 2);
  if (ex.directions !== undefined) {
    if (
      !Array.isArray(ex.directions) ||
      !ex.directions.length ||
      ex.directions.some((x) => typeof x !== 'number' || !Number.isFinite(x))
    ) {
      throw new ProjectError('export.directions must be a non-empty number list');
    }
  }
  const an = ex.animations || Object.keys(d.animations);
  if (
    !Array.isArray(an) ||
    !an.length ||
    an.some((x) => typeof x !== 'string')
  ) {
    throw new ProjectError(
      'export.animations must be a non-empty animation-name list'
    );
  }
  if (new Set(an).size !== an.length) {
    throw new ProjectError('export.animations must not contain duplicates');
  }
  an.forEach((n) => {
    if (!d.animations[n])
      throw new ProjectError(
        `export.animations references missing animation '${n}'`
      );
  });
  if (ex.background !== undefined) color(ex.background, 'export.background');

  return d;
}

export function color(
  v: Color,
  label = 'color'
): [number, number, number, number] {
  if (typeof v === 'string') {
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v))
      throw new ProjectError(
        `${label} must be #RRGGBB, #RRGGBBAA, or an RGB(A) list`
      );
    const a = [1, 3, 5, 7]
      .filter((i) => i < v.length)
      .map((i) => parseInt(v.slice(i, i + 2), 16));
    return [a[0], a[1], a[2], a[3] ?? 255];
  }
  if (
    !Array.isArray(v) ||
    ![3, 4].includes(v.length) ||
    v.some((x) => !Number.isInteger(x) || x < 0 || x > 255)
  )
    throw new ProjectError(`${label} channels must be integers from 0 to 255`);
  return [v[0], v[1], v[2], v[3] ?? 255];
}

const sample = (
  ks: Key<any>[] | undefined,
  f: number,
  loop: boolean,
  frames: number
) => {
  if (!ks?.length) return null;
  const exact = ks.find((k) => k.frame === f);
  if (exact) return exact.value;
  let l = [...ks].reverse().find((k) => k.frame < f),
    r = ks.find((k) => k.frame > f),
    pos = f;
  if (!l || !r) {
    if (!loop || ks.length < 2) return (l || r)!.value;
    if (l) r = { ...ks[0], frame: ks[0].frame + frames };
    else {
      l = { ...ks.at(-1)!, frame: ks.at(-1)!.frame - frames };
      r = ks[0];
    }
  }
  if (l!.interpolation === 'step') return l!.value;
  let t = (pos - l!.frame) / (r!.frame - l!.frame);
  if (l!.interpolation === 'smooth') t = t * t * (3 - 2 * t);
  const a = l!.value,
    b = r!.value;
  return Array.isArray(a)
    ? a.map((x: number, i: number) => x * (1 - t) + b[i] * t)
    : a * (1 - t) + b * t;
};

export function pose(
  d: ProjectDocument,
  clipName?: string,
  frame = 0,
  mutedTracks?: Set<string>
): Record<string, Mat> {
  validateProject(d);
  const clip = clipName ? d.animations[clipName] : undefined;
  const loop = clip?.loop !== false;
  const frames = clip?.frames || 0;

  const bones = d.rig.bones;
  const boneNames = Object.keys(bones);

  const localR: Record<string, number[]> = {};
  const localT: Record<string, Vec3> = {};

  for (const n of boneNames) {
    const b = bones[n];
    const tr = clip?.bones?.[n];
    const isMutedT = mutedTracks?.has(`${n}.translation`) || mutedTracks?.has(n);
    const isMutedR = mutedTracks?.has(`${n}.rotation`) || mutedTracks?.has(n);
    const tSample = isMutedT ? null : (sample(tr?.translation, frame, loop, frames) as Vec3 | null);
    const rSample = isMutedR ? null : (sample(tr?.rotation, frame, loop, frames) as Vec3 | null);
    const bt = b.translation || [0, 0, 0];
    const br = b.rotation || [0, 0, 0];
    const trans: Vec3 = [
      bt[0] + (tSample?.[0] || 0),
      bt[1] + (tSample?.[1] || 0),
      bt[2] + (tSample?.[2] || 0),
    ];
    const rotEuler: Vec3 = [
      (br[0] || 0) + (rSample?.[0] || 0),
      (br[1] || 0) + (rSample?.[1] || 0),
      (br[2] || 0) + (rSample?.[2] || 0),
    ];

    localT[n] = trans;
    localR[n] = extractR3(euler(rotEuler));
  }

  const computeWorld = (): Record<string, Mat> => {
    const world: Record<string, Mat> = {};
    const pending = new Set(boneNames);
    while (pending.size) {
      for (const n of [...pending]) {
        const b = bones[n];
        if (b.parent && !world[b.parent]) continue;
        const localMat = mat4FromR3T(localR[n], localT[n]);
        world[n] = b.parent ? mul(world[b.parent], localMat) : localMat;
        pending.delete(n);
      }
    }
    return world;
  };

  let world = computeWorld();

  if (clip?.ik && d.rig.ik_chains) {
    for (const [chainName, tracks] of Object.entries(clip.ik)) {
      const chain = d.rig.ik_chains[chainName];
      if (!chain || !tracks) continue;
      if (mutedTracks?.has(chainName) || mutedTracks?.has(`${chainName}.target`)) continue;
      const isMutedPole = mutedTracks?.has(`${chainName}.pole`);
      const isMutedWeight = mutedTracks?.has(`${chainName}.weight`);
      const weightSample = isMutedWeight ? null : sample(tracks.weight, frame, loop, frames);
      const weight = typeof weightSample === 'number' ? weightSample : 1.0;
      const target = sample(tracks.target, frame, loop, frames) as Vec3 | null;
      if (!target || weight <= 0) continue;
      const poleSample = isMutedPole ? null : (sample(tracks.pole, frame, loop, frames) as Vec3 | null);
      const pole: Vec3 = poleSample || [0, 0, 1];

      const rootMat = world[chain.root];
      const midMat = world[chain.mid];
      const endMat = world[chain.end];
      if (!rootMat || !midMat || !endMat) continue;

      const rootP: Vec3 = [rootMat[3], rootMat[7], rootMat[11]];
      const midP: Vec3 = [midMat[3], midMat[7], midMat[11]];
      const endP: Vec3 = [endMat[3], endMat[7], endMat[11]];

      const l1 = vLen(vSub(midP, rootP));
      const l2 = vLen(vSub(endP, midP));

      const [joint, endSolved] = solveTwoBone(rootP, target, l1, l2, pole);

      const origRootR = [...localR[chain.root]];
      const origMidR = [...localR[chain.mid]];

      // Step 1: Rotate root bone
      const deltaRootR = rotFromTo(vSub(midP, rootP), vSub(joint, rootP));
      const rootWorldR = mul3(deltaRootR, extractR3(world[chain.root]));
      const rootParent = bones[chain.root]?.parent;
      const parentR =
        rootParent && world[rootParent]
          ? extractR3(world[rootParent])
          : [1, 0, 0, 0, 1, 0, 0, 0, 1];
      const solvedRootR = mul3(transpose3(parentR), rootWorldR);
      localR[chain.root] = solvedRootR;
      world = computeWorld();

      // Step 2: Rotate mid bone
      const midMat2 = world[chain.mid];
      const endMat2 = world[chain.end];
      const midP2: Vec3 = [midMat2[3], midMat2[7], midMat2[11]];
      const endP2: Vec3 = [endMat2[3], endMat2[7], endMat2[11]];

      const deltaMidR = rotFromTo(vSub(endP2, midP2), vSub(endSolved, midP2));
      const midWorldR = mul3(deltaMidR, extractR3(world[chain.mid]));
      const solvedMidR = mul3(
        transpose3(extractR3(world[chain.root])),
        midWorldR
      );

      // Blend with weight via SLERP
      localR[chain.root] = slerpMatrix3(origRootR, solvedRootR, weight);
      localR[chain.mid] = slerpMatrix3(origMidR, solvedMidR, weight);
      world = computeWorld();
    }
  }

  return world;
}

function voxels(d: ProjectDocument, p: string) {
  const q = d.parts[p],
    f = rows(q.front, ''),
    b = rows(q.back, ''),
    s = rows(q.side, ''),
    h = f.length,
    w = f[0].length,
    zs = s[0].length,
    piv = q.pivot || ([(w - 1) / 2, 0, (zs - 1) / 2] as Vec3),
    res: any[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (f[y][x] !== '.')
        for (let z = 0; z < zs; z++)
          if (s[y][z] !== '.') {
            const rx = x - (w - 1) / 2,
              rz = z - (zs - 1) / 2,
              ch =
                Math.abs(rz / Math.max((zs - 1) / 2, 0.5)) >=
                Math.abs(rx / Math.max((w - 1) / 2, 0.5))
                  ? rz >= 0
                    ? f[y][x]
                    : b[y][x]
                  : s[y][z];
            const colorKey =
              ch !== '.' && d.palette[ch]
                ? ch
                : f[y][x] !== '.' && d.palette[f[y][x]]
                ? f[y][x]
                : Object.keys(d.palette)[0];
            res.push({
              p: [x - piv[0], h - 1 - y - piv[1], z - piv[2]],
              c: color(d.palette[colorKey]),
              n: [rx, h - 1 - y - (h - 1) / 2, rz],
            });
          }
  return res;
}

export function render(
  d: ProjectDocument,
  clip?: string,
  frame = 0,
  yaw = 0,
  part?: string,
  size?: number,
  mutedTracks?: Set<string>
): HTMLCanvasElement {
  const ex = d.export || {},
    w = size || ex.size?.[0] || 96,
    h = size || ex.size?.[1] || 96,
    scale = size
      ? Math.max(1, Math.min(16, Math.floor((size - 40) / 8)))
      : ex.scale || 3,
    origin = size ? [w / 2, h / 2] : ex.origin || [w / 2, h - 8],
    canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  const bg = color(ex.background || [0, 0, 0, 0]);
  if (bg[3] > 0) {
    ctx.fillStyle = `rgba(${bg[0]},${bg[1]},${bg[2]},${bg[3] / 255})`;
    ctx.fillRect(0, 0, w, h);
  }
  const ps = pose(d, clip, frame, mutedTracks),
    all: any[] = [];
  const yawR = (yaw * Math.PI) / 180,
    c = Math.cos(yawR),
    s = Math.sin(yawR);
  const targetBones = Object.entries(d.rig.bones);
  if (part && !targetBones.some(([, b]) => b.part === part) && d.parts[part]) {
    for (const v of voxels(d, part)) {
      const p = v.p,
        x = c * p[0] + s * p[2],
        z = -s * p[0] + c * p[2];
      all.push({
        x: origin[0] + x * scale,
        y: origin[1] - p[1] * scale,
        z,
        c: v.c,
      });
    }
  } else {
    for (const [bn, b] of targetBones) {
      if (part && b.part !== part) continue;
      if (!b.part) continue;
      const at = mul(
        ps[bn],
        transform(b.attachment?.rotation, b.attachment?.translation)
      );
      for (const v of voxels(d, b.part)) {
        const p = mv(at, v.p),
          x = c * p[0] + s * p[2],
          z = -s * p[0] + c * p[2];
        all.push({
          x: origin[0] + x * scale,
          y: origin[1] - p[1] * scale,
          z,
          c: v.c,
        });
      }
    }
  }
  all.sort((a, b) => a.z - b.z);
  for (const v of all) {
    const x0 = Math.floor(v.x - scale / 2),
      y0 = Math.floor(v.y - scale / 2);
    ctx.fillStyle = `rgba(${v.c[0]},${v.c[1]},${v.c[2]},${v.c[3] / 255})`;
    ctx.fillRect(x0, y0, scale, scale);
  }
  return canvas;
}

export function overlay(
  d: ProjectDocument,
  clipName: string | undefined,
  frame: number,
  yaw: number,
  mutedTracks?: Set<string>
) {
  const p = pose(d, clipName, frame, mutedTracks),
    ex = d.export || {},
    o = ex.origin || [48, 88],
    sc = ex.scale || 3,
    a = (yaw * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);

  const bones = Object.keys(d.rig.bones).map((n) => {
    const m = p[n],
      x = c * m[3] + s * m[11],
      z = -s * m[3] + c * m[11];
    return {
      name: n,
      parent: d.rig.bones[n].parent || null,
      x: o[0] + x * sc,
      y: o[1] - m[7] * sc,
      depth: z,
    };
  });

  const chains: any[] = [];
  const colors = ['#ff6b6b', '#63d7ff', '#d58cff', '#ffd166', '#70e000'];
  const clip = clipName ? d.animations[clipName] : undefined;

  if (d.rig.ik_chains) {
    let index = 0;
    for (const [name, chain] of Object.entries(d.rig.ik_chains)) {
      const item: any = {
        name,
        root: chain.root,
        mid: chain.mid,
        end: chain.end,
        color: colors[index % colors.length],
      };
      if (clip?.ik?.[name]) {
        const tracks = clip.ik[name];
        for (const kind of ['target', 'pole'] as const) {
          const val = sample(
            tracks[kind],
            frame,
            clip.loop !== false,
            clip.frames
          ) as Vec3 | null;
          if (val) {
            const x = c * val[0] + s * val[2];
            const z = -s * val[0] + c * val[2];
            item[kind] = {
              x: o[0] + x * sc,
              y: o[1] - val[1] * sc,
              depth: z,
            };
          }
        }
      }
      chains.push(item);
      index++;
    }
  }

  return {
    width: ex.size?.[0] || 96,
    height: ex.size?.[1] || 96,
    bones,
    chains,
  };
}

export function metadata(d: ProjectDocument) {
  const ex = d.export || {},
    names = ex.animations || Object.keys(d.animations),
    dirs = ex.directions || [0, 45, 90, 135, 180, 225, 270, 315],
    w = ex.size?.[0] || 96,
    h = ex.size?.[1] || 96,
    cols = Math.max(...names.map((n) => d.animations[n].frames));
  let row = 0;
  const animations: any = {};
  for (const n of names) {
    const c = d.animations[n],
      cm: any = {
        fps: c.fps,
        frame_duration_ms: 1000 / c.fps,
        loop: c.loop !== false,
        directions: [],
      };
    for (const angle of dirs) {
      cm.directions.push({
        angle,
        frames: Array.from({ length: c.frames }, (_, i) => ({
          index: i,
          rect: { x: i * w, y: row * h, w, h },
          pivot: {
            x: i * w + (ex.origin?.[0] || w / 2),
            y: row * h + (ex.origin?.[1] || h - 8),
          },
        })),
      });
      row++;
    }
    animations[n] = cm;
  }
  return {
    image: `${ex.name || 'sprite'}.png`,
    size: { w: cols * w, h: row * h },
    frame_size: { w, h },
    coordinate_system: {
      atlas_origin: 'top-left',
      world: '+X right, +Y up, +Z forward',
    },
    animations,
  };
}
