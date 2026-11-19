import { describe, it, expect } from 'vitest';
import {
  bresenhamLine,
  rectPoints,
  canvasCell,
  fastFloodFill,
  reconcileSilhouette,
  replaceColorInPart,
  isValidHex,
  paletteHex
} from './canvas';
import { cleanAnimationTracks } from './app';
import { validateProject, ProjectError, pose, overlay } from './engine';
import { starterProject, autorigProjectFallback } from './runtime';
import type { ProjectDocument } from './types';

describe('Challenger 2 M5 Phase 2 Adversarial: Canvas, Palette, Timeline & Persistence Hardening', () => {

  // =========================================================================
  // 1. CANVAS & PAINTING ALGORITHMS ADVERSARIAL STRESS
  // =========================================================================
  describe('1. Canvas & Painting Boundary Stress', () => {
    it('bresenhamLine handles zero-length, horizontal, vertical, and steep diagonal lines', () => {
      // 0-length line
      expect(bresenhamLine(5, 5, 5, 5)).toEqual([[5, 5]]);

      // Horizontal forward and backward
      expect(bresenhamLine(0, 2, 3, 2)).toEqual([[0, 2], [1, 2], [2, 2], [3, 2]]);
      expect(bresenhamLine(3, 2, 0, 2)).toEqual([[3, 2], [2, 2], [1, 2], [0, 2]]);

      // Vertical forward and backward
      expect(bresenhamLine(2, 0, 2, 3)).toEqual([[2, 0], [2, 1], [2, 2], [2, 3]]);
      expect(bresenhamLine(2, 3, 2, 0)).toEqual([[2, 3], [2, 2], [2, 1], [2, 0]]);

      // Diagonal with steep slope
      const steep = bresenhamLine(0, 0, 1, 4);
      expect(steep.length).toBe(5);
      expect(steep[0]).toEqual([0, 0]);
      expect(steep[4]).toEqual([1, 4]);

      // Negative coordinates
      const neg = bresenhamLine(-2, -2, 2, 2);
      expect(neg[0]).toEqual([-2, -2]);
      expect(neg[neg.length - 1]).toEqual([2, 2]);
    });

    it('rectPoints handles empty, 1x1, inverted coordinates, and filled vs perimeter', () => {
      // 1x1 rect
      expect(rectPoints(3, 3, 3, 3, false)).toEqual([[3, 3]]);
      expect(rectPoints(3, 3, 3, 3, true)).toEqual([[3, 3]]);

      // Inverted coordinates (x0 > x1, y0 > y1)
      const rectNormal = rectPoints(1, 1, 3, 3, false);
      const rectInverted = rectPoints(3, 3, 1, 1, false);
      expect(rectNormal.length).toBe(rectInverted.length);
      expect(new Set(rectNormal.map(p => `${p[0]},${p[1]}`)))
        .toEqual(new Set(rectInverted.map(p => `${p[0]},${p[1]}`)));

      // Perimeter for 3x3 has 8 points (empty center)
      expect(rectNormal.length).toBe(8);
      expect(rectNormal.some(p => p[0] === 2 && p[1] === 2)).toBe(false);

      // Filled for 3x3 has 9 points
      const rectFilled = rectPoints(1, 1, 3, 3, true);
      expect(rectFilled.length).toBe(9);
      expect(rectFilled.some(p => p[0] === 2 && p[1] === 2)).toBe(true);
    });

    it('canvasCell clamps out-of-bounds, negative, and fractional pointer coordinates safely', () => {
      const mockCanvas = {
        getBoundingClientRect: () => ({
          left: 100,
          top: 100,
          width: 200,
          height: 200,
          right: 300,
          bottom: 300,
          x: 100,
          y: 100,
          toJSON: () => {}
        })
      } as unknown as HTMLCanvasElement;

      // Inside top-left corner
      expect(canvasCell({ clientX: 100, clientY: 100 } as any, mockCanvas, 16, 16)).toEqual([0, 0]);

      // Inside bottom-right corner
      expect(canvasCell({ clientX: 299, clientY: 299 } as any, mockCanvas, 16, 16)).toEqual([15, 15]);

      // Far outside negative coordinates (e.g. -500, -500)
      expect(canvasCell({ clientX: -500, clientY: -500 } as any, mockCanvas, 16, 16)).toEqual([0, 0]);

      // Far outside positive coordinates (e.g. 10000, 10000)
      expect(canvasCell({ clientX: 10000, clientY: 10000 } as any, mockCanvas, 16, 16)).toEqual([15, 15]);

      // Fractional sub-pixel coordinates
      expect(canvasCell({ clientX: 150.7, clientY: 175.3 } as any, mockCanvas, 16, 16)).toEqual([4, 6]);

      // Collapsed/zero-size canvas returns [0,0] without throwing
      const zeroCanvas = {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 })
      } as unknown as HTMLCanvasElement;
      expect(canvasCell({ clientX: 50, clientY: 50 } as any, zeroCanvas, 16, 16)).toEqual([0, 0]);
    });

    it('fastFloodFill handles full bounds on large grids, solid grids, and preserves silhouette parity', () => {
      // 8x8 empty grid
      const emptyRow = '........';
      const spec = {
        front: Array(8).fill(emptyRow).join('\n'),
        back: Array(8).fill(emptyRow).join('\n'),
        side: Array(8).fill(emptyRow).join('\n')
      };

      // Full bounds flood fill on front with 'x'
      const changed = fastFloodFill(spec, 'front', 0, 0, 'x', 'x');
      expect(changed).toBe(true);

      const frontRows = spec.front.split('\n');
      expect(frontRows.length).toBe(8);
      expect(frontRows.every(r => r === 'xxxxxxxx')).toBe(true);

      // Back view must also be filled to maintain silhouette parity
      const backRows = spec.back.split('\n');
      expect(backRows.every(r => r === 'xxxxxxxx')).toBe(true);

      // No-op when filling with same character
      expect(fastFloodFill(spec, 'front', 0, 0, 'x', 'x')).toBe(false);

      // Clearing whole grid with '.'
      const cleared = fastFloodFill(spec, 'front', 0, 0, '.', 'x');
      expect(cleared).toBe(true);
      expect(spec.front.split('\n').every(r => r === '........')).toBe(true);
      expect(spec.back.split('\n').every(r => r === '........')).toBe(true);

      // Flood fill with out-of-bounds start coordinates returns false
      expect(fastFloodFill(spec, 'front', -1, 0, 'x', 'x')).toBe(false);
      expect(fastFloodFill(spec, 'front', 0, 8, 'x', 'x')).toBe(false);
      expect(fastFloodFill(spec, 'front', 8, 0, 'x', 'x')).toBe(false);
    });

    it('fastFloodFill on complex maze/checkerboard geometry isolates connected components accurately', () => {
      // U-shaped wall
      const front = [
        'xxxx',
        'x..x',
        'x..x',
        'xxxx'
      ].join('\n');
      const back = [
        'yyyy',
        'y..y',
        'y..y',
        'yyyy'
      ].join('\n');
      const side = '....\n....\n....\n....';

      const spec = { front, back, side };

      // Flood fill the 2x2 interior with 'z'
      fastFloodFill(spec, 'front', 1, 1, 'z', 'z');

      expect(spec.front.split('\n')).toEqual([
        'xxxx',
        'xzzx',
        'xzzx',
        'xxxx'
      ]);

      // Back interior was '.' so it fills with paletteColorChar 'z'
      expect(spec.back.split('\n')).toEqual([
        'yyyy',
        'yzzy',
        'yzzy',
        'yyyy'
      ]);
    });

    it('reconcileSilhouette reconciles asymmetrical front/back silhouettes perfectly', () => {
      const front = [
        '..xx..',
        '..xx..',
        'xxxxxx',
        '..xx..'
      ];
      const back = [
        '......',
        '..yy..',
        '..yy..',
        '..yy..'
      ];

      const reconciled = reconcileSilhouette(front, back, 'z');

      expect(reconciled).toEqual([
        '..xx..', // Front has 'xx', back had '.', back filled with front 'xx'
        '..yy..', // Both had non-empty, back keeps 'yy'
        'xxyyxx', // Front has 'xxxxxx', back had '..yy..', front char 'x' used for missing parts
        '..yy..'  // Both had non-empty
      ]);
    });
  });

  // =========================================================================
  // 2. PALETTE ADVERSARIAL STRESS: HEX, ALPHA, DUPLICATES, REPLACEMENTS
  // =========================================================================
  describe('2. Palette & Color Management Edge Cases', () => {
    it('isValidHex supports 6-digit #RRGGBB and 8-digit #RRGGBBAA and rejects malformed strings', () => {
      // Valid 6-digit
      expect(isValidHex('#000000')).toBe(true);
      expect(isValidHex('#ffffff')).toBe(true);
      expect(isValidHex('#123456')).toBe(true);
      expect(isValidHex('#abcdef')).toBe(true);
      expect(isValidHex('#ABCDEF')).toBe(true);
      expect(isValidHex(' #66D9A3 ')).toBe(true);

      // Valid 8-digit with alpha
      expect(isValidHex('#00000000')).toBe(true);
      expect(isValidHex('#ffffffff')).toBe(true);
      expect(isValidHex('#12345678')).toBe(true);
      expect(isValidHex('#ABCDEF80')).toBe(true);
      expect(isValidHex('#66D9A3FF')).toBe(true);

      // Invalid lengths and chars
      expect(isValidHex('')).toBe(false);
      expect(isValidHex('#')).toBe(false);
      expect(isValidHex('#12')).toBe(false);
      expect(isValidHex('#123')).toBe(false);
      expect(isValidHex('#1234')).toBe(false);
      expect(isValidHex('#12345')).toBe(false);
      expect(isValidHex('#1234567')).toBe(false);
      expect(isValidHex('#123456789')).toBe(false);
      expect(isValidHex('123456')).toBe(false); // missing #
      expect(isValidHex('#GGG000')).toBe(false); // non-hex
      expect(isValidHex('#12345Z')).toBe(false);
      expect(isValidHex('#1234567Z')).toBe(false);
    });

    it('paletteHex formats strings, [r,g,b] arrays, and [r,g,b,a] arrays with float or integer alpha', () => {
      expect(paletteHex('#ff00aa')).toBe('#ff00aa');
      expect(paletteHex('ff00aa')).toBe('#ff00aa');
      expect(paletteHex('#FF00AA80')).toBe('#ff00aa80');

      // RGB array
      expect(paletteHex([255, 0, 128])).toBe('#ff0080');
      expect(paletteHex([0, 255, 0])).toBe('#00ff00');

      // RGBA array with float alpha [0.0, 1.0]
      expect(paletteHex([255, 0, 128, 0.5])).toBe('#ff008080');
      expect(paletteHex([255, 255, 255, 1.0])).toBe('#ffffffff');
      expect(paletteHex([0, 0, 0, 0.0])).toBe('#00000000');

      // RGBA array with int alpha [0, 255]
      expect(paletteHex([255, 0, 128, 128])).toBe('#ff008080');
      expect(paletteHex([0, 0, 0, 255])).toBe('#000000ff');

      // Out of bounds array values get clamped
      expect(paletteHex([-10, 300, 100])).toBe('#00ff64');
    });

    it('replaceColorInPart replaces characters safely and acts as no-op when fromChar == toChar', () => {
      const part = {
        front: 'x.x\n.x.\nx.x',
        back: 'y.y\n.y.\ny.y',
        side: 'x.y\n.x.\ny.x'
      };

      // No-op when fromChar === toChar
      replaceColorInPart(part, 'x', 'x');
      expect(part.front).toBe('x.x\n.x.\nx.x');

      // Replace 'x' with 'z'
      replaceColorInPart(part, 'x', 'z');
      expect(part.front).toBe('z.z\n.z.\nz.z');
      expect(part.back).toBe('y.y\n.y.\ny.y'); // back was 'y', unchanged
      expect(part.side).toBe('z.y\n.z.\ny.z');

      // Replace non-existent char is safe no-op
      replaceColorInPart(part, 'w', 'q');
      expect(part.front).toBe('z.z\n.z.\nz.z');
    });
  });

  // =========================================================================
  // 3. TIMELINE & KEYFRAME CLEANUP ADVERSARIAL STRESS
  // =========================================================================
  describe('3. Timeline & Track Sanitization Edge Cases', () => {
    it('cleanAnimationTracks prunes empty keyframe arrays and empty bone/ik track containers', () => {
      const doc = {
        animations: {
          walk: {
            frames: 8,
            fps: 10,
            loop: true,
            bones: {
              root: {
                translation: [], // Empty track: should be deleted
                rotation: [{ frame: 0, value: [0, 0, 0] }]
              },
              arm: {
                rotation: [] // Only track is empty: entire 'arm' bone entry should be deleted
              }
            },
            ik: {
              leg_ik: {
                target: [], // Empty track: should be deleted
                pole: [{ frame: 0, value: [0, 5, 0] }]
              },
              foot_ik: {
                target: [] // Only track empty: entire 'foot_ik' chain entry should be deleted
              }
            }
          }
        }
      };

      cleanAnimationTracks(doc);

      // root should retain rotation and have translation pruned
      expect(doc.animations.walk.bones.root).toBeDefined();
      expect(doc.animations.walk.bones.root.rotation).toBeDefined();
      expect(doc.animations.walk.bones.root.translation).toBeUndefined();

      // arm should be deleted completely
      expect(doc.animations.walk.bones.arm).toBeUndefined();

      // leg_ik should retain pole and have target pruned
      expect(doc.animations.walk.ik.leg_ik).toBeDefined();
      expect(doc.animations.walk.ik.leg_ik.pole).toBeDefined();
      expect(doc.animations.walk.ik.leg_ik.target).toBeUndefined();

      // foot_ik should be deleted completely
      expect(doc.animations.walk.ik.foot_ik).toBeUndefined();
    });

    it('cleanAnimationTracks handles null doc, missing animations, and empty clips safely without throwing', () => {
      expect(() => cleanAnimationTracks(null)).not.toThrow();
      expect(() => cleanAnimationTracks({})).not.toThrow();
      expect(() => cleanAnimationTracks({ animations: {} })).not.toThrow();
      expect(() => cleanAnimationTracks({ animations: { empty: null } })).not.toThrow();
      expect(() => cleanAnimationTracks({ animations: { empty: { bones: null, ik: null } } })).not.toThrow();
    });
  });

  // =========================================================================
  // 4. PERSISTENCE & SCHEMA VALIDATION ADVERSARIAL STRESS
  // =========================================================================
  describe('4. Persistence & Schema Validation Resilience', () => {
    it('validateProject detects dangling palette references, mismatched dimensions, and cycles', () => {
      const doc = starterProject();
      expect(() => validateProject(doc)).not.toThrow();

      // Dangling palette character 'z' in grid
      const badDoc = starterProject();
      badDoc.parts.part.front = '....\n..z.\n....\n....';
      expect(() => validateProject(badDoc)).toThrow(ProjectError);

      // Non-square grid
      const nonSquareDoc = starterProject();
      nonSquareDoc.parts.part.front = '....\n...\n....\n....';
      expect(() => validateProject(nonSquareDoc)).toThrow(ProjectError);

      // Empty palette
      const emptyPaletteDoc = starterProject();
      emptyPaletteDoc.palette = {};
      expect(() => validateProject(emptyPaletteDoc)).toThrow(ProjectError);

      // Unknown bone in IK chain
      const badIKDoc = starterProject();
      badIKDoc.rig.ik_chains = {
        bad_chain: { root: 'nonexistent', mid: 'root', end: 'root' }
      };
      expect(() => validateProject(badIKDoc)).toThrow(ProjectError);
    });

    it('autorigProjectFallback generates valid rig schema for all 3 presets (humanoid, quadruped, creature)', () => {
      for (const preset of ['humanoid', 'quadruped', 'creature'] as const) {
        const base = starterProject();
        const autorigged = autorigProjectFallback(base, preset);
        expect(() => validateProject(autorigged)).not.toThrow();
        expect(Object.keys(autorigged.rig.bones).length).toBeGreaterThan(0);
      }

      // Invalid preset throws ProjectError
      const base = starterProject();
      expect(() => autorigProjectFallback(base, 'invalid_preset')).toThrow(ProjectError);
    });
  });
});
