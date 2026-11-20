import { describe, it, expect } from 'vitest';
import {
  bresenhamLine,
  rectPoints,
  canvasCell,
  fastFloodFill,
  reconcileSilhouette,
  replaceColorInPart,
  isValidHex,
  paletteHex,
} from './canvas';

describe('Bresenham Line Algorithm', () => {
  it('generates single point for identical start and end', () => {
    const pts = bresenhamLine(5, 5, 5, 5);
    expect(pts).toEqual([[5, 5]]);
  });

  it('generates horizontal line from left to right', () => {
    const pts = bresenhamLine(2, 3, 5, 3);
    expect(pts).toEqual([[2, 3], [3, 3], [4, 3], [5, 3]]);
  });

  it('generates horizontal line from right to left', () => {
    const pts = bresenhamLine(5, 3, 2, 3);
    expect(pts).toEqual([[5, 3], [4, 3], [3, 3], [2, 3]]);
  });

  it('generates vertical line downwards and upwards', () => {
    const down = bresenhamLine(4, 1, 4, 4);
    expect(down).toEqual([[4, 1], [4, 2], [4, 3], [4, 4]]);
    const up = bresenhamLine(4, 4, 4, 1);
    expect(up).toEqual([[4, 4], [4, 3], [4, 2], [4, 1]]);
  });

  it('generates 45-degree diagonal line across octants', () => {
    const diag1 = bresenhamLine(0, 0, 3, 3);
    expect(diag1).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);

    const diag2 = bresenhamLine(3, 3, 0, 0);
    expect(diag2).toEqual([[3, 3], [2, 2], [1, 1], [0, 0]]);

    const diag3 = bresenhamLine(0, 3, 3, 0);
    expect(diag3).toEqual([[0, 3], [1, 2], [2, 1], [3, 0]]);
  });

  it('generates shallow and steep lines', () => {
    const shallow = bresenhamLine(0, 0, 5, 2);
    expect(shallow[0]).toEqual([0, 0]);
    expect(shallow[shallow.length - 1]).toEqual([5, 2]);
    expect(shallow.length).toBe(6);

    const steep = bresenhamLine(0, 0, 2, 5);
    expect(steep[0]).toEqual([0, 0]);
    expect(steep[steep.length - 1]).toEqual([2, 5]);
    expect(steep.length).toBe(6);
  });
});

describe('Rectangle Points Generator', () => {
  it('generates single point for 1x1 rect', () => {
    expect(rectPoints(2, 2, 2, 2, false)).toEqual([[2, 2]]);
    expect(rectPoints(2, 2, 2, 2, true)).toEqual([[2, 2]]);
  });

  it('generates perimeter points for 3x3 rect', () => {
    const outline = rectPoints(0, 0, 2, 2, false);
    expect(outline.length).toBe(8); // 3*3 - 1 center
    expect(outline).not.toContainEqual([1, 1]);
    expect(outline).toContainEqual([0, 0]);
    expect(outline).toContainEqual([2, 2]);
  });

  it('generates filled points for 3x3 rect', () => {
    const filled = rectPoints(0, 0, 2, 2, true);
    expect(filled.length).toBe(9);
    expect(filled).toContainEqual([1, 1]);
  });

  it('handles inverted start and end coordinates', () => {
    const pts1 = rectPoints(1, 1, 3, 3);
    const pts2 = rectPoints(3, 3, 1, 1);
    expect(pts1.sort()).toEqual(pts2.sort());
  });
});

describe('canvasCell Coordinate Mapping', () => {
  it('maps normalized coordinates correctly within bounds', () => {
    const fakeCanvas = {
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 200, height: 100 })
    } as unknown as HTMLCanvasElement;

    // Center of first cell in 4x2 grid
    const e1 = { clientX: 120, clientY: 70 } as MouseEvent;
    expect(canvasCell(e1, fakeCanvas, 4, 2)).toEqual([0, 0]);

    // Bottom right cell
    const e2 = { clientX: 290, clientY: 140 } as MouseEvent;
    expect(canvasCell(e2, fakeCanvas, 4, 2)).toEqual([3, 1]);

    // Out of bounds clamped
    const e3 = { clientX: 50, clientY: 20 } as MouseEvent;
    expect(canvasCell(e3, fakeCanvas, 4, 2)).toEqual([0, 0]);

    const e4 = { clientX: 400, clientY: 300 } as MouseEvent;
    expect(canvasCell(e4, fakeCanvas, 4, 2)).toEqual([3, 1]);
  });
});

describe('fastFloodFill Algorithm', () => {
  it('erasing in left syncs erasure in right and fills keep right occupancy', () => {
    const part: any = { front: 'xx', back: 'xx', left: 'xx\nxx', right: 'xx\nxx' };
    expect(fastFloodFill(part, 'left', 0, 0, '.', 'y')).toBe(true);
    expect(part.left).toBe('..\n..');
    expect(part.right).toBe('..\n..');
    expect(fastFloodFill(part, 'left', 0, 0, 'y', 'y')).toBe(true);
    expect(part.left).toBe('yy\nyy');
    expect(part.right).toBe('yy\nyy');
  });

  it('fills connected region and synchronizes front/back silhouettes', () => {
    const part = {
      front: '....\n.xx.\n.xx.\n....',
      back: '....\n.xx.\n.xx.\n....',
      side: '....\n.xx.\n.xx.\n....'
    };

    const changed = fastFloodFill(part, 'front', 1, 1, 'y', 'y');
    expect(changed).toBe(true);
    expect(part.front).toBe('....\n.yy.\n.yy.\n....');
    // Existing non-empty back voxels retained their shape
    expect(part.back).toBe('....\n.xx.\n.xx.\n....');
  });

  it('erasing region in front syncs erasure in back view', () => {
    const part = {
      front: '....\n.xx.\n.xx.\n....',
      back: '....\n.xx.\n.xx.\n....',
      side: '....\n.xx.\n.xx.\n....'
    };

    const changed = fastFloodFill(part, 'front', 1, 1, '.', 'x');
    expect(changed).toBe(true);
    expect(part.front).toBe('....\n....\n....\n....');
    expect(part.back).toBe('....\n....\n....\n....');
  });

  it('filling transparent region in front populates back silhouette', () => {
    const part = {
      front: '....\n....',
      back: '....\n....',
      side: '....\n....'
    };

    fastFloodFill(part, 'front', 0, 0, 'z', 'z');
    expect(part.front).toBe('zzzz\nzzzz');
    expect(part.back).toBe('zzzz\nzzzz');
  });

  it('returns false if target cell already matches fillChar', () => {
    const part = {
      front: 'xxxx\nxxxx',
      back: 'xxxx\nxxxx',
      side: 'xxxx\nxxxx'
    };
    expect(fastFloodFill(part, 'front', 0, 0, 'x', 'x')).toBe(false);
  });
});

describe('Silhouette Reconciliation', () => {
  it('reconciles back grid to match front silhouette', () => {
    const front = ['..xx..', 'xxxxxx', '..xx..'];
    const mismatchedBack = ['......', '..xx..', 'xxxxxx'];

    const reconciled = reconcileSilhouette(front, mismatchedBack, 'k');
    expect(reconciled).toEqual(['..xx..', 'xxxxxx', '..xx..']);

    // Check individual cells:
    // row 0: front has xx at 2,3, back had nothing -> filled with xx
    // row 1: front has xxxxxx, back had xx at 2,3 -> xx at 2,3 preserved, others filled with front color
    // row 2: front has xx at 2,3, back had xxxxxx -> extra 0,1,4,5 cleared to '.'
    expect(reconciled[0]).toBe('..xx..');
    expect(reconciled[1]).toBe('xxxxxx');
    expect(reconciled[2]).toBe('..xx..');
  });
});

describe('replaceColorInPart', () => {
  it('replaces characters across front, back, and side views', () => {
    const part = {
      front: 'axxa\naxxa',
      back: 'bxxb\nbxxb',
      side: 'cxxa\naxxc'
    };
    replaceColorInPart(part, 'x', 'z');
    expect(part.front).toBe('azza\nazza');
    expect(part.back).toBe('bzzb\nbzzb');
    expect(part.side).toBe('czza\nazzc');
  });
});

describe('Hex Validation and Palette Format', () => {
  it('validates 6 and 8 character hex strings', () => {
    expect(isValidHex('#ffffff')).toBe(true);
    expect(isValidHex('#FF0000')).toBe(true);
    expect(isValidHex('#66d9a380')).toBe(true);
    expect(isValidHex('#123456FF')).toBe(true);

    expect(isValidHex('ffffff')).toBe(false);
    expect(isValidHex('#fff')).toBe(false);
    expect(isValidHex('#12345')).toBe(false);
    expect(isValidHex('#1234567')).toBe(false);
    expect(isValidHex('#gggggg')).toBe(false);
  });

  it('formats paletteHex preserving alpha', () => {
    expect(paletteHex('#66d9a3')).toBe('#66d9a3');
    expect(paletteHex('#66D9A380')).toBe('#66d9a380');
    expect(paletteHex([255, 0, 128])).toBe('#ff0080');
    expect(paletteHex([255, 0, 128, 128])).toBe('#ff008080');
    expect(paletteHex([255, 0, 128, 0.5])).toBe('#ff008080');
  });
});
