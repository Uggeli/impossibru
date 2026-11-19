import { describe, expect, it } from 'vitest';
import { metadata, ProjectError, validateProject } from './engine';
import { starterProject } from './runtime';
import type { ProjectDocument } from './types';

describe('Project Schema Validation & Backwards Compatibility (validateProject)', () => {
  it('validates a freshly generated starter project', () => {
    const doc = starterProject('hero');
    expect(validateProject(doc)).toBe(doc);
  });

  it('handles missing export.animations by defaulting to all available animations', () => {
    const doc = starterProject('hero');
    doc.animations.walk = { frames: 12, fps: 12, loop: true, bones: {}, ik: {} };
    delete doc.export?.animations;

    expect(() => validateProject(doc)).not.toThrow();
    const meta = metadata(doc);
    expect(Object.keys(meta.animations)).toEqual(['idle', 'walk']);
  });

  it('handles missing optional export fields with standard defaults', () => {
    const doc = starterProject('hero');
    delete doc.export;

    expect(() => validateProject(doc)).not.toThrow();
    const meta = metadata(doc);
    expect(meta.image).toBe('sprite.png');
    expect(meta.frame_size).toEqual({ w: 96, h: 96 });
    expect(meta.animations.idle.directions.length).toBe(8);
  });

  it('handles missing optional animation clip fields (loop, bones, ik)', () => {
    const doc = starterProject('hero');
    doc.animations.idle = {
      frames: 6,
      fps: 10,
    };
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('handles missing optional part pivot', () => {
    const doc = starterProject('hero');
    delete doc.parts.part.pivot;
    expect(() => validateProject(doc)).not.toThrow();
  });
});

describe('Schema Rejection on Corrupt / Invalid Projects', () => {
  it('rejects non-object or null root documents', () => {
    expect(() => validateProject(null as any)).toThrow(/project root must be a mapping/);
    expect(() => validateProject(undefined as any)).toThrow(/project root must be a mapping/);
    expect(() => validateProject('not an object' as any)).toThrow(/project root must be a mapping/);
    expect(() => validateProject(123 as any)).toThrow(/project root must be a mapping/);
    expect(() => validateProject([] as any)).toThrow(ProjectError);
  });

  it('rejects missing or empty palette', () => {
    const docNoPalette = starterProject();
    delete (docNoPalette as any).palette;
    expect(() => validateProject(docNoPalette)).toThrow(/palette must be a non-empty mapping/);

    const docEmptyPalette = starterProject();
    docEmptyPalette.palette = {};
    expect(() => validateProject(docEmptyPalette)).toThrow(/palette must be a non-empty mapping/);
  });

  it('rejects invalid palette keys (dot, multi-char, empty)', () => {
    const docDot = starterProject();
    docDot.palette['.'] = '#ffffff';
    expect(() => validateProject(docDot)).toThrow(/palette keys must be single characters other than '\.'/);

    const docMulti = starterProject();
    docMulti.palette['xx'] = '#ffffff';
    expect(() => validateProject(docMulti)).toThrow(/palette keys must be single characters other than '\.'/);
  });

  it('rejects missing or empty parts', () => {
    const docNoParts = starterProject();
    delete (docNoParts as any).parts;
    expect(() => validateProject(docNoParts)).toThrow(/parts must be a non-empty mapping/);

    const docEmptyParts = starterProject();
    docEmptyParts.parts = {};
    expect(() => validateProject(docEmptyParts)).toThrow(/parts must be a non-empty mapping/);
  });

  it('rejects non-string or empty parts view grids', () => {
    const docNonString = starterProject();
    (docNonString.parts.part as any).front = 123;
    expect(() => validateProject(docNonString)).toThrow(/parts\.part\.front must be a multiline string/);

    const docEmptyView = starterProject();
    docEmptyView.parts.part.front = '';
    expect(() => validateProject(docEmptyView)).toThrow(/parts\.part\.front cannot be empty/);
  });

  it('rejects ragged rows in part views', () => {
    const doc = starterProject();
    doc.parts.part.front = '....\n...\n....';
    expect(() => validateProject(doc)).toThrow(/parts\.part\.front has ragged rows/);
  });

  it('rejects mismatched dimensions between views', () => {
    const docWidth = starterProject();
    docWidth.parts.part.back = '...\n...\n...\n...';
    expect(() => validateProject(docWidth)).toThrow(/front and back views must have equal dimensions/);

    const docHeight = starterProject();
    docHeight.parts.part.side = '....\n....\n....';
    expect(() => validateProject(docHeight)).toThrow(/front, back, and side views must have equal heights/);
  });

  it('rejects unknown palette characters in parts grids with location info', () => {
    const doc = starterProject();
    doc.parts.part.front = '....\n....\n.qx.\n.xx.';
    expect(() => validateProject(doc)).toThrow(/parts\.part\.front uses unknown palette character 'q' at row 3, column 2/);
  });

  it('rejects silhouette mismatches between front and back views with location info', () => {
    const doc = starterProject();
    doc.parts.part.front = '....\n....\n.xx.\n.xx.';
    doc.parts.part.back = '....\n....\n.x..\n.xx.';
    expect(() => validateProject(doc)).toThrow(/parts\.part: front\/back silhouettes differ at row 3, column 3/);
  });

  it('rejects invalid part pivot values', () => {
    const docNotArray = starterProject();
    (docNotArray.parts.part as any).pivot = 'center';
    expect(() => validateProject(docNotArray)).toThrow(/parts\.part\.pivot must be a 3-number list/);

    const docWrongLen = starterProject();
    (docWrongLen.parts.part as any).pivot = [1, 2];
    expect(() => validateProject(docWrongLen)).toThrow(/parts\.part\.pivot must be a 3-number list/);

    const docNaN = starterProject();
    (docNaN.parts.part as any).pivot = [1, NaN, 2];
    expect(() => validateProject(docNaN)).toThrow(/parts\.part\.pivot must be a 3-number list/);
  });

  it('rejects missing or empty rig.bones', () => {
    const docNoRig = starterProject();
    delete (docNoRig as any).rig;
    expect(() => validateProject(docNoRig)).toThrow(/rig\.bones must be a non-empty mapping/);

    const docEmptyBones = starterProject();
    docEmptyBones.rig.bones = {};
    expect(() => validateProject(docEmptyBones)).toThrow(/rig\.bones must be a non-empty mapping/);
  });

  it('rejects missing parent bone reference', () => {
    const doc = starterProject();
    doc.rig.bones.arm = { parent: 'non_existent_bone' };
    expect(() => validateProject(doc)).toThrow(/bone 'arm' references missing parent 'non_existent_bone'/);
  });

  it('rejects parent cycles in rig hierarchy', () => {
    // Direct 2-bone cycle
    const docDirect = starterProject();
    docDirect.rig.bones = {
      boneA: { parent: 'boneB' },
      boneB: { parent: 'boneA' },
    };
    expect(() => validateProject(docDirect)).toThrow(/rig has a parent cycle involving/);

    // Self cycle
    const docSelf = starterProject();
    docSelf.rig.bones = {
      boneA: { parent: 'boneA' },
    };
    expect(() => validateProject(docSelf)).toThrow(/rig has a parent cycle involving 'boneA'/);

    // 3-bone cycle
    const docChain = starterProject();
    docChain.rig.bones = {
      b1: { parent: 'b2' },
      b2: { parent: 'b3' },
      b3: { parent: 'b1' },
    };
    expect(() => validateProject(docChain)).toThrow(/rig has a parent cycle involving/);
  });

  it('rejects bone referencing non-existent part', () => {
    const doc = starterProject();
    doc.rig.bones.root.part = 'non_existent_part';
    expect(() => validateProject(doc)).toThrow(/rig\.bones\.root references missing part 'non_existent_part'/);
  });

  it('rejects missing or empty animations mapping', () => {
    const docNoAnim = starterProject();
    delete (docNoAnim as any).animations;
    expect(() => validateProject(docNoAnim)).toThrow(/animations must be a non-empty mapping/);

    const docEmptyAnim = starterProject();
    docEmptyAnim.animations = {};
    expect(() => validateProject(docEmptyAnim)).toThrow(/animations must be a non-empty mapping/);
  });

  it('rejects invalid animation frames count (0, negative, float, string)', () => {
    const docZero = starterProject();
    docZero.animations.idle.frames = 0;
    expect(() => validateProject(docZero)).toThrow(/animations\.idle\.frames must be a positive integer/);

    const docNeg = starterProject();
    docNeg.animations.idle.frames = -5;
    expect(() => validateProject(docNeg)).toThrow(/animations\.idle\.frames must be a positive integer/);

    const docFloat = starterProject();
    docFloat.animations.idle.frames = 4.5;
    expect(() => validateProject(docFloat)).toThrow(/animations\.idle\.frames must be a positive integer/);

    const docStr = starterProject();
    (docStr.animations.idle as any).frames = '8';
    expect(() => validateProject(docStr)).toThrow(/animations\.idle\.frames must be a positive integer/);
  });

  it('rejects non-positive animation fps (0, negative, NaN)', () => {
    const docZeroFps = starterProject();
    docZeroFps.animations.idle.fps = 0;
    expect(() => validateProject(docZeroFps)).toThrow(/animations\.idle\.fps must be positive/);

    const docNegFps = starterProject();
    docNegFps.animations.idle.fps = -10;
    expect(() => validateProject(docNegFps)).toThrow(/animations\.idle\.fps must be positive/);

    const docNaNFps = starterProject();
    docNaNFps.animations.idle.fps = NaN;
    expect(() => validateProject(docNaNFps)).toThrow(/animations\.idle\.fps must be positive/);
  });

  it('rejects animation bone track referencing missing bone', () => {
    const doc = starterProject();
    doc.animations.idle.bones = {
      missing_bone: { translation: [{ frame: 0, value: [0, 0, 0] }] },
    };
    expect(() => validateProject(doc)).toThrow(/animations\.idle\.bones references invalid bone 'missing_bone'/);
  });

  it('rejects animation IK track referencing missing IK chain', () => {
    const doc = starterProject();
    doc.animations.idle.ik = {
      missing_chain: { target: [{ frame: 0, value: [0, 0, 0] }] },
    };
    expect(() => validateProject(doc)).toThrow(/animations\.idle\.ik references invalid chain 'missing_chain'/);
  });

  it('rejects export.animations referencing non-existent animation', () => {
    const doc = starterProject();
    doc.export = {
      ...doc.export,
      animations: ['idle', 'walk_non_existent'],
    };
    expect(() => validateProject(doc)).toThrow(/export\.animations references missing animation 'walk_non_existent'/);
  });

  it('rejects empty export.animations list', () => {
    const doc = starterProject();
    doc.export = {
      ...doc.export,
      animations: [],
    };
    expect(() => validateProject(doc)).toThrow(/export\.animations must be a non-empty animation-name list/);
  });
});
