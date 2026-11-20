import { ProjectError } from './engine';
import type { GridPartSpec, PartSpec } from './types';

/** Index is x + z*w + y*w*d; '.' is empty. y counts bottom-up. */
export interface VoxelGrid { w: number; h: number; d: number; cells: string[] }

export function isGridPart(p: PartSpec): p is GridPartSpec {
  return !!p && typeof p === 'object' && 'voxels' in p;
}

export function decodeGrid(p: GridPartSpec, label: string, palette: Record<string, unknown>): VoxelGrid {
  const size = p.size as unknown;
  if (!Array.isArray(size) || size.length !== 3 || size.some(v => !Number.isInteger(v) || v < 1)) {
    throw new ProjectError(`parts.${label}.size must be three positive integers`);
  }
  const [w, h, d] = size as number[];
  if (typeof p.voxels !== 'string') throw new ProjectError(`parts.${label}.voxels must be a string`);
  const runs: [string, number][] = [];
  let total = 0;
  for (const m of p.voxels.matchAll(/(\d*)(\D)/g)) {
    const ch = m[2];
    if (ch !== '.' && !Object.prototype.hasOwnProperty.call(palette, ch)) {
      throw new ProjectError(`parts.${label}.voxels uses unknown palette character '${ch}'`);
    }
    const n = m[1] ? parseInt(m[1], 10) : 1;
    runs.push([ch, n]);
    total += n;
  }
  if (total !== w * h * d) {
    throw new ProjectError(`parts.${label}.voxels has ${total} cells, size needs ${w * h * d}`);
  }
  const cells = runs.flatMap(([ch, n]) => new Array<string>(n).fill(ch));
  if (!cells.some(c => c !== '.')) throw new ProjectError(`parts.${label} produces no voxels`);
  return { w, h, d, cells };
}

export function encodeGrid(g: VoxelGrid): string {
  let out = '';
  for (let i = 0; i < g.cells.length;) {
    let j = i;
    while (j < g.cells.length && g.cells[j] === g.cells[i]) j++;
    out += (j - i > 1 ? String(j - i) : '') + g.cells[i];
    i = j;
  }
  return out;
}

export function getSlice(g: VoxelGrid, y: number): string[] {
  const rows: string[] = [];
  for (let z = 0; z < g.d; z++) {
    const o = z * g.w + y * g.w * g.d;
    rows.push(g.cells.slice(o, o + g.w).join(''));
  }
  return rows;
}

export function setSlice(g: VoxelGrid, y: number, rows: string[]): VoxelGrid {
  const cells = g.cells.slice();
  for (let z = 0; z < g.d; z++) {
    for (let x = 0; x < g.w; x++) cells[x + z * g.w + y * g.w * g.d] = rows[z][x];
  }
  return { ...g, cells };
}

export function resizeGrid3(g: VoxelGrid, w: number, h: number, d: number): VoxelGrid {
  const cells = new Array<string>(w * h * d).fill('.');
  const ox = Math.floor((w - g.w) / 2), oz = Math.floor((d - g.d) / 2);
  for (let y = 0; y < g.h; y++) for (let z = 0; z < g.d; z++) for (let x = 0; x < g.w; x++) {
    const nx = x + ox, nz = z + oz;
    if (nx < 0 || nx >= w || nz < 0 || nz >= d || y >= h) continue;
    cells[nx + nz * w + y * w * d] = g.cells[x + z * g.w + y * g.w * g.d];
  }
  return { w, h, d, cells };
}

export function replaceChar(g: VoxelGrid, from: string, to: string): VoxelGrid {
  return { ...g, cells: g.cells.map(c => (c === from ? to : c)) };
}

/** True when the palette char appears in any drawn view or grid cell of the part. */
export function usesChar(spec: PartSpec, ch: string): boolean {
  const s = spec as Record<string, any>;
  if (typeof s.voxels === 'string' && /\d*\D/.test(s.voxels)) {
    for (const m of s.voxels.matchAll(/\d*(\D)/g)) if (m[1] === ch) return true;
  }
  return ['front', 'back', 'side', 'left', 'right'].some(v => typeof s[v] === 'string' && s[v].includes(ch));
}

/** Lenient decode for editing: no palette or emptiness checks (a slice may be erased to nothing). */
export function gridFromSpec(p: GridPartSpec): VoxelGrid {
  const [w, h, d] = p.size as number[];
  const cells: string[] = [];
  const max = w * h * d;
  outer: for (const m of p.voxels.matchAll(/(\d*)(\D)/g)) {
    for (let n = m[1] ? parseInt(m[1], 10) : 1; n > 0; n--) {
      if (cells.length >= max) break outer;
      cells.push(m[2]);
    }
  }
  while (cells.length < w * h * d) cells.push('.');
  cells.length = w * h * d;
  return { w, h, d, cells };
}

/** Replace a palette char everywhere in a part (mutates), keeping grid encoding canonical. */
export function replaceCharInPart(spec: PartSpec, from: string, to: string): void {
  if (!from || !to || from === to) return;
  const s = spec as Record<string, any>;
  for (const v of ['front', 'back', 'side', 'left', 'right']) {
    if (typeof s[v] === 'string') s[v] = s[v].split(from).join(to);
  }
  if (isGridPart(spec)) spec.voxels = encodeGrid(replaceChar(gridFromSpec(spec), from, to));
}
