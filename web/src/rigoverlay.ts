import type { ArtworkRuns } from './engine';

export interface Joint { name: string; parent: string | null; x: number; y: number; depth: number }
type Point = Pick<Joint, 'x' | 'y' | 'depth'>;
export interface Chain {
  name: string; root: string; mid: string; end: string; color: string;
  weight?: number; target?: Point; pole?: Point;
}
export interface RigOverlay {
  width: number; height: number; offset?: number[]; bones: Joint[]; chains: Chain[]; artwork: ArtworkRuns;
}
export type PoseTool = 'select' | 'move' | 'rotate';
export interface PoseControl {
  kind: 'joint' | 'rotate' | 'target' | 'pole' | 'select';
  name: string;
  point: Point;
  bone?: string;
  axis?: 'x' | 'y';
}

export function boneControl(bone: Joint, joints: Map<string, Joint>, chains: Chain[],
                            animate: boolean, tool: PoseTool, dot = false): PoseControl {
  if (!animate) {
    const kind = tool === 'move' ? 'joint' : tool === 'rotate' ? 'rotate' : 'select';
    return { kind, name: bone.name, point: bone, bone: bone.name };
  }
  const pivot = dot && bone.parent ? joints.get(bone.parent)! : bone;
  const chain = chains.find(c => (c.weight ?? 1) > 0 && (
    (c.target && [c.root, c.mid, c.end].includes(pivot.name)) || (dot && c.end === bone.name)));
  if (chain) return { kind: 'target', name: chain.name, point: chain.target || bone, bone: bone.name };
  if (!bone.parent && tool !== 'rotate') return { kind: 'joint', name: bone.name, point: bone, bone: bone.name };
  return { kind: 'rotate', name: pivot.name, point: pivot, bone: bone.name };
}

function shape<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, String(value));
  return el;
}

// Each run contributes two vertical edges. Shared horizontal edges cancel between adjacent rows.
function outline(runs: ArtworkRuns[string]) {
  const path: string[] = [], rows = new Map<number, number[]>();
  for (const [y, a, b] of runs) {
    path.push(`M${a} ${y}v1M${b} ${y}v1`);
    for (const edge of [y, y + 1]) {
      if (!rows.has(edge)) rows.set(edge, []);
      rows.get(edge)!.push(a, b);
    }
  }
  for (const [y, edges] of rows) {
    edges.sort((a, b) => a - b);
    for (let i = 0; i < edges.length; i += 2) {
      if (edges[i] !== edges[i + 1]) path.push(`M${edges[i]} ${y}H${edges[i + 1]}`);
    }
  }
  return path.join('');
}

export function renderOverlay(svg: SVGSVGElement, g: RigOverlay, animate: boolean, tool: PoseTool,
                              selected: string, chainName: string | null, track: string,
                              begin: (event: PointerEvent, action: PoseControl) => void,
                              select: (action: PoseControl) => void) {
  svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);
  svg.replaceChildren();
  const joints = new Map(g.bones.map(b => [b.name, b]));
  const control = (b: Joint, dot = false) => boneControl(b, joints, g.chains, animate, tool, dot);
  const bind = (el: SVGElement, action: PoseControl) => { el.onpointerdown = e => begin(e, action); };
  for (const [name, runs] of Object.entries(g.artwork)) {
    const d = runs.map(([y, a, b]) => `M${a} ${y}H${b}v1H${a}Z`).join('');
    const art = shape('path', { d, 'data-bone': name, class: 'rig-artwork' });
    bind(art, control(joints.get(name)!));
    svg.append(art);
    if (name === selected) svg.append(shape('path', { d: outline(runs), class: 'rig-outline' }));
  }
  for (const b of g.bones) {
    if (!b.parent) continue;
    const p = joints.get(b.parent)!;
    const chain = g.chains.find(c => c.mid === b.name || c.end === b.name);
    const line = shape('line', { x1: p.x, y1: p.y, x2: b.x, y2: b.y, class: chain ? 'rig-link chain' : 'rig-link' });
    if (chain) line.style.stroke = chain.color;
    svg.append(line);
  }
  let gizmo = joints.has(selected) ? control(joints.get(selected)!) : undefined;
  const selectedChain = g.chains.find(c => c.name === chainName);
  if (selectedChain) {
    const kind = track === 'pole' ? 'pole' : 'target';
    const point = selectedChain[kind];
    if (point) gizmo = { kind, point, name: selectedChain.name, bone: selected };
  }
  const gizmos = shape('g', { class: 'rig-gizmo' });
  if (gizmo && gizmo.kind !== 'select') {
    const { x, y } = gizmo.point;
    if (gizmo.kind === 'rotate') {
      const ring = shape('circle', { cx: x, cy: y, r: 6, class: 'rig-ring', 'aria-label': 'Rotate ' + gizmo.name });
      bind(ring, gizmo);
      gizmos.append(ring);
    } else {
      for (const axis of ['x', 'y'] as const) {
        const arrow = shape('path', {
          d: axis === 'x' ? 'M2 0H10m-3 -2 3 2-3 2' : 'M0 -2V-10m-2 3 2-3 2 3',
          transform: `translate(${x} ${y})`, class: 'rig-arrow ' + axis, 'aria-label': 'Move along ' + axis,
        });
        bind(arrow, { ...gizmo, axis });
        gizmos.append(arrow);
      }
    }
  }
  // Paint nearer dots last so coincident joints can be grabbed from their visible side.
  for (const b of [...g.bones].sort((a, b) => a.depth - b.depth)) {
    const active = selected === b.name;
    const dot = shape('circle', { cx: b.x, cy: b.y, r: active ? 2.3 : 1.7,
      class: 'rig-joint' + (active ? ' selected' : ''), tabindex: 0, role: 'button', 'aria-label': b.name });
    const label = shape('text', { x: b.x + 2.5, y: b.y - 2, class: 'rig-label' + (active ? ' selected' : '') });
    label.textContent = b.name;
    bind(dot, control(b, true));
    dot.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        select(control(b));
      }
    };
    dot.onfocus = () => label.classList.add('focused');
    dot.onblur = () => label.classList.remove('focused');
    svg.append(dot, label);
  }
  for (const c of g.chains) {
    for (const kind of ['target', 'pole'] as const) {
      const h = c[kind];
      if (!h) continue;
      const active = gizmo?.name === c.name && gizmo.kind === kind;
      const handle = shape('circle', { cx: h.x, cy: h.y, r: kind === 'target' ? 2.5 : 2, fill: c.color,
        class: 'rig-handle' + (active ? ' selected' : ''), 'aria-label': c.name + ' ' + kind });
      bind(handle, { kind, point: h, name: c.name, bone: c.end });
      svg.append(handle);
    }
  }
  svg.append(gizmos);
}
