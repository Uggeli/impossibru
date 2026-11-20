import { euler, eulerFrom, I, inverseRigid, mul, mv, pose, ProjectError, sample, vSub } from './engine';
import type { Key, ProjectDocument, Vec2, Vec3 } from './types';

interface Drag {
  kind: 'rotate' | 'joint' | 'target' | 'pole';
  name: string;
  screen: Vec2;
  start?: Vec2;
  depth: number;
  direction: number;
  mode?: 'rest' | 'animate';
  clip: string;
  frame: number;
}

function setKey(keys: Key<Vec3>[], frame: number, value: Vec3) {
  const existing = keys.find(key => key.frame === frame);
  if (existing) existing.value = value;
  else {
    keys.push({ frame, value, interpolation: 'linear' });
    keys.sort((a, b) => a.frame - b.frame);
  }
}

export function applyRigDrag(doc: ProjectDocument, drag: Drag) {
  let { kind, name, start } = drag;
  const { screen, frame, direction, depth } = drag;
  const clip = drag.mode === 'rest' ? undefined : doc.animations[drag.clip];
  if (drag.mode === 'animate' && !clip) throw new ProjectError('Unknown animation');
  if (clip && (!Number.isInteger(frame) || frame < 0 || frame >= clip.frames)) throw new ProjectError('Invalid animation frame');

  const ex = doc.export, scale = ex?.scale || 3;
  const origin = ex?.origin || [(ex?.size?.[0] || 96) / 2, (ex?.size?.[1] || 96) - 8];
  const camera = euler([0, direction, 0]);
  const world = mv(inverseRigid(camera), [(screen[0] - origin[0]) / scale, (origin[1] - screen[1]) / scale, depth]) as Vec3;
  const transforms = pose(doc, clip ? drag.clip : undefined, frame);
  function project(name: string): Vec2 {
    const m = transforms[name];
    const [x, y] = mv(camera, [m[3], m[7], m[11]]);
    return [origin[0] + scale * x, origin[1] - scale * y];
  }

  let bone = doc.rig.bones[name];
  if (kind === 'joint' && clip && bone?.parent) {
    for (const [id, chain] of Object.entries(doc.rig.ik_chains || {})) {
      const tracks = clip.ik?.[id];
      const weight = sample(tracks?.weight, frame, clip.loop !== false, clip.frames) ?? 1;
      if (weight <= 0) continue;
      if (chain.end === name) {
        kind = 'target';
        name = id;
        break;
      }
      if (tracks?.target?.length && [chain.root, chain.mid].includes(bone.parent)) {
        throw new ProjectError(`drag the target of IK chain '${id}'`);
      }
    }
    if (kind === 'joint') {
      start = project(name);
      name = bone.parent;
      bone = doc.rig.bones[name];
      kind = 'rotate';
    }
  }
  if (kind === 'target' || kind === 'pole') {
    if (!clip || !doc.rig.ik_chains?.[name]) throw new ProjectError('IK handles require a clip and chain');
    const tracks = (clip.ik ??= {})[name] ??= {};
    setKey(tracks[kind] ??= [], frame, world);
    return;
  }

  if (!bone) throw new ProjectError(`unknown bone '${name}'`);
  const parent = bone.parent ? transforms[bone.parent] : I();
  let track: 'rotation' | 'translation', value: Vec3;
  if (kind === 'rotate') {
    if (!start) throw new ProjectError('Rotation requires a starting screen point');
    const [px, py] = project(name);
    const ax = start[0] - px, ay = py - start[1], bx = screen[0] - px, by = py - screen[1];
    if (Math.min(Math.hypot(ax, ay), Math.hypot(bx, by)) < 1e-7) return;
    const angle = Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * 180 / Math.PI;
    const delta = mul(mul(inverseRigid(camera), euler([0, 0, angle])), camera);
    const local = mul(mul(inverseRigid(parent), delta), transforms[name]);
    value = eulerFrom(clip ? mul(inverseRigid(euler(bone.rotation || [0, 0, 0])), local) : local);
    track = 'rotation';
  } else if (kind === 'joint') {
    value = mv(inverseRigid(parent), world) as Vec3;
    if (clip) value = vSub(value, bone.translation || [0, 0, 0]);
    track = 'translation';
  } else {
    throw new ProjectError('Unknown rig drag kind');
  }
  if (clip) {
    const tracks = (clip.bones ??= {})[name] ??= {};
    setKey(tracks[track] ??= [], frame, value);
  } else bone[track] = value;
}
