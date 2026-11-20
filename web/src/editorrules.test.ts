import { describe, expect, it } from 'vitest';
import { offersSilhouetteSync, paletteCharError, partKeyDisplay } from './editorrules';
import type { PartSpec } from './types';

const viewPart = { front: 'r', back: 'r', side: 'r' } as unknown as PartSpec;
const gridPart = { size: [1, 1, 1], voxels: 'r' } as unknown as PartSpec;

describe('offersSilhouetteSync', () => {
  it('only for front/back errors on view parts', () => {
    expect(offersSilhouetteSync('parts.a: front/back silhouettes differ at row 1, column 2', viewPart)).toBe(true);
    expect(offersSilhouetteSync('parts.a: left/right silhouettes differ at row 1, column 2', viewPart)).toBe(false);
    expect(offersSilhouetteSync('parts.a: front/back silhouettes differ at row 1, column 2', gridPart)).toBe(false);
  });
});

describe('paletteCharError', () => {
  it('blocks dot, multi, duplicates', () => {
    const pal = { r: '#f00' };
    for (const v of ['.', 'ab', '', 'r']) expect(paletteCharError(v, pal)).not.toBeNull();
    expect(paletteCharError('g', pal)).toBeNull();
    expect(paletteCharError('r', pal, 'r')).toBeNull();
  });
});

describe('partKeyDisplay', () => {
  it('shows authored key value, none for null, else sample', () => {
    expect(partKeyDisplay({ value: 'head_alt' }, 'head')).toBe('head_alt');
    expect(partKeyDisplay({ value: null }, 'head')).toBe('');
    expect(partKeyDisplay(null, 'head')).toBe('head');
    expect(partKeyDisplay(null, null)).toBe('');
  });
});

describe('paletteCharError with grid parts', () => {
  const pal = { r: '#f00' };
  it('rejects digits/whitespace only when a grid part exists', () => {
    const msg = "Digits and spaces can't be colour keys in projects with 3D grid parts";
    for (const v of ['1', ' ']) {
      expect(paletteCharError(v, pal, undefined, { a: viewPart, g: gridPart })).toBe(msg);
      expect(paletteCharError(v, pal, undefined, { a: viewPart })).toBeNull();
    }
    expect(paletteCharError('x', pal, undefined, { g: gridPart })).toBeNull();
  });
});
