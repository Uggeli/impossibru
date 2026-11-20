import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { browserRequest, exportProjectZip, packageExportZip, recoverDraft, starterProject } from './runtime';
import { setupTestEnvironment } from './test-helpers';
import { validateProject } from './engine';

describe('Starter Project Generator (starterProject)', () => {
  it('generates a valid, complete starter project with default name', () => {
    const doc = starterProject();
    expect(doc.export?.name).toBe('sprite');
    expect(Object.keys(doc.palette)).toEqual(['x']);
    expect(Object.keys(doc.parts)).toEqual(['part']);
    expect(Object.keys(doc.rig.bones)).toEqual(['root']);
    expect(Object.keys(doc.animations)).toEqual(['idle']);
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('generates a starter project with custom character name', () => {
    const doc = starterProject('goblin');
    expect(doc.export?.name).toBe('goblin');
    expect(() => validateProject(doc)).not.toThrow();
  });
});

describe('Browser API Client Router (browserRequest)', () => {
  it('handles GET /api/project returning current project document and summary', async () => {
    setupTestEnvironment();
    const res = await browserRequest('/api/project');
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.source_hash).toBe('browser');
    expect(payload.document).toBeDefined();
    expect(payload.summary.parts).toContain('part');
    expect(payload.summary.clips.idle).toBeDefined();
  });

  it('handles POST /api/project/new creating and persisting new project file', async () => {
    setupTestEnvironment();
    const res = await browserRequest('/api/project/new', {
      method: 'POST',
      body: JSON.stringify({ filename: 'wizard.yaml' }),
    });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.summary.path).toBe('wizard.yaml');
    expect(payload.document.export.name).toBe('wizard');
    expect(() => validateProject(payload.document)).not.toThrow();
  });

  it('handles POST /api/validate without changing the recovery draft', async () => {
    const previous = starterProject('previous');
    const store = setupTestEnvironment().idbStore;
    store.set('current', {document:previous,time:3});
    const doc = starterProject('validate_test');
    const res = await browserRequest('/api/validate', {
      body: JSON.stringify({ document: doc }),
    });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.valid).toBe(true);
    expect(payload.summary.bones).toContain('root');
    expect(store.get('current')).toEqual({document:previous,time:3});
  });

  it('handles POST /api/preview returning canvas dataUrl for character and part modes', async () => {
    setupTestEnvironment();
    const doc = starterProject('preview_test');

    // Character mode
    const resChar = await browserRequest('/api/preview', {
      body: JSON.stringify({
        document: doc,
        mode: 'character',
        clip: 'idle',
        frame: 0,
        direction: 0,
      }),
    });
    expect(resChar.status).toBe(200);
    const charPayload = await resChar.json();
    expect(charPayload.dataUrl).toContain('data:image/png;base64,');

    // Part mode
    const resPart = await browserRequest('/api/preview', {
      body: JSON.stringify({
        document: doc,
        mode: 'part',
        part: 'part',
        frame: 0,
        direction: 45,
      }),
    });
    expect(resPart.status).toBe(200);
    const partPayload = await resPart.json();
    expect(partPayload.dataUrl).toContain('data:image/png;base64,');
  });

  it('handles POST /api/rig/preview returning PNG base64 and overlay geometry', async () => {
    setupTestEnvironment();
    const doc = starterProject('rig_preview_test');
    const res = await browserRequest('/api/rig/preview', {
      body: JSON.stringify({
        document: doc,
        mode: 'animate',
        clip: 'idle',
        frame: 0,
        direction: 0,
      }),
    });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(typeof payload.png).toBe('string');
    expect(payload.overlay).toBeDefined();
    expect(payload.overlay.bones.length).toBeGreaterThan(0);
  });

  it('handles POST /api/rig/drag for rest joint translation', async () => {
    setupTestEnvironment();
    const doc = starterProject('joint_drag');
    const res = await browserRequest('/api/rig/drag', {
      body: JSON.stringify({
        document: doc,
        kind: 'joint',
        mode: 'rest',
        name: 'root',
        screen: [48, 88],
        depth: 0,
        direction: 0,
      }),
    });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.document.rig.bones.root.translation).toEqual([0, 0, 0]);
  });

  it('handles POST /api/rig/reparent', async () => {
    setupTestEnvironment();
    const doc = starterProject('reparent_test');
    doc.rig.bones = {
      root: { translation: [0, 0, 0] },
      arm: { translation: [5, 0, 0] },
    };

    const res = await browserRequest('/api/rig/reparent', {
      body: JSON.stringify({
        document: doc,
        bone: 'arm',
        parent: 'root',
      }),
    });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.document.rig.bones.arm.parent).toBe('root');
  });

  it('handles PUT /api/project dumping project to YAML and downloading', async () => {
    setupTestEnvironment();
    const doc = starterProject('put_test');
    const res = await browserRequest('/api/project', {
      method: 'PUT',
      body: JSON.stringify({ document: doc }),
    });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.saved).toBe(true);
    expect(payload.source_hash).toBe('browser');
  });

  it('returns 404 for unknown endpoints', async () => {
    setupTestEnvironment();
    const res = await browserRequest('/api/non_existent');
    expect(res.status).toBe(404);
    const payload = await res.json();
    expect(payload.error.message).toContain('unknown browser endpoint');
  });

  it('returns 422 with structured error details on validation failure', async () => {
    setupTestEnvironment();
    const corruptDoc = starterProject('corrupt');
    corruptDoc.parts.part.front = '....\n....\n.zz.\n.zz.'; // 'z' unknown

    const res = await browserRequest('/api/validate', {
      body: JSON.stringify({ document: corruptDoc }),
    });
    expect(res.status).toBe(422);
    const payload = await res.json();
    expect(payload.valid).toBe(false);
    expect(payload.error).toBeDefined();
    expect(payload.error.message).toContain("unknown palette character 'z'");
    expect(payload.error.row).toBe(3);
    expect(payload.error.column).toBe(2);
  });
});

describe('Draft Persistence & Recovery (recoverDraft)', () => {
  it('returns false when no draft exists in IndexedDB', async () => {
    setupTestEnvironment();
    const recovered = await recoverDraft();
    expect(recovered).toBe(false);
  });

  it('successfully recovers draft saved in IndexedDB into sessionStorage', async () => {
    const { idbStore } = setupTestEnvironment();
    const doc = starterProject('persisted_hero');
    idbStore.set('current', { document: doc, time: Date.now() });

    const recovered = await recoverDraft();
    expect(recovered).toBe(true);
    expect(sessionStorage.getItem('impossibru-project')).toContain('persisted_hero');
  });
});

describe('Project Export (exportProjectZip)', () => {
  it('exports project atlas, metadata JSON, and YAML bundle into ZIP', async () => {
    setupTestEnvironment();
    const doc = starterProject('export_bundle');
    let maxProgress = 0;

    await exportProjectZip(doc, (p: number) => {
      maxProgress = Math.max(maxProgress, p);
    });

    expect(maxProgress).toBe(100);
  });
});

describe('packageExportZip', () => {
  it('zips the supplied PNG and metadata verbatim', async () => {
    setupTestEnvironment();
    let blob: any;
    (globalThis as any).URL.createObjectURL = (b: Blob) => { blob = b; return 'blob:x'; };
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    packageExportZip(starterProject('server_made'), png, { size: { w: 4, h: 5 } }, false);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Array.from(files['server_made.png'])).toEqual(Array.from(png));
    expect(JSON.parse(new TextDecoder().decode(files['server_made.json']))).toEqual({ size: { w: 4, h: 5 } });
    expect(files['server_made.yaml']).toBeDefined();
    expect(files['player/index.html']).toBeUndefined();
  });
});
