import { describe, expect, it } from 'vitest';
import { color, ProjectError, validateProject } from './engine';
import { starterProject } from './runtime';
import type { Color, ProjectDocument } from './types';

describe('Color Parser & Hex Validation (color)', () => {
  it('parses valid 6-digit hex strings into RGBA tuple with alpha=255', () => {
    expect(color('#000000')).toEqual([0, 0, 0, 255]);
    expect(color('#ffffff')).toEqual([255, 255, 255, 255]);
    expect(color('#112233')).toEqual([17, 34, 51, 255]);
    expect(color('#ff0080')).toEqual([255, 0, 128, 255]);
  });

  it('parses case-insensitively for 6-digit and 8-digit hex strings', () => {
    expect(color('#AABBCC')).toEqual([170, 187, 204, 255]);
    expect(color('#aabbcc')).toEqual([170, 187, 204, 255]);
    expect(color('#AaBbCc')).toEqual([170, 187, 204, 255]);
    expect(color('#AABBCCDD')).toEqual([170, 187, 204, 221]);
    expect(color('#aabbccdd')).toEqual([170, 187, 204, 221]);
  });

  it('parses valid 8-digit hex strings including alpha channel', () => {
    expect(color('#00000000')).toEqual([0, 0, 0, 0]);
    expect(color('#ffffff80')).toEqual([255, 255, 255, 128]);
    expect(color('#11223344')).toEqual([17, 34, 51, 68]);
    expect(color('#00ff00ff')).toEqual([0, 255, 0, 255]);
  });

  it('parses 3-element numeric RGB arrays into RGBA tuple', () => {
    expect(color([0, 0, 0])).toEqual([0, 0, 0, 255]);
    expect(color([255, 255, 255])).toEqual([255, 255, 255, 255]);
    expect(color([100, 150, 200])).toEqual([100, 150, 200, 255]);
  });

  it('parses 4-element numeric RGBA arrays', () => {
    expect(color([0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
    expect(color([255, 128, 64, 32])).toEqual([255, 128, 64, 32]);
  });

  it('rejects invalid hex formats (3-digit, 4-digit, 5-digit, 7-digit, non-hex, missing hash)', () => {
    const invalidHexStrings = [
      '#fff',
      '#ffff',
      '#12345',
      '#1234567',
      '#123456789',
      'ffffff',
      '#gggggg',
      '#12345z',
      '#xyz123',
      '',
      '#',
    ];

    for (const hex of invalidHexStrings) {
      expect(() => color(hex as any)).toThrow(ProjectError);
      expect(() => color(hex as any)).toThrow(/must be #RRGGBB, #RRGGBBAA, or an RGB\(A\) list/);
    }
  });

  it('rejects invalid array formats (wrong length, out of range, non-integers)', () => {
    const invalidArrays: any[] = [
      [],
      [255],
      [255, 255],
      [255, 255, 255, 255, 255], // length 5
      [-1, 0, 0], // negative
      [256, 0, 0], // > 255
      [0, 0, 300], // > 255
      [0, 0, 0, -10], // negative alpha
      [0, 0, 0, 256], // > 255 alpha
      [128.5, 0, 0], // non-integer
      ['255', 0, 0], // string element
      [NaN, 0, 0], // NaN
      [Infinity, 0, 0], // Infinity
    ];

    for (const arr of invalidArrays) {
      expect(() => color(arr)).toThrow(ProjectError);
      expect(() => color(arr)).toThrow(/channels must be integers from 0 to 255/);
    }
  });
});

describe('Palette Operations & Document Integrity', () => {
  it('allows adding single-character palette colors', () => {
    const doc = starterProject('palette_add');
    doc.palette.r = '#ff0000';
    doc.palette.g = [0, 255, 0];
    doc.palette.b = '#0000ff80';

    expect(() => validateProject(doc)).not.toThrow();
    expect(doc.palette.r).toBe('#ff0000');
    expect(doc.palette.g).toEqual([0, 255, 0]);
  });

  it('rejects dot "." as a palette key in project validation', () => {
    const doc = starterProject('dot_key');
    doc.palette['.'] = '#ff0000';
    expect(() => validateProject(doc)).toThrow(ProjectError);
    expect(() => validateProject(doc)).toThrow(/palette keys must be single characters other than '\.'/);
  });

  it('rejects multi-character or empty string palette keys', () => {
    const docMulti = starterProject('multi_key');
    docMulti.palette['red'] = '#ff0000';
    expect(() => validateProject(docMulti)).toThrow(ProjectError);
    expect(() => validateProject(docMulti)).toThrow(/palette keys must be single characters other than '\.'/);

    const docEmpty = starterProject('empty_key');
    delete docEmpty.palette.x;
    (docEmpty.palette as any)[''] = '#ff0000';
    expect(() => validateProject(docEmpty)).toThrow(ProjectError);
    expect(() => validateProject(docEmpty)).toThrow(/palette keys must be single characters other than '\.'/);
  });

  it('rejects empty palette dictionary', () => {
    const doc = starterProject('empty_palette');
    doc.palette = {};
    expect(() => validateProject(doc)).toThrow(ProjectError);
    expect(() => validateProject(doc)).toThrow(/palette must be a non-empty mapping/);
  });

  it('supports renaming palette character and migrating across parts grids', () => {
    const doc = starterProject('rename_color');
    doc.palette = { x: '#66D9A3', y: '#ffaa00' };

    // Rename 'x' to 'z'
    const oldChar = 'x';
    const newChar = 'z';

    // 1. Update palette dictionary
    const newPalette: Record<string, Color> = {};
    for (const [k, v] of Object.entries(doc.palette)) {
      newPalette[k === oldChar ? newChar : k] = v;
    }
    doc.palette = newPalette;

    // 2. Update parts views
    for (const part of Object.values(doc.parts)) {
      for (const view of ['front', 'back', 'side'] as const) {
        (part as any)[view] = (part as any)[view].split(oldChar).join(newChar);
      }
    }

    expect(() => validateProject(doc)).not.toThrow();
    expect(doc.palette.x).toBeUndefined();
    expect(doc.palette.z).toBe('#66D9A3');
    expect(doc.parts.part.front).toContain('z');
    expect(doc.parts.part.front).not.toContain('x');
  });

  it('supports deleting an unused palette color', () => {
    const doc = starterProject('delete_unused');
    doc.palette.unused = '#123456'; // add unused color
    delete (doc.palette as any).unused;
    doc.palette.y = '#ff00ff';
    delete doc.palette.y; // 'y' is not used in part grids

    expect(() => validateProject(doc)).not.toThrow();
    expect(doc.palette.y).toBeUndefined();
  });

  it('rejects deleting a palette color that is still referenced by a part grid', () => {
    const doc = starterProject('delete_used');
    doc.palette.y = '#ff00ff';
    delete doc.palette.x; // 'x' is still used in doc.parts.part

    expect(() => validateProject(doc)).toThrow(ProjectError);
    expect(() => validateProject(doc)).toThrow(/uses unknown palette character 'x'/);
  });

  it('preserves palette reordering', () => {
    const doc = starterProject('reorder');
    doc.palette = {
      c: '#00ffff',
      b: '#0000ff',
      a: '#ff0000',
      x: '#ffffff',
    };
    expect(() => validateProject(doc)).not.toThrow();
    expect(Object.keys(doc.palette)).toEqual(['c', 'b', 'a', 'x']);
  });
});
