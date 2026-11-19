import { describe, expect, it } from 'vitest';
import { overlay, ProjectError, render, validateProject } from './engine';
import { starterProject } from './runtime';
import { setupTestEnvironment } from './test-helpers';
import type { ProjectDocument } from './types';

function createVoxelDoc(front: string, back: string, side: string, pivot?: [number, number, number]): ProjectDocument {
  const doc = starterProject('voxel_test');
  doc.palette = {
    r: '#ff0000',
    g: '#00ff00',
    b: '#0000ff',
    x: '#ffffff',
  };
  doc.parts.part = {
    front,
    back,
    side,
    ...(pivot ? { pivot } : {}),
  };
  return doc;
}

describe('Voxelizer & ASCII Grid Silhouette Parity (validateProject)', () => {
  it('validates matching front/back silhouettes with different colors', () => {
    // Front has red, back has green, but same non-empty silhouette
    const doc = createVoxelDoc(
      '....\n.rr.\n.rr.\n....',
      '....\n.gg.\n.gg.\n....',
      '....\n.bb.\n.bb.\n....'
    );
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('rejects front/back silhouette mismatch where front is filled and back is empty', () => {
    const doc = createVoxelDoc(
      '.rr.\n.rr.',
      '.r..\n.rr.', // row 1, col 3 is '.' in back but 'r' in front
      '....\n....'
    );
    expect(() => validateProject(doc)).toThrow(ProjectError);
    expect(() => validateProject(doc)).toThrow(/front\/back silhouettes differ at row 1, column 3/);
  });

  it('rejects front/back silhouette mismatch where front is empty and back is filled', () => {
    const doc = createVoxelDoc(
      '....\n.rr.',
      '.r..\n.rr.', // row 1, col 2 is '.' in front but 'r' in back
      '....\n....'
    );
    expect(() => validateProject(doc)).toThrow(ProjectError);
    expect(() => validateProject(doc)).toThrow(/front\/back silhouettes differ at row 1, column 2/);
  });

  it('rejects ragged rows in ASCII grids', () => {
    const docFrontRagged = createVoxelDoc(
      '...\n....',
      '....\n....',
      '..\n..'
    );
    expect(() => validateProject(docFrontRagged)).toThrow(/front has ragged rows/);

    const docSideRagged = createVoxelDoc(
      '....\n....',
      '....\n....',
      '..\n...'
    );
    expect(() => validateProject(docSideRagged)).toThrow(/side has ragged rows/);
  });

  it('rejects empty multiline strings for view grids', () => {
    const docEmpty = createVoxelDoc('', '', '');
    expect(() => validateProject(docEmpty)).toThrow(/front cannot be empty/);
  });

  it('rejects dimension mismatch between front and back views', () => {
    const docWidthMismatch = createVoxelDoc(
      '....\n....',
      '...\n...', // width 3 vs 4
      '..\n..'
    );
    expect(() => validateProject(docWidthMismatch)).toThrow(/front and back views must have equal dimensions/);

    const docHeightMismatch = createVoxelDoc(
      '....\n....',
      '....\n....\n....', // height 3 vs 2
      '..\n..'
    );
    expect(() => validateProject(docHeightMismatch)).toThrow(/front and back views must have equal dimensions/);
  });

  it('rejects height mismatch between front/back and side views', () => {
    const docHeightMismatch = createVoxelDoc(
      '....\n....',
      '....\n....',
      '..\n..\n..' // height 3 vs 2
    );
    expect(() => validateProject(docHeightMismatch)).toThrow(/front, back, and side views must have equal heights/);
  });

  it('rejects unknown palette characters in front, back, or side views with row and col', () => {
    const docUnknownFront = createVoxelDoc(
      '....\n.rz.', // 'z' is not in palette
      '....\n.rr.',
      '....\n.rr.'
    );
    expect(() => validateProject(docUnknownFront)).toThrow(
      /parts\.part\.front uses unknown palette character 'z' at row 2, column 3/
    );

    const docUnknownBack = createVoxelDoc(
      '....\n.rr.',
      '....\n.rq.', // 'q' is not in palette
      '....\n.rr.'
    );
    expect(() => validateProject(docUnknownBack)).toThrow(
      /parts\.part\.back uses unknown palette character 'q' at row 2, column 3/
    );

    const docUnknownSide = createVoxelDoc(
      '....\n.rr.',
      '....\n.rr.',
      '....\n.ru.' // 'u' is not in palette
    );
    expect(() => validateProject(docUnknownSide)).toThrow(
      /parts\.part\.side uses unknown palette character 'u' at row 2, column 3/
    );
  });
});

describe('Voxel 3D Reconstruction & Rendering (render & overlay)', () => {
  it('renders single 1x1x1 voxel model without errors', () => {
    setupTestEnvironment();
    const doc = createVoxelDoc('x', 'x', 'x');
    expect(() => validateProject(doc)).not.toThrow();

    const canvas = render(doc, 'idle', 0, 0);
    expect(canvas).toBeDefined();
    expect(canvas.width).toBe(96);
    expect(canvas.height).toBe(96);
  });

  it('rejects empty voxel model during validation', () => {
    setupTestEnvironment();
    const doc = createVoxelDoc(
      '..\n..',
      '..\n..',
      '..\n..'
    );
    expect(() => validateProject(doc)).toThrow(/parts\.part produces no voxels/);
  });

  it('renders at multiple camera yaw angles (0, 45, 90, 180, 270, 315)', () => {
    setupTestEnvironment();
    const doc = createVoxelDoc(
      '.xx.\n.xx.',
      '.xx.\n.xx.',
      '.xx.\n.xx.'
    );

    const angles = [0, 45, 90, 135, 180, 225, 270, 315];
    for (const yaw of angles) {
      const canvas = render(doc, 'idle', 0, yaw);
      expect(canvas).toBeDefined();
    }
  });

  it('renders specific part isolation mode', () => {
    setupTestEnvironment();
    const doc = createVoxelDoc(
      '.xx.\n.xx.',
      '.xx.\n.xx.',
      '.xx.\n.xx.'
    );
    const canvas = render(doc, undefined, 0, 45, 'part', 128);
    expect(canvas).toBeDefined();
    expect(canvas.width).toBe(128);
    expect(canvas.height).toBe(128);
  });

  it('generates 2D viewport overlay metadata for bone projection', () => {
    setupTestEnvironment();
    const doc = createVoxelDoc(
      '.xx.\n.xx.',
      '.xx.\n.xx.',
      '.xx.\n.xx.'
    );
    doc.rig.bones = {
      root: { translation: [0, 10, 0] },
      head: { parent: 'root', translation: [0, 5, 0] },
    };

    const ov = overlay(doc, 'idle', 0, 45);
    expect(ov.width).toBe(96);
    expect(ov.height).toBe(96);
    expect(ov.bones.length).toBe(2);

    const rootBone = ov.bones.find(b => b.name === 'root')!;
    const headBone = ov.bones.find(b => b.name === 'head')!;
    expect(rootBone).toBeDefined();
    expect(headBone).toBeDefined();
    expect(headBone.parent).toBe('root');
    expect(Number.isFinite(rootBone.x)).toBe(true);
    expect(Number.isFinite(rootBone.y)).toBe(true);
    expect(Number.isFinite(rootBone.depth)).toBe(true);
    // head is above root (+Y in world maps to lower y in 2D canvas top-down coords)
    expect(headBone.y).toBeLessThan(rootBone.y);
  });
});
