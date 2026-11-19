import yaml from 'js-yaml';
import { zipSync, strToU8 } from 'fflate';
import {
  inverseRigid,
  metadata,
  mv,
  overlay,
  pose,
  ProjectError,
  render,
  reparent,
  validateProject,
} from './engine';
import type { ProjectDocument } from './types';

let handle: any = null;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function starterProject(name = 'sprite'): ProjectDocument {
  return {
    palette: { x: '#66D9A3' },
    parts: {
      part: {
        pivot: [1.5, 0, 1.5],
        front: '....\n....\n.xx.\n.xx.',
        back: '....\n....\n.xx.\n.xx.',
        side: '....\n....\n.xx.\n.xx.',
      },
    },
    rig: {
      bones: { root: { part: 'part' } },
      ik_chains: {},
    },
    animations: {
      idle: { frames: 8, fps: 10, loop: true, bones: {}, ik: {} },
    },
    export: {
      name,
      size: [96, 96],
      scale: 3,
      origin: [48, 88],
      directions: [0, 45, 90, 135, 180, 225, 270, 315],
      animations: ['idle'],
      background: [0, 0, 0, 0],
    },
  };
}

function current(): ProjectDocument {
  const j = sessionStorage.getItem('impossibru-project');
  if (j) return JSON.parse(j);
  const y = sessionStorage.getItem('impossibru-yaml');
  if (y) {
    const d = yaml.load(y) as ProjectDocument;
    sessionStorage.setItem('impossibru-project', JSON.stringify(d));
    return d;
  }
  return starterProject();
}

const response = (body: any, status = 200, type = 'application/json') =>
  new Response(type === 'application/json' ? JSON.stringify(body) : body, {
    status,
    headers: { 'Content-Type': type },
  });

const errorInfo = (e: any) => {
  const message = e.message || String(e),
    m = message.match(/((?:palette|parts|rig|animations|export)(?:\.[\w-]+)*)/),
    r = message.match(/row (\d+)/),
    c = message.match(/column (\d+)/);
  return {
    message,
    ...(m ? { path: m[1] } : {}),
    ...(r ? { row: +r[1] } : {}),
    ...(c ? { column: +c[1] } : {}),
  };
};

async function draft(d: ProjectDocument) {
  sessionStorage.setItem('impossibru-project', JSON.stringify(d));
  const db = await new Promise<IDBDatabase>((ok, no) => {
    const q = indexedDB.open('impossibru', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('drafts');
    q.onsuccess = () => ok(q.result);
    q.onerror = () => no(q.error);
  });
  db.transaction('drafts', 'readwrite')
    .objectStore('drafts')
    .put({ document: d, time: Date.now() }, 'current');
}

export function autorigProjectFallback(
  d: ProjectDocument,
  preset = 'humanoid'
): ProjectDocument {
  const result = clone(d);
  const partNames = Object.keys(result.parts || {});
  if (!partNames.length) {
    throw new ProjectError('parts must be a non-empty mapping');
  }

  const pLower = preset.toLowerCase();
  if (!['humanoid', 'quadruped', 'creature'].includes(pLower)) {
    throw new ProjectError(
      `unknown autorig preset: '${preset}' (expected humanoid, quadruped, or creature)`
    );
  }

  const bones: Record<string, any> = {};
  const ik_chains: Record<string, any> = {};

  const findPart = (...candidates: string[]): string | undefined => {
    for (const c of candidates) {
      const match = partNames.find((p) =>
        p.toLowerCase().includes(c.toLowerCase())
      );
      if (match) return match;
    }
    return undefined;
  };

  const torsoPart = findPart('torso', 'body', 'chest') || partNames[0];
  const headPart = findPart('head');
  const leftArmPart = findPart('left_arm', 'l_arm', 'arm_l', 'arm');
  const rightArmPart = findPart('right_arm', 'r_arm', 'arm_r');
  const leftLegPart = findPart('left_leg', 'l_leg', 'leg_l', 'leg');
  const rightLegPart = findPart('right_leg', 'r_leg', 'leg_r');

  if (pLower === 'humanoid') {
    bones.root = {
      part: torsoPart,
      translation: [0, 0, 0],
      rotation: [0, 0, 0],
    };
    bones.torso = {
      parent: 'root',
      translation: [0, 0, 0],
      rotation: [0, 0, 0],
    };
    if (headPart) {
      bones.head = {
        parent: 'torso',
        part: headPart,
        translation: [0, 10, 0],
        rotation: [0, 0, 0],
      };
    }
    bones.left_upper_arm = {
      parent: 'torso',
      translation: [5, 8, 0],
      rotation: [0, 0, 0],
    };
    bones.left_lower_arm = {
      parent: 'left_upper_arm',
      part: leftArmPart,
      translation: [0, -5, 0],
      rotation: [0, 0, 0],
    };
    bones.right_upper_arm = {
      parent: 'torso',
      translation: [-5, 8, 0],
      rotation: [0, 0, 0],
    };
    bones.right_lower_arm = {
      parent: 'right_upper_arm',
      part: rightArmPart,
      translation: [0, -5, 0],
      rotation: [0, 0, 0],
    };

    bones.left_upper_leg = {
      parent: 'root',
      translation: [3, 0, 0],
      rotation: [0, 0, 0],
    };
    bones.left_lower_leg = {
      parent: 'left_upper_leg',
      translation: [0, -6, 0],
      rotation: [0, 0, 0],
    };
    bones.left_foot = {
      parent: 'left_lower_leg',
      part: leftLegPart,
      translation: [0, -4, 0],
      rotation: [0, 0, 0],
    };

    bones.right_upper_leg = {
      parent: 'root',
      translation: [-3, 0, 0],
      rotation: [0, 0, 0],
    };
    bones.right_lower_leg = {
      parent: 'right_upper_leg',
      translation: [0, -6, 0],
      rotation: [0, 0, 0],
    };
    bones.right_foot = {
      parent: 'right_lower_leg',
      part: rightLegPart,
      translation: [0, -4, 0],
      rotation: [0, 0, 0],
    };

    ik_chains.left_leg = {
      root: 'left_upper_leg',
      mid: 'left_lower_leg',
      end: 'left_foot',
    };
    ik_chains.right_leg = {
      root: 'right_upper_leg',
      mid: 'right_lower_leg',
      end: 'right_foot',
    };
  } else if (pLower === 'quadruped') {
    bones.root = {
      part: torsoPart,
      translation: [0, 0, 0],
      rotation: [0, 0, 0],
    };
    bones.torso = {
      parent: 'root',
      translation: [0, 0, 0],
      rotation: [0, 0, 0],
    };
    if (headPart) {
      bones.head = {
        parent: 'torso',
        part: headPart,
        translation: [0, 6, 6],
        rotation: [0, 0, 0],
      };
    }
    bones.front_left_upper_leg = {
      parent: 'torso',
      translation: [4, 0, 5],
      rotation: [0, 0, 0],
    };
    bones.front_left_lower_leg = {
      parent: 'front_left_upper_leg',
      translation: [0, -5, 0],
      rotation: [0, 0, 0],
    };
    bones.front_left_foot = {
      parent: 'front_left_lower_leg',
      part: leftArmPart || leftLegPart,
      translation: [0, -3, 0],
      rotation: [0, 0, 0],
    };

    bones.front_right_upper_leg = {
      parent: 'torso',
      translation: [-4, 0, 5],
      rotation: [0, 0, 0],
    };
    bones.front_right_lower_leg = {
      parent: 'front_right_upper_leg',
      translation: [0, -5, 0],
      rotation: [0, 0, 0],
    };
    bones.front_right_foot = {
      parent: 'front_right_lower_leg',
      part: rightArmPart || rightLegPart,
      translation: [0, -3, 0],
      rotation: [0, 0, 0],
    };

    bones.back_left_upper_leg = {
      parent: 'root',
      translation: [4, 0, -5],
      rotation: [0, 0, 0],
    };
    bones.back_left_lower_leg = {
      parent: 'back_left_upper_leg',
      translation: [0, -5, 0],
      rotation: [0, 0, 0],
    };
    bones.back_left_foot = {
      parent: 'back_left_lower_leg',
      part: leftLegPart,
      translation: [0, -3, 0],
      rotation: [0, 0, 0],
    };

    bones.back_right_upper_leg = {
      parent: 'root',
      translation: [-4, 0, -5],
      rotation: [0, 0, 0],
    };
    bones.back_right_lower_leg = {
      parent: 'back_right_upper_leg',
      translation: [0, -5, 0],
      rotation: [0, 0, 0],
    };
    bones.back_right_foot = {
      parent: 'back_right_lower_leg',
      part: rightLegPart,
      translation: [0, -3, 0],
      rotation: [0, 0, 0],
    };

    ik_chains.front_left_leg = {
      root: 'front_left_upper_leg',
      mid: 'front_left_lower_leg',
      end: 'front_left_foot',
    };
    ik_chains.front_right_leg = {
      root: 'front_right_upper_leg',
      mid: 'front_right_lower_leg',
      end: 'front_right_foot',
    };
    ik_chains.back_left_leg = {
      root: 'back_left_upper_leg',
      mid: 'back_left_lower_leg',
      end: 'back_left_foot',
    };
    ik_chains.back_right_leg = {
      root: 'back_right_upper_leg',
      mid: 'back_right_lower_leg',
      end: 'back_right_foot',
    };
  } else {
    // creature
    bones.root = {
      part: torsoPart,
      translation: [0, 0, 0],
      rotation: [0, 0, 0],
    };
    bones.torso = {
      parent: 'root',
      translation: [0, 0, 0],
      rotation: [0, 0, 0],
    };
    if (headPart) {
      bones.head = {
        parent: 'torso',
        part: headPart,
        translation: [0, 8, 0],
        rotation: [0, 0, 0],
      };
    }
  }

  result.rig = { bones, ik_chains };

  // Prune any tracks in animations referencing bones/chains that no longer exist
  const newBones = new Set(Object.keys(bones));
  const newChains = new Set(Object.keys(ik_chains));
  if (result.animations) {
    for (const clip of Object.values(result.animations)) {
      if (clip && typeof clip === 'object') {
        if (clip.bones && typeof clip.bones === 'object') {
          clip.bones = Object.fromEntries(
            Object.entries(clip.bones).filter(([b]) => newBones.has(b))
          );
        }
        if (clip.ik && typeof clip.ik === 'object') {
          clip.ik = Object.fromEntries(
            Object.entries(clip.ik).filter(([c]) => newChains.has(c))
          );
        }
      }
    }
  }

  return result;
}

export async function autoRig(
  d: ProjectDocument,
  preset = 'humanoid',
  requestFn: (path: string, options?: any) => Promise<Response> = browserRequest
): Promise<ProjectDocument> {
  const res = await requestFn('/api/rig/autorig', {
    method: 'POST',
    body: JSON.stringify({ document: d, preset }),
  });
  const data = await res.json();
  if (!res.ok || data.valid === false) {
    const message = data.error?.message || 'Autorig failed';
    throw new ProjectError(message);
  }
  return data.document;
}

export async function browserRequest(path: string, options: any = {}) {
  try {
    const d = options.body
      ? JSON.parse(options.body).document || current()
      : current();
    if (path === '/api/project' && !options.method)
      return response({
        document: d,
        source_hash: 'browser',
        summary: {
          path: handle?.name || 'Browser project',
          parts: Object.keys(d.parts),
          clips: Object.fromEntries(
            Object.entries(d.animations).map(([n, c]: [string, any]) => [
              n,
              { frames: c.frames, fps: c.fps, loop: c.loop !== false },
            ])
          ),
          directions: d.export?.directions || [],
          export_animations:
            d.export?.animations || Object.keys(d.animations),
        },
      });
    if (path === '/api/validate') {
      validateProject(d);
      await draft(d);
      return response({
        valid: true,
        summary: {
          parts: Object.keys(d.parts),
          bones: Object.keys(d.rig.bones),
          clips: Object.keys(d.animations),
        },
      });
    }
    if (path === '/api/preview') {
      const p = JSON.parse(options.body),
        canvas = render(
          d,
          p.mode === 'character' ? p.clip : undefined,
          p.frame,
          p.direction,
          p.mode === 'part' ? p.part : undefined,
          p.mode === 'part' ? 320 : undefined
        );
      return response({ dataUrl: canvas.toDataURL('image/png') });
    }
    if (path === '/api/rig/preview') {
      const p = JSON.parse(options.body),
        clip = p.mode === 'animate' ? p.clip : undefined,
        canvas = render(d, clip, p.frame, p.direction);
      const png = canvas.toDataURL('image/png').split(',')[1];
      return response({ png, overlay: overlay(d, clip, p.frame, p.direction) });
    }
    if (path === '/api/rig/drag') {
      const p = JSON.parse(options.body),
        ex = d.export || {},
        sc = ex.scale || 3,
        o = ex.origin || [48, 88],
        a = (p.direction * Math.PI) / 180,
        x = (p.screen[0] - o[0]) / sc,
        y = (o[1] - p.screen[1]) / sc,
        z = p.depth,
        world = [
          Math.cos(a) * x - Math.sin(a) * z,
          y,
          Math.sin(a) * x + Math.cos(a) * z,
        ];
      if (p.kind === 'joint' && p.mode === 'rest') {
        const b = d.rig.bones[p.name];
        if (!b) throw new ProjectError(`unknown bone '${p.name}'`);
        if (b.parent) {
          const worldTransforms = pose(d);
          const parentMat = worldTransforms[b.parent];
          if (parentMat) {
            const inv = inverseRigid(parentMat);
            const local = mv(inv, world);
            b.translation = [local[0], local[1], local[2]];
          } else {
            b.translation = [world[0], world[1], world[2]];
          }
        } else {
          b.translation = [world[0], world[1], world[2]];
        }
      } else if (p.kind === 'target' || p.kind === 'pole') {
        const keys =
          (((d.animations[p.clip].ik ??= {})[p.name] ??= {})[p.kind] ??= []);
        const k = keys.find((q: any) => q.frame === p.frame),
          value = world;
        k
          ? (k.value = value)
          : keys.push({ frame: p.frame, value, interpolation: 'linear' });
        keys.sort((a: any, b: any) => a.frame - b.frame);
      }
      validateProject(d);
      await draft(d);
      return response({ document: d });
    }
    if (path === '/api/rig/reparent') {
      const p = JSON.parse(options.body);
      const updated = reparent(d, p.bone, p.parent || null);
      await draft(updated);
      return response({ document: updated });
    }
    if (path === '/api/rig/autorig' || path === '/api/autorig') {
      const p = options.body ? JSON.parse(options.body) : {};
      const preset = p.preset || 'humanoid';
      const updated = autorigProjectFallback(d, preset);
      validateProject(updated);
      await draft(updated);
      return response({
        document: updated,
        project: updated,
        rig: updated.rig,
      });
    }
    if (path === '/api/project' && options.method === 'PUT') {
      validateProject(d);
      const text = yaml.dump(d, { noRefs: true, lineWidth: -1 });
      if (handle) {
        const permission = await handle.requestPermission({
          mode: 'readwrite',
        });
        if (permission !== 'granted')
          throw new ProjectError('File write permission was not granted');
        const w = await handle.createWritable();
        await w.write(text);
        await w.close();
      } else
        download(
          new Blob([text], { type: 'application/yaml' }),
          `${d.export?.name || 'project'}.yaml`
        );
      await draft(d);
      return response({ saved: true, source_hash: 'browser' });
    }
    if (path === '/api/project/new') {
      const p = JSON.parse(options.body),
        n = p.filename.replace(/\.ya?ml$/i, '');
      const nd = starterProject(n);
      await draft(nd);
      return response({
        document: nd,
        source_hash: 'browser',
        summary: { path: p.filename },
      });
    }
    return response({ error: { message: 'unknown browser endpoint' } }, 404);
  } catch (e) {
    return response({ valid: false, error: errorInfo(e) }, 422);
  }
}

export async function openProject() {
  const picker = (window as any).showOpenFilePicker;
  if (picker) {
    [handle] = await picker({
      types: [
        {
          description: 'YAML project',
          accept: { 'application/yaml': ['.yaml', '.yml'] },
        },
      ],
    });
    const file = await handle.getFile();
    sessionStorage.setItem('impossibru-yaml', await file.text());
    sessionStorage.removeItem('impossibru-project');
    return true;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.yaml,.yml';
  return new Promise<boolean>((ok) => {
    input.onchange = async () => {
      if (!input.files?.[0]) return ok(false);
      sessionStorage.setItem('impossibru-yaml', await input.files[0].text());
      sessionStorage.removeItem('impossibru-project');
      ok(true);
    };
    input.click();
  });
}

export async function recoverDraft() {
  const db = await new Promise<IDBDatabase>((ok, no) => {
    const q = indexedDB.open('impossibru', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('drafts');
    q.onsuccess = () => ok(q.result);
    q.onerror = () => no(q.error);
  });
  const v: any = await new Promise((ok) => {
    const q = db.transaction('drafts').objectStore('drafts').get('current');
    q.onsuccess = () => ok(q.result);
  });
  if (!v) return false;
  sessionStorage.setItem('impossibru-project', JSON.stringify(v.document));
  return true;
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function exportProjectZip(
  d: ProjectDocument,
  progress = (p: number) => {}
) {
  validateProject(d);
  const meta = metadata(d),
    canvas = document.createElement('canvas');
  canvas.width = meta.size.w;
  canvas.height = meta.size.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ProjectError('Atlas is too large for this browser');
  let done = 0,
    total = Object.values(meta.animations).reduce(
      (n: any, c: any) =>
        n +
        c.directions.reduce((x: number, q: any) => x + q.frames.length, 0),
      0
    ) as number;
  for (const [name, c] of Object.entries(meta.animations) as any)
    for (const dir of c.directions)
      for (const f of dir.frames) {
        ctx.drawImage(render(d, name, f.index, dir.angle), f.rect.x, f.rect.y);
        progress(Math.round((++done / total) * 90));
        await new Promise(requestAnimationFrame);
      }
  const png = await new Promise<Uint8Array>((ok, no) =>
    canvas.toBlob(
      async (b) =>
        b
          ? ok(new Uint8Array(await b.arrayBuffer()))
          : no(new ProjectError('Browser ran out of memory creating PNG')),
      'image/png'
    )
  );
  const base = d.export?.name || 'sprite',
    files: any = {
      [`${base}.png`]: png,
      [`${base}.json`]: strToU8(JSON.stringify(meta, null, 2) + '\n'),
      [`${base}.yaml`]: strToU8(yaml.dump(d, { noRefs: true, lineWidth: -1 })),
    };
  download(
    new Blob([zipSync(files)] as any, { type: 'application/zip' }),
    `${base}.zip`
  );
  progress(100);
}
