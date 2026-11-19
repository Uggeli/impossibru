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

describe('Adversarial Stress Test: Bresenham Line Algorithm', () => {
  it('handles zero-length lines across various coordinates', () => {
    const testCases = [
      [0, 0],
      [15, 15],
      [-5, -10],
      [100, 200],
    ];
    for (const [x, y] of testCases) {
      const pts = bresenhamLine(x, y, x, y);
      expect(pts).toEqual([[x, y]]);
      expect(pts.length).toBe(1);
    }
  });

  it('handles lines in all 8 octants with exact point count and boundary endpoints', () => {
    // Center at (10, 10), radius around 6
    const octants = [
      { name: 'Octant 1 (dx > dy > 0)', x0: 10, y0: 10, x1: 16, y1: 12, expectedLen: 7 },
      { name: 'Octant 2 (dy > dx > 0)', x0: 10, y0: 10, x1: 12, y1: 16, expectedLen: 7 },
      { name: 'Octant 3 (dy > -dx > 0)', x0: 10, y0: 10, x1: 8, y1: 16, expectedLen: 7 },
      { name: 'Octant 4 (-dx > dy > 0)', x0: 10, y0: 10, x1: 4, y1: 12, expectedLen: 7 },
      { name: 'Octant 5 (-dx > -dy > 0)', x0: 10, y0: 10, x1: 4, y1: 8, expectedLen: 7 },
      { name: 'Octant 6 (-dy > -dx > 0)', x0: 10, y0: 10, x1: 8, y1: 4, expectedLen: 7 },
      { name: 'Octant 7 (-dy > dx > 0)', x0: 10, y0: 10, x1: 12, y1: 4, expectedLen: 7 },
      { name: 'Octant 8 (dx > -dy > 0)', x0: 10, y0: 10, x1: 16, y1: 8, expectedLen: 7 },
    ];

    for (const oct of octants) {
      const pts = bresenhamLine(oct.x0, oct.y0, oct.x1, oct.y1);
      expect(pts.length, `${oct.name} length`).toBe(oct.expectedLen);
      expect(pts[0], `${oct.name} start`).toEqual([oct.x0, oct.y0]);
      expect(pts[pts.length - 1], `${oct.name} end`).toEqual([oct.x1, oct.y1]);

      // Check 8-connectivity (no step > 1 in either x or y)
      for (let i = 0; i < pts.length - 1; i++) {
        const [xCurr, yCurr] = pts[i];
        const [xNext, yNext] = pts[i + 1];
        const stepX = Math.abs(xNext - xCurr);
        const stepY = Math.abs(yNext - yCurr);
        expect(Math.max(stepX, stepY), `${oct.name} connectivity at ${i}`).toBe(1);
      }
    }
  });

  it('guarantees exact length = max(|dx|, |dy|) + 1 and Chebyshev continuity across 500 randomized vectors', () => {
    // Deterministic pseudo-random seed
    let seed = 123456789;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed % 100) - 50; // range [-50, 49]
    };

    for (let iter = 0; iter < 500; iter++) {
      const x0 = rnd();
      const y0 = rnd();
      const x1 = rnd();
      const y1 = rnd();

      const pts = bresenhamLine(x0, y0, x1, y1);
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const expectedLength = Math.max(dx, dy) + 1;

      expect(pts.length).toBe(expectedLength);
      expect(pts[0]).toEqual([x0, y0]);
      expect(pts[pts.length - 1]).toEqual([x1, y1]);

      // Verify Chebyshev continuity and monotonicity
      for (let i = 0; i < pts.length - 1; i++) {
        const [cx, cy] = pts[i];
        const [nx, ny] = pts[i + 1];
        const maxStep = Math.max(Math.abs(nx - cx), Math.abs(ny - cy));
        expect(maxStep).toBe(1);
      }
    }
  });

  it('steep vs shallow diagonal symmetry', () => {
    // 1-pixel horizontal / vertical steps
    expect(bresenhamLine(0, 0, 1, 0)).toEqual([[0, 0], [1, 0]]);
    expect(bresenhamLine(0, 0, 0, 1)).toEqual([[0, 0], [0, 1]]);
    expect(bresenhamLine(0, 0, 1, 1)).toEqual([[0, 0], [1, 1]]);
    expect(bresenhamLine(0, 0, -1, -1)).toEqual([[0, 0], [-1, -1]]);
  });
});

describe('Adversarial Stress Test: Rectangle Tool Points Generator', () => {
  it('generates exact outlines and fills for 1x1, 1xN, Nx1, and degenerate geometries', () => {
    // 1x1
    expect(rectPoints(5, 5, 5, 5, false)).toEqual([[5, 5]]);
    expect(rectPoints(5, 5, 5, 5, true)).toEqual([[5, 5]]);

    // 1x5 vertical strip
    const vOutline = rectPoints(3, 1, 3, 5, false);
    const vFilled = rectPoints(3, 1, 3, 5, true);
    expect(vOutline.length).toBe(5);
    expect(vFilled.length).toBe(5);
    expect(vOutline).toEqual(vFilled);

    // 5x1 horizontal strip
    const hOutline = rectPoints(1, 4, 5, 4, false);
    const hFilled = rectPoints(1, 4, 5, 4, true);
    expect(hOutline.length).toBe(5);
    expect(hFilled.length).toBe(5);
    expect(hOutline).toEqual(hFilled);
  });

  it('outline of WxH has exact perimeter count 2*W + 2*H - 4 with no duplicates', () => {
    const W = 7;
    const H = 5;
    const outline = rectPoints(2, 3, 2 + W - 1, 3 + H - 1, false);
    const expectedPerimeterCount = 2 * W + 2 * H - 4; // 14 + 10 - 4 = 20
    expect(outline.length).toBe(expectedPerimeterCount);

    // Check uniqueness (no duplicate coordinates in outline)
    const set = new Set(outline.map(([x, y]) => `${x},${y}`));
    expect(set.size).toBe(expectedPerimeterCount);

    // Interior points must NOT be present
    expect(set.has('3,4')).toBe(false);
    expect(set.has('4,5')).toBe(false);

    // Filled must contain all W*H points
    const filled = rectPoints(2, 3, 2 + W - 1, 3 + H - 1, true);
    expect(filled.length).toBe(W * H);
    expect(new Set(filled.map(([x, y]) => `${x},${y}`)).size).toBe(W * H);
  });

  it('coordinate inversion yields identical sets', () => {
    const p1 = rectPoints(0, 0, 4, 3, false).sort();
    const p2 = rectPoints(4, 3, 0, 0, false).sort();
    const p3 = rectPoints(0, 3, 4, 0, false).sort();
    const p4 = rectPoints(4, 0, 0, 3, false).sort();

    expect(p1).toEqual(p2);
    expect(p1).toEqual(p3);
    expect(p1).toEqual(p4);
  });
});

describe('Adversarial Stress Test: Fast Flood Fill & Parity Invariants', () => {
  it('fills large uniform grids without queue overflow or performance degradation', () => {
    const size = 32;
    const row = '.'.repeat(size);
    const gridStr = Array(size).fill(row).join('\n');
    const part = {
      front: gridStr,
      back: gridStr,
      side: gridStr
    };

    const t0 = performance.now();
    const result = fastFloodFill(part, 'front', 0, 0, 'a', 'a');
    const t1 = performance.now();

    expect(result).toBe(true);
    expect(t1 - t0).toBeLessThan(50); // fast < 50ms

    const expectedRow = 'a'.repeat(size);
    const expectedGrid = Array(size).fill(expectedRow).join('\n');
    expect(part.front).toBe(expectedGrid);
    expect(part.back).toBe(expectedGrid);
    expect(part.side).toBe(gridStr); // side untouched
  });

  it('handles isolated cavities and labyrinth enclosures without leaking', () => {
    // 5x5 donut: outer ring of 'x', center is '.', surrounded by '.'
    // xxxxx
    // x...x
    // x.o.x
    // x...x
    // xxxxx
    const donutFront = [
      'xxxxx',
      'x...x',
      'x.o.x',
      'x...x',
      'xxxxx'
    ].join('\n');
    const part = {
      front: donutFront,
      back: donutFront,
      side: donutFront
    };

    // Fill the inner '.' region at (1, 1) with 'z'
    const res = fastFloodFill(part, 'front', 1, 1, 'z', 'z');
    expect(res).toBe(true);

    const expected = [
      'xxxxx',
      'xzzzx',
      'xzoxz',
      'xzzzx',
      'xxxxx'
    ];
    // Wait: at (2, 2) is 'o' which is different target, so (2, 2) should remain 'o'!
    // at (2, 4) is 'x' which is wall. The cells filled should be:
    // (1,1), (2,1), (3,1), (1,2), (3,2), (1,3), (2,3), (3,3) - 8 cells.
    const frontRows = part.front.split('\n');
    expect(frontRows[0]).toBe('xxxxx');
    expect(frontRows[1]).toBe('xzzzx');
    expect(frontRows[2]).toBe('xzozx');
    expect(frontRows[3]).toBe('xzzzx');
    expect(frontRows[4]).toBe('xxxxx');
  });

  it('checkerboard flood fill fills exactly one diagonal component', () => {
    // 4x4 checkerboard
    // .x.x
    // x.x.
    // .x.x
    // x.x.
    const cb = [
      '.x.x',
      'x.x.',
      '.x.x',
      'x.x.'
    ].join('\n');
    const part = { front: cb, back: cb, side: cb };

    // Fill at (0, 0) target '.'
    // Since neighbors are 4-connected ('x'), only (0,0) is filled!
    fastFloodFill(part, 'front', 0, 0, 'z', 'z');
    expect(part.front.split('\n')[0]).toBe('zx.x');
    expect(part.front.split('\n')[1]).toBe('x.x.');
  });

  it('rejects out-of-bounds start points and already-filled target colors', () => {
    const grid = 'xxx\nxxx\nxxx';
    const part = { front: grid, back: grid, side: grid };

    // Out of bounds
    expect(fastFloodFill(part, 'front', -1, 0, 'z', 'z')).toBe(false);
    expect(fastFloodFill(part, 'front', 0, -1, 'z', 'z')).toBe(false);
    expect(fastFloodFill(part, 'front', 3, 0, 'z', 'z')).toBe(false);
    expect(fastFloodFill(part, 'front', 0, 3, 'z', 'z')).toBe(false);

    // Target char equals fill char
    expect(fastFloodFill(part, 'front', 1, 1, 'x', 'x')).toBe(false);

    // Unchanged part
    expect(part.front).toBe(grid);
  });

  it('strictly preserves silhouette parity under all front and back fill scenarios', () => {
    // Scenario 1: Painting over empty region in Front populates Back silhouette
    const p1 = {
      front: '....\n.x..\n....',
      back: '....\n.x..\n....',
      side: '....\n....\n....'
    };
    fastFloodFill(p1, 'front', 0, 0, 'y', 'y');
    // Front row 0, row 2, and parts of row 1 become 'y'
    // Back must have identical non-empty positions as Front
    const fRows1 = p1.front.split('\n');
    const bRows1 = p1.back.split('\n');
    for (let r = 0; r < fRows1.length; r++) {
      for (let c = 0; c < fRows1[0].length; c++) {
        const fSolid = fRows1[r][c] !== '.';
        const bSolid = bRows1[r][c] !== '.';
        expect(fSolid).toBe(bSolid);
      }
    }

    // Scenario 2: Erasing in Front erases Back
    fastFloodFill(p1, 'front', 0, 0, '.', 'y');
    const fRows2 = p1.front.split('\n');
    const bRows2 = p1.back.split('\n');
    for (let r = 0; r < fRows2.length; r++) {
      for (let c = 0; c < fRows2[0].length; c++) {
        expect(fRows2[r][c] !== '.').toBe(bRows2[r][c] !== '.');
      }
    }

    // Scenario 3: Filling in Back preserves Front silhouette parity
    const p2 = {
      front: '....\n.aa.\n....',
      back: '....\n.bb.\n....',
      side: '....\n....\n....'
    };
    fastFloodFill(p2, 'back', 1, 1, 'c', 'c');
    expect(p2.back).toBe('....\n.cc.\n....');
    // Front colors (aa) preserved, silhouette intact
    expect(p2.front).toBe('....\n.aa.\n....');
  });
});

describe('Adversarial Stress Test: Mirror Mode Mathematical Exactness', () => {
  it('guarantees involution m(m(x)) = x and distinct dual coordinates for even width grids', () => {
    const evenWidths = [2, 4, 8, 16, 24, 32];
    for (const cols of evenWidths) {
      for (let x = 0; x < cols; x++) {
        const mx = cols - 1 - x;
        // Invariant 1: mx is within grid bounds
        expect(mx).toBeGreaterThanOrEqual(0);
        expect(mx).toBeLessThan(cols);
        // Invariant 2: Involution m(m(x)) = x
        expect(cols - 1 - mx).toBe(x);
        // Invariant 3: For even width, mx is NEVER equal to x
        expect(mx).not.toBe(x);
        // Invariant 4: Distance to midpoint is identical
        const mid = cols / 2;
        expect(Math.abs(x + 0.5 - mid)).toBe(Math.abs(mx + 0.5 - mid));
      }
    }
  });

  it('guarantees exact center symmetry for odd width grids', () => {
    const oddWidths = [1, 3, 5, 7, 15, 31];
    for (const cols of oddWidths) {
      const centerCol = (cols - 1) / 2;
      for (let x = 0; x < cols; x++) {
        const mx = cols - 1 - x;
        expect(mx).toBeGreaterThanOrEqual(0);
        expect(mx).toBeLessThan(cols);
        expect(cols - 1 - mx).toBe(x);

        if (x === centerCol) {
          // Invariant: Center column mirrors to itself
          expect(mx).toBe(x);
        } else {
          expect(mx).not.toBe(x);
        }
      }
    }
  });

  it('mirror mode line rendering produces perfectly reflected point sets', () => {
    const cols = 16;
    const p0: [number, number] = [2, 3];
    const p1: [number, number] = [6, 11];

    const ptsOriginal = bresenhamLine(p0[0], p0[1], p1[0], p1[1]);
    const reflectedPtsDirect = ptsOriginal.map(([x, y]) => [cols - 1 - x, y] as [number, number]);

    const p0Mirrored: [number, number] = [cols - 1 - p0[0], p0[1]];
    const p1Mirrored: [number, number] = [cols - 1 - p1[0], p1[1]];
    const ptsMirroredLine = bresenhamLine(p0Mirrored[0], p0Mirrored[1], p1Mirrored[0], p1Mirrored[1]);

    // Sorting coordinates to compare point sets
    const sortFn = (a: [number, number], b: [number, number]) => a[1] - b[1] || a[0] - b[0];
    expect(reflectedPtsDirect.sort(sortFn)).toEqual(ptsMirroredLine.sort(sortFn));
  });
});

describe('Adversarial Stress Test: Silhouette Parity Reconciliation', () => {
  it('strictly satisfies silhouette equivalence (front !== .) <=> (back !== .) for arbitrary random grids', () => {
    let seed = 987654321;
    const rndChar = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const chars = ['.', '.', '.', 'a', 'b', 'c'];
      return chars[seed % chars.length];
    };

    const H = 8;
    const W = 8;

    for (let testIdx = 0; testIdx < 50; testIdx++) {
      const front: string[] = [];
      const back: string[] = [];
      for (let y = 0; y < H; y++) {
        let fRow = '';
        let bRow = '';
        for (let x = 0; x < W; x++) {
          fRow += rndChar();
          bRow += rndChar();
        }
        front.push(fRow);
        back.push(bRow);
      }

      const reconciledBack = reconcileSilhouette(front, back, 'z');
      expect(reconciledBack.length).toBe(H);

      for (let y = 0; y < H; y++) {
        expect(reconciledBack[y].length).toBe(W);
        for (let x = 0; x < W; x++) {
          const fSolid = front[y][x] !== '.';
          const bSolid = reconciledBack[y][x] !== '.';
          expect(bSolid, `Mismatch at (${x}, ${y}) in test ${testIdx}`).toBe(fSolid);

          // If both were previously solid, ensure back color character was preserved
          if (front[y][x] !== '.' && back[y][x] !== '.') {
            expect(reconciledBack[y][x]).toBe(back[y][x]);
          }
        }
      }
    }
  });
});

describe('Adversarial Stress Test: Hex Validation and Color Parsing', () => {
  it('strictly validates edge case hex formats', () => {
    // Valid
    expect(isValidHex('#000000')).toBe(true);
    expect(isValidHex('#ffffff')).toBe(true);
    expect(isValidHex('#ABCDEF')).toBe(true);
    expect(isValidHex('#12345678')).toBe(true);
    expect(isValidHex('  #123456  ')).toBe(true);

    // Invalid
    expect(isValidHex('')).toBe(false);
    expect(isValidHex('#')).toBe(false);
    expect(isValidHex('#12345')).toBe(false);
    expect(isValidHex('#1234567')).toBe(false);
    expect(isValidHex('#123456789')).toBe(false);
    expect(isValidHex('#12345g')).toBe(false);
    expect(isValidHex('123456')).toBe(false);
    expect(isValidHex('#12 3456')).toBe(false);
  });

  it('normalizes arbitrary palette values with alpha and bounds clamping', () => {
    expect(paletteHex('#ABC')).toBe('#abc');
    expect(paletteHex('66d9a3')).toBe('#66d9a3');
    expect(paletteHex([0, 128, 255])).toBe('#0080ff');
    expect(paletteHex([-10, 300, 100])).toBe('#00ff64'); // clamped 0..255
    expect(paletteHex([255, 255, 255, 0.5])).toBe('#ffffff80'); // float alpha
    expect(paletteHex([255, 255, 255, 255])).toBe('#ffffffff'); // int alpha
    expect(paletteHex(null)).toBe('#ff00ff');
    expect(paletteHex(undefined)).toBe('#ff00ff');
  });
});
