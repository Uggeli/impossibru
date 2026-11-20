import { describe, expect, test } from 'vitest';
import yaml from 'js-yaml';
import qio from '../../examples/qio.yaml?raw';
import { decodeGrid, encodeGrid, getSlice, setSlice, resizeGrid3, isGridPart } from './voxelgrid';
import type { GridPartSpec, ProjectDocument } from './types';

describe('voxelgrid', () => {
  test('round-trips every qio part', () => {
    const doc = yaml.load(qio) as ProjectDocument;
    const parts = Object.entries(doc.parts);
    expect(parts.length).toBeGreaterThan(0);
    for (const [name, p] of parts) {
      expect(isGridPart(p)).toBe(true);
      const spec = p as GridPartSpec;
      expect(encodeGrid(decodeGrid(spec, name, doc.palette))).toBe(spec.voxels);
    }
  });
  test('decode order is x, then z, then y', () => {
    const g = decodeGrid({ size: [2, 2, 2], voxels: 'ab6.' }, 'p', { a: '#000', b: '#fff' });
    expect(g.cells[0]).toBe('a'); expect(g.cells[1]).toBe('b');
    expect(getSlice(g, 0)).toEqual(['ab', '..']); expect(getSlice(g, 1)).toEqual(['..', '..']);
  });
  test('cell count mismatch', () => expect(() => decodeGrid({ size: [2, 2, 2], voxels: '7a' }, 'p', { a: '#000' }))
    .toThrow('parts.p.voxels has 7 cells, size needs 8'));
  test('other decode errors', () => {
    const pal = { a: '#000' };
    expect(() => decodeGrid({ size: [2, 0, 2], voxels: 'a' } as any, 'p', pal)).toThrow('parts.p.size must be three positive integers');
    expect(() => decodeGrid({ size: [1, 1, 1], voxels: 5 } as any, 'p', pal)).toThrow('parts.p.voxels must be a string');
    expect(() => decodeGrid({ size: [1, 1, 1], voxels: 'z' }, 'p', pal)).toThrow("parts.p.voxels uses unknown palette character 'z'");
    expect(() => decodeGrid({ size: [1, 1, 2], voxels: '2.' }, 'p', pal)).toThrow('parts.p produces no voxels');
  });
  test('encode writes count only when > 1', () => expect(encodeGrid({ w: 3, h: 1, d: 1, cells: ['a', 'a', 'b'] })).toBe('2ab'));
  test('resizeGrid3 centres x/z, anchors y', () => {
    const r = resizeGrid3({ w: 1, h: 1, d: 1, cells: ['a'] }, 3, 2, 3);
    expect(r.cells.filter(c => c === 'a').length).toBe(1);
    expect(r.cells[1 + 1 * 3 + 0]).toBe('a');
    expect(getSlice(r, 1).join('')).toBe('.'.repeat(9));
  });
  test('setSlice replaces only that slice', () => {
    const g = { w: 2, h: 2, d: 2, cells: Array(8).fill('.') };
    const r = setSlice(g, 1, ['ab', 'cd']);
    expect(getSlice(r, 1)).toEqual(['ab', 'cd']);
    expect(getSlice(r, 0)).toEqual(['..', '..']);
    expect(g.cells.every(c => c === '.')).toBe(true);
  });
});
