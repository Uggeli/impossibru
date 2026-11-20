import './style.css';
import { offersSilhouetteSync, paletteCharError, partKeyDisplay } from './editorrules';
import { load as parseYaml } from 'js-yaml';
import { activeParts, validateProject } from './engine';
import { setProjectHandle, readDraft, persistDraft, autoRig, browserRequest, exportProjectZip, packageExportZip, openProject, recoverDraft, starterProject } from './runtime';
import {
  bresenhamLine,
  rectPoints,
  canvasCell,
  fastFloodFill,
  reconcileSilhouette,
  isValidHex,
  paletteHex
} from './canvas';
import {
  modalAlert,
  modalConfirm,
  modalPrompt,
  modalColorReplace
} from './modal';
import type { PartSpec, Color } from './types';
import { isGridPart, gridFromSpec, encodeGrid, getSlice, setSlice, resizeGrid3, usesChar, replaceCharInPart } from './voxelgrid';

const token = typeof location !== 'undefined' ? (new URLSearchParams(location.search).get('token') || '') : '';
const $ = (id: string): any => document.getElementById(id);
const clone = (value: any) => JSON.parse(JSON.stringify(value));
const defaultDirections = [0, 45, 90, 135, 180, 225, 270, 315];
const entries = (value: any): [string, any][] => Object.entries(value || {}) as [string, any][];
const values = (value: any): any[] => Object.values(value || {}) as any[];
const apiHeaders = { 'Content-Type': 'application/json', 'X-SpriteBuilder-Token': token };

const state: any = {
  doc: null, sourceHash: '', summary: null, part: null, color: null, tool: 'pencil', mode: 'part',
  mirror: false, slice: 0,
  revision: 0, dirty: false, valid: false, error: null, errorInfo: null, history: [], future: [],
  drawing: false, dragStart: null, dragCurrent: null, dragView: null,
  hoverView: null, hoverX: -1, hoverY: -1, lastCell: null,
  previewTimer: null, validateTimer: null, previewUrl: null, rigUrl: null, playing: null,
  workspace: 'parts', selectedBone: null, selectedChain: null, selectedClip: null,
  selectedTrack: 'rotation', overlay: null,
  mutedTracks: new Set<string>()
};

export function cleanAnimationTracks(doc: any) {
  if (!doc?.animations) return;
  for (const clip of Object.values(doc.animations) as any[]) {
    if (!clip) continue;
    if (clip.bones) {
      for (const [boneName, boneTracks] of Object.entries(clip.bones) as [string, any][]) {
        if (!boneTracks || typeof boneTracks !== 'object') continue;
        for (const [trackName, keys] of Object.entries(boneTracks) as [string, any][]) {
          if (Array.isArray(keys) && keys.length === 0) {
            delete boneTracks[trackName];
          }
        }
        if (Object.keys(boneTracks).length === 0) {
          delete clip.bones[boneName];
        }
      }
    }
    if (clip.ik) {
      for (const [chainName, ikTracks] of Object.entries(clip.ik) as [string, any][]) {
        if (!ikTracks || typeof ikTracks !== 'object') continue;
        for (const [trackName, keys] of Object.entries(ikTracks) as [string, any][]) {
          if (Array.isArray(keys) && keys.length === 0) {
            delete ikTracks[trackName];
          }
        }
        if (Object.keys(ikTracks).length === 0) {
          delete clip.ik[chainName];
        }
      }
    }
  }
}

function isGridSelected(): boolean {
  const part = state.doc?.parts?.[state.part];
  return !!part && isGridPart(part);
}
function clampSlice() {
  const part = state.doc?.parts?.[state.part];
  const h = part && isGridPart(part) ? part.size[1] : 1;
  state.slice = Math.max(0, Math.min(h - 1, Math.floor(+state.slice || 0)));
}
function rows(view: string): string[] {
  if (view === 'slice') {
    clampSlice();
    return getSlice(gridFromSpec(selectedSpec() as any), state.slice);
  }
  return state.doc.parts[state.part][view].replace(/^\n|\n$/g, '').split('\n');
}
function setRows(view: string, value: string[]) {
  if (view === 'slice') {
    const spec = selectedSpec() as any, g = gridFromSpec(spec);
    if (value.length !== g.d || value.some(r => r.length !== g.w)) return;
    spec.voxels = encodeGrid(setSlice(g, state.slice, value));
    return;
  }
  state.doc.parts[state.part][view] = value.join('\n');
}
function isSplit(): boolean {
  return 'left' in selectedSpec();
}
function sideView(): string {
  return isSplit() ? 'left' : 'side';
}
function selectedSpec(): PartSpec {
  return state.doc.parts[state.part];
}

async function request(path: string, options: any = {}) {
  const response = !token ? await browserRequest(path, options) : await fetch(path, { ...options, headers: { ...apiHeaders, ...(options.headers || {}) } });
  if (!response.ok) {
    let body = { error: { message: `Request failed (${response.status})` } };
    try { body = await response.json(); } catch (_) {}
    const error: any = new Error(body.error?.message || 'Request failed');
    error.body = body;
    error.status = response.status;
    throw error;
  }
  return response;
}

async function load() {
  try {
    const payload = await (await request('/api/project')).json();
    state.doc = payload.document;
    cleanAnimationTracks(state.doc);
    state.sourceHash = payload.source_hash;
    state.summary = payload.summary;
    state.part = Object.keys(state.doc.parts)[0];
    state.color = Object.keys(state.doc.palette)[0];
    state.selectedBone = Object.keys(state.doc.rig?.bones || {})[0] || null;
    state.selectedClip = Object.keys(state.doc.animations || {})[0] || null;
    $('filePath').textContent = payload.summary.path;
    $('status').textContent = 'Ready';
    renderAll();
    await validateAndPreview();
  } catch (error: any) {
    showError(error.message);
  }
}

function checkpoint() {
  state.history.push({
    doc: clone(state.doc),
    part: state.part,
    color: state.color,
    bone: state.selectedBone,
    chain: state.selectedChain,
    clip: state.selectedClip,
    mirror: state.mirror
  });
  if (state.history.length > 100) state.history.shift();
  state.future = [];
}

function restore(snapshot: any) {
  state.doc = snapshot.doc;
  state.part = snapshot.part;
  state.color = snapshot.color;
  state.selectedBone = snapshot.bone || Object.keys(state.doc.rig?.bones || {})[0] || null;
  state.selectedChain = snapshot.chain;
  state.selectedClip = snapshot.clip || Object.keys(state.doc.animations || {})[0] || null;
  if (snapshot.mirror !== undefined) state.mirror = snapshot.mirror;
  changed();
}

function snapshot() {
  return {
    doc: clone(state.doc),
    part: state.part,
    color: state.color,
    bone: state.selectedBone,
    chain: state.selectedChain,
    clip: state.selectedClip,
    mirror: state.mirror
  };
}

function undo() {
  if (!state.history.length) return;
  state.future.push(snapshot());
  restore(state.history.pop());
}

function redo() {
  if (!state.future.length) return;
  state.history.push(snapshot());
  restore(state.future.pop());
}

function changed() {
  changedPreviewOnly();
  renderAll();
}

function changedPreviewOnly() {
  state.revision++;
  state.valid = false;
  state.dirty = true;
  $('status').textContent = 'Unsaved changes';
  $('saveButton').disabled = true;
  $('exportZipButton').disabled = true;
  clearTimeout(state.validateTimer);
  state.validateTimer = setTimeout(validateAndPreview, 180);
}

function renderAll() {
  renderParts();
  renderPalette();
  renderDimensions();
  renderCanvases();
  renderPreviewControls();

  renderRig();
  updateButtons();
}

function renderParts() {
  const list = $('partList');
  list.replaceChildren();
  Object.keys(state.doc.parts).forEach(name => {
    const button = document.createElement('button');
    button.className = 'part-item' + (name === state.part ? ' active' : '');
    button.textContent = name;
    button.onclick = () => {
      state.part = name;
      renderAll();
      schedulePreview();
    };
    list.append(button);
  });
}

function reorderPalette(char: string, direction: -1 | 1) {
  const keys = Object.keys(state.doc.palette);
  const idx = keys.indexOf(char);
  if (idx < 0) return;
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= keys.length) return;

  checkpoint();
  keys.splice(idx, 1);
  keys.splice(targetIdx, 0, char);

  const newPalette: Record<string, Color> = {};
  for (const k of keys) {
    newPalette[k] = state.doc.palette[k];
  }
  state.doc.palette = newPalette;
  changed();
}

async function replaceColorPrompt(char: string) {
  const res = await modalColorReplace({
    palette: state.doc.palette,
    currentPart: state.part,
    currentColor: state.color,
    fromChar: char
  });
  if (!res || !res.fromChar || !res.toChar || res.fromChar === res.toChar) return;

  checkpoint();
  if (res.scope === 'part') {
    replaceCharInPart(state.doc.parts[state.part], res.fromChar, res.toChar);
  } else {
    Object.values(state.doc.parts).forEach(part => {
      replaceCharInPart(part as PartSpec, res.fromChar, res.toChar);
    });
  }
  renderCanvases();
  changed();
}

function renderPalette() {
  const list = $('paletteList');
  list.replaceChildren();
  entries(state.doc.palette).forEach(([char, value]) => {
    const item = document.createElement('div');
    item.className = 'swatch' + (char === state.color ? ' active' : '');

    // 1. Native Color Picker
    const colorPicker = document.createElement('input');
    colorPicker.type = 'color';
    colorPicker.className = 'swatch-picker';
    colorPicker.value = paletteHex(value).slice(0, 7);
    colorPicker.title = 'Pick Color';
    colorPicker.onpointerdown = () => checkpoint();
    colorPicker.oninput = () => {
      state.doc.palette[char] = colorPicker.value;
      hexInput.value = colorPicker.value;
      renderCanvases();
      changedPreviewOnly();
    };
    colorPicker.onchange = () => renderPalette();

    // 2. Direct Hex Text Input
    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'swatch-hex';
    hexInput.maxLength = 9;
    hexInput.spellcheck = false;
    hexInput.title = 'Hex code (#RRGGBB or #RRGGBBAA)';
    hexInput.value = paletteHex(value);

    hexInput.oninput = () => {
      let raw = hexInput.value.trim();
      if (!raw.startsWith('#') && (raw.length === 6 || raw.length === 8)) {
        raw = '#' + raw;
      }
      if (isValidHex(raw)) {
        hexInput.classList.remove('invalid');
        state.doc.palette[char] = raw.toLowerCase();
        colorPicker.value = raw.slice(0, 7);
        renderCanvases();
        changedPreviewOnly();
      } else {
        hexInput.classList.add('invalid');
      }
    };

    hexInput.onblur = () => {
      let raw = hexInput.value.trim();
      if (!raw.startsWith('#') && (raw.length === 6 || raw.length === 8)) {
        raw = '#' + raw;
      }
      if (isValidHex(raw)) {
        checkpoint();
        state.doc.palette[char] = raw.toLowerCase();
        changed();
      } else {
        hexInput.value = paletteHex(state.doc.palette[char]);
        hexInput.classList.remove('invalid');
      }
    };

    // 3. Symbol Button
    const symbol = document.createElement('button');
    symbol.className = 'icon swatch-char';
    symbol.textContent = char;
    symbol.title = `Select '${char}' as active color`;
    symbol.onclick = () => {
      state.color = char;
      renderPalette();
    };

    // 4. Move Up Button
    const moveUp = document.createElement('button');
    moveUp.className = 'icon swatch-move-up';
    moveUp.textContent = '▲';
    moveUp.title = 'Move color up';
    moveUp.onclick = (e) => {
      e.stopPropagation();
      reorderPalette(char, -1);
    };

    // 5. Move Down Button
    const moveDown = document.createElement('button');
    moveDown.className = 'icon swatch-move-down';
    moveDown.textContent = '▼';
    moveDown.title = 'Move color down';
    moveDown.onclick = (e) => {
      e.stopPropagation();
      reorderPalette(char, 1);
    };

    // 6. Replace Color Button
    const replaceBtn = document.createElement('button');
    replaceBtn.className = 'icon swatch-replace';
    replaceBtn.textContent = '⇄';
    replaceBtn.title = 'Replace color across part or all';
    replaceBtn.onclick = (e) => {
      e.stopPropagation();
      replaceColorPrompt(char);
    };

    // 7. Rename Symbol Button
    const rename = document.createElement('button');
    rename.className = 'icon swatch-rename';
    rename.textContent = '✎';
    rename.title = 'Rename symbol';
    rename.onclick = (e) => {
      e.stopPropagation();
      renameColor(char);
    };

    // 8. Delete Color Button
    const remove = document.createElement('button');
    remove.className = 'icon swatch-delete';
    remove.textContent = '×';
    remove.title = 'Delete color';
    remove.onclick = (e) => {
      e.stopPropagation();
      deleteColor(char);
    };

    symbol.className = 'color-tile swatch-char';
    symbol.style.backgroundColor = paletteHex(value);
    symbol.setAttribute('aria-pressed', String(char === state.color));
    item.append(symbol);
    if (char === state.color) $('paletteEditor').replaceChildren(colorPicker, hexInput, moveUp, moveDown, replaceBtn, rename, remove);
    item.onclick = (e) => {
      if (e.target === item) {
        state.color = char;
        renderPalette();
      }
    };
    list.append(item);
  });
}

function renderDimensions() {
  if (isGridSelected()) {
    const [w, h, d] = (selectedSpec() as any).size;
    $('partWidth').value = w;
    $('partHeight').value = h;
    $('partDepth').value = d;
    return;
  }
  const front = rows('front'), side = rows(sideView());
  $('partWidth').value = front[0].length;
  $('partHeight').value = front.length;
  $('partDepth').value = side[0].length;
}

function renderCanvases() {
  const grid = isGridSelected();
  const split = !grid && isSplit();
  document.querySelectorAll<HTMLElement>('.views article[data-kind]').forEach(a => {
    a.hidden = (a.dataset.kind === 'grid') !== grid || (a.dataset.sides === 'single' && split) || (a.dataset.sides === 'split' && !split);
  });
  $('syncSilhouette').hidden = grid;
  $('separateSidesLabel').hidden = grid;
  $('separateSides').checked = split;
  if (grid) {
    clampSlice();
    const h = (selectedSpec() as any).size[1];
    const range = $('sliceIndex');
    range.max = String(h - 1);
    range.value = String(state.slice);
    $('sliceLabel').textContent = `Slice ${state.slice + 1} / ${h}`;
    drawCanvas('slice');
    return;
  }
  (split ? ['front', 'left', 'right', 'back'] : ['front', 'side', 'back']).forEach(drawCanvas);
}

function goToSlice(y: number) {
  if (!isGridSelected()) return;
  const before = state.slice;
  state.slice = y;
  clampSlice();
  if (state.slice === before) return;
  renderCanvases();
  schedulePreview();
}

function drawCanvas(view: string) {
  const canvas = $(view + 'Canvas') as HTMLCanvasElement;
  if (!canvas) return;
  const grid = rows(view);
  const cols = grid[0].length;
  const rowsCount = grid.length;
  const available = canvas.parentElement!.clientWidth - 26;
  const cell = Math.max(3, Math.floor(Math.min(available / cols, 320 / rowsCount)));
  const dpr = window.devicePixelRatio || 1;

  const logicalWidth = cols * cell;
  const logicalHeight = rowsCount * cell;

  // High-DPI Resolution Scaling
  canvas.width = Math.round(logicalWidth * dpr);
  canvas.height = Math.round(logicalHeight * dpr);
  canvas.style.width = logicalWidth + 'px';
  canvas.style.height = logicalHeight + 'px';
  canvas.dataset.cell = String(cell);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Background
  ctx.fillStyle = '#0e1015';
  ctx.fillRect(0, 0, logicalWidth, logicalHeight);

  // Ghost of the slice below (onion skin)
  if (view === 'slice' && ($('sliceGhost') as HTMLInputElement).checked && state.slice > 0) {
    const below = getSlice(gridFromSpec(selectedSpec() as any), state.slice - 1);
    ctx.save();
    ctx.globalAlpha = 0.25;
    below.forEach((row, y) => [...row].forEach((char, x) => {
      if (char === '.') return;
      ctx.fillStyle = paletteHex(state.doc.palette[char] || '#ff00ff');
      ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
    }));
    ctx.restore();
  }

  // Voxel Grid Cells
  grid.forEach((row, y) => [...row].forEach((char, x) => {
    if (char !== '.') {
      ctx.fillStyle = paletteHex(state.doc.palette[char] || '#ff00ff');
      ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
    }
    ctx.strokeStyle = '#303543';
    ctx.lineWidth = 1;
    ctx.strokeRect(x * cell + 0.5, y * cell + 0.5, cell, cell);
  }));

  // Mirror Mode Vertical Symmetry Guideline
  if (state.mirror) {
    const midX = (cols * cell) / 2;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#66d9a3';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(midX, 0);
    ctx.lineTo(midX, logicalHeight);
    ctx.stroke();
    ctx.restore();
  }

  // Interactive Drag Previews (Line & Rect tools)
  if (state.drawing && state.dragStart && state.dragCurrent && state.dragView === view) {
    const [x0, y0] = state.dragStart;
    const [x1, y1] = state.dragCurrent;
    let previewPts: Array<[number, number]> = [];

    if (state.tool === 'line') {
      previewPts = bresenhamLine(x0, y0, x1, y1);
    } else if (state.tool === 'rect') {
      previewPts = rectPoints(x0, y0, x1, y1, false);
    }

    ctx.save();
    const fillStyle = paletteHex(state.color ? state.doc.palette[state.color] : '#66d9a3');
    ctx.fillStyle = fillStyle;
    ctx.globalAlpha = 0.55;
    previewPts.forEach(([px, py]) => {
      if (px >= 0 && px < cols && py >= 0 && py < rowsCount) {
        ctx.fillRect(px * cell + 1, py * cell + 1, cell - 2, cell - 2);
        if (state.mirror) {
          const mx = cols - 1 - px;
          if (mx >= 0 && mx < cols) {
            ctx.fillRect(mx * cell + 1, py * cell + 1, cell - 2, cell - 2);
          }
        }
      }
    });
    ctx.restore();
  }

  // Hover Brush Cursor Indicator
  if (state.hoverView === view && state.hoverX >= 0 && state.hoverX < cols && state.hoverY >= 0 && state.hoverY < rowsCount && !state.drawing) {
    const hx = state.hoverX;
    const hy = state.hoverY;
    const drawCursor = (cx: number, cy: number) => {
      ctx.save();
      if (state.tool === 'eraser') {
        ctx.fillStyle = 'rgba(237, 106, 115, 0.25)';
        ctx.fillRect(cx * cell + 1, cy * cell + 1, cell - 2, cell - 2);
        ctx.strokeStyle = '#ed6a73';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cx * cell + 1, cy * cell + 1, cell - 2, cell - 2);
      } else if (state.tool === 'eyedropper') {
        ctx.strokeStyle = '#66d9a3';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cx * cell + 0.5, cy * cell + 0.5, cell, cell);
      } else {
        const hex = state.color ? paletteHex(state.doc.palette[state.color]) : '#66d9a3';
        ctx.fillStyle = hex;
        ctx.globalAlpha = 0.3;
        ctx.fillRect(cx * cell + 1, cy * cell + 1, cell - 2, cell - 2);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#66d9a3';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cx * cell + 1, cy * cell + 1, cell - 2, cell - 2);
      }
      ctx.restore();
    };

    drawCursor(hx, hy);
    if (state.mirror && (cols - 1 - hx) !== hx) {
      drawCursor(cols - 1 - hx, hy);
    }
  }

  // Coordinate HUD Overlay
  if (state.hoverView === view && state.hoverX >= 0 && state.hoverY >= 0) {
    let hudText = `X: ${state.hoverX}  Y: ${state.hoverY}  [${cols}×${rowsCount}]`;
    if (state.drawing && state.dragStart && state.dragCurrent && state.dragView === view) {
      const dx = Math.abs(state.dragCurrent[0] - state.dragStart[0]) + 1;
      const dy = Math.abs(state.dragCurrent[1] - state.dragStart[1]) + 1;
      hudText = `X: ${state.dragCurrent[0]}  Y: ${state.dragCurrent[1]}  Δ(${dx}, ${dy})`;
    }
    ctx.save();
    ctx.font = '10px ui-monospace, monospace';
    const textMetrics = ctx.measureText(hudText);
    const boxW = textMetrics.width + 10;
    const boxH = 16;
    const posX = 4;
    const posY = logicalHeight - boxH - 4;

    ctx.fillStyle = 'rgba(16, 18, 24, 0.85)';
    ctx.fillRect(posX, posY, boxW, boxH);
    ctx.strokeStyle = '#343947';
    ctx.lineWidth = 1;
    ctx.strokeRect(posX + 0.5, posY + 0.5, boxW, boxH);

    ctx.fillStyle = '#e8eaf0';
    ctx.textBaseline = 'middle';
    ctx.fillText(hudText, posX + 5, posY + boxH / 2);
    ctx.restore();
  }

  // Silhouette & Schema Error Highlight Box
  const info = state.errorInfo;
  let isError = false;
  if (info && info.row && info.column) {
    const partPath = `parts.${state.part}`;
    const viewPath = `parts.${state.part}.${view}`;
    if (info.path === viewPath) {
      isError = true;
    } else if (info.path === partPath && (view === 'front' || view === 'back') && (info.message?.includes('silhouette') || state.error?.includes('silhouette'))) {
      isError = true;
    }
  }

  if (isError && info.column <= cols && info.row <= rowsCount) {
    const ex = (info.column - 1) * cell;
    const ey = (info.row - 1) * cell;
    ctx.save();
    ctx.fillStyle = 'rgba(237, 106, 115, 0.35)';
    ctx.fillRect(ex + 1, ey + 1, cell - 2, cell - 2);
    ctx.strokeStyle = '#ff5964';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(ex + 1, ey + 1, cell - 2, cell - 2);
    ctx.restore();
  }
}

function renderPreviewControls() {
  document.querySelectorAll<HTMLElement>('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === state.mode));
  $('animationControls').classList.toggle('hidden', state.mode !== 'character');
  const clip = $('clip');
  clip.replaceChildren();
  entries(state.doc.animations || {}).forEach(([name]) => {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    clip.append(o);
  });
  clip.value = state.selectedClip;
  const spec = state.doc.animations?.[clip.value];
  if (spec) {
    $('frame').max = spec.frames - 1;
    if (+$('frame').value >= spec.frames) $('frame').value = 0;
    $('frameValue').value = $('frame').value;
    $('timeValue').value = 'Frame ' + $('frame').value;
  }
  $('yawValue').value = $('yaw').value + '°';
}

function updateButtons() {
  $('undoButton').disabled = !state.history.length;
  $('redoButton').disabled = !state.future.length;
  $('undoButtonRig').disabled = !state.history.length;
  $('redoButtonRig').disabled = !state.future.length;
  $('saveButton').disabled = !state.dirty || !state.valid;
  $('exportZipButton').disabled = !state.valid;
  $('mirrorToggle')?.classList.toggle('active', !!state.mirror);
}

function ensureExportSettings() {
  state.doc.export ??= {};
  state.doc.export.directions ??= [...defaultDirections];
  return state.doc.export;
}
function selectedExportAnimations() {
  return ensureExportSettings().animations || Object.keys(state.doc.animations);
}

let exportChoice: { animations: string[]; directions: number[] };
function renderExportSettings() {
  const clips = $('exportAnimations');
  const angles = $('exportDirections');
  clips.replaceChildren();
  angles.replaceChildren();
  for (const name of Object.keys(state.doc.animations)) {
    const label = document.createElement('label'), check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = exportChoice.animations.includes(name);
    check.onchange = () => {
      exportChoice.animations = check.checked ? [...exportChoice.animations,name] : exportChoice.animations.filter(item => item !== name);
      $('confirmExport').disabled = !exportChoice.animations.length || !exportChoice.directions.length;
    };
    label.append(check, name);
    clips.append(label);
  }
  for (const angle of exportChoice.directions) {
    const remove = document.createElement('button');
    remove.textContent = angle + '° ×';
    remove.title = 'Remove direction';
    remove.setAttribute('aria-label', 'Remove direction ' + angle + ' degrees');
    remove.onclick = () => {
      if (exportChoice.directions.length === 1) {
        $('exportError').textContent = 'Select at least one export direction.';
        return;
      }
      exportChoice.directions = exportChoice.directions.filter(value => value !== angle);
      $('exportError').textContent = '';
      renderExportSettings();
    };
    const chip = document.createElement('span');
    chip.className = 'direction-chip';
    chip.append(remove);
    angles.append(chip);
  }
  $('confirmExport').disabled = !exportChoice.animations.length || !exportChoice.directions.length;
}
function addExportDirection() {
  const input = $('exportAngle');
  if (!Number.isFinite(input.valueAsNumber)) {
    $('exportError').textContent = 'Enter a direction in degrees.';
    return;
  }
  const angle = ((input.valueAsNumber % 360) + 360) % 360;
  if (exportChoice.directions.some(value => ((value % 360) + 360) % 360 === angle)) {
    $('exportError').textContent = 'Direction already selected.';
    return;
  }
  exportChoice.directions.push(angle);
  input.value = '';
  $('exportError').textContent = '';
  renderExportSettings();
}

function writeCell(view: string, x: number, y: number, char: string) {
  const grid = rows(view);
  if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) return false;
  const line = [...grid[y]], previous = line[x];
  if (previous === char) return false;
  line[x] = char;
  grid[y] = line.join('');
  setRows(view, grid);

  if (view === 'front' || view === 'back' || view === 'left' || view === 'right') {
    const other = { front: 'back', back: 'front', left: 'right', right: 'left' }[view]!, og = rows(other), ol = [...og[y]];
    if (char === '.') ol[x] = '.';
    else if (ol[x] === '.') ol[x] = state.color;
    og[y] = ol.join('');
    setRows(other, og);
  }
  return true;
}

function floodFillRows(x: number, y: number, char: string) {
  const g = rows('slice').map(r => [...r]);
  if (y < 0 || y >= g.length || x < 0 || x >= g[0].length) return;
  const target = g[y][x];
  if (target === char) return;
  const stack: Array<[number, number]> = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop()!;
    if (cy < 0 || cy >= g.length || cx < 0 || cx >= g[0].length || g[cy][cx] !== target) continue;
    g[cy][cx] = char;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  setRows('slice', g.map(r => r.join('')));
}

function applySingleTool(view: string, x: number, y: number) {
  const grid = rows(view);
  const cols = grid[0].length;

  if (state.tool === 'eyedropper') {
    const char = grid[y]?.[x];
    if (char && char !== '.' && state.doc.palette[char]) {
      state.color = char;
      state.tool = 'pencil';
      document.querySelectorAll<HTMLElement>('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === 'pencil'));
      renderPalette();
      renderCanvases();
    }
    return;
  }

  if (state.tool === 'replace') {
    const targetChar = grid[y]?.[x];
    if (targetChar && targetChar !== '.' && targetChar !== state.color) {
      checkpoint();
      replaceCharInPart(state.doc.parts[state.part], targetChar, state.color);
      renderCanvases();
      changed();
    }
    return;
  }

  const char = state.tool === 'eraser' ? '.' : state.color;

  if (state.tool === 'fill') {
    checkpoint();
    const fill = view === 'slice' ? floodFillRows : (px: number, py: number) => fastFloodFill(state.doc.parts[state.part], view as any, px, py, char, state.color);
    fill(x, y, char);
    if (state.mirror) {
      const mx = cols - 1 - x;
      if (mx !== x) fill(mx, y, char);
    }
    renderCanvases();
    changed();
    return;
  }

  // Pencil / Eraser single cell
  writeCell(view, x, y, char);
  if (state.mirror) {
    const mx = cols - 1 - x;
    if (mx !== x) {
      writeCell(view, mx, y, char);
    }
  }
  renderCanvases();
  changedPreviewOnly();
}

function bindCanvas(view: string) {
  const canvas = $(view + 'Canvas') as HTMLCanvasElement;
  if (!canvas) return;

  canvas.onpointerdown = (e) => {
    const grid = rows(view);
    const cols = grid[0].length;
    const rowsCount = grid.length;
    const [x, y] = canvasCell(e, canvas, cols, rowsCount);
    canvas.setPointerCapture(e.pointerId);

    if (state.tool === 'eyedropper' || state.tool === 'replace' || state.tool === 'fill') {
      applySingleTool(view, x, y);
      return;
    }

    checkpoint();
    state.drawing = true;
    state.dragStart = [x, y];
    state.dragCurrent = [x, y];
    state.dragView = view;
    state.lastCell = [x, y];

    if (state.tool === 'pencil' || state.tool === 'eraser') {
      const char = state.tool === 'eraser' ? '.' : state.color;
      writeCell(view, x, y, char);
      if (state.mirror) {
        const mx = cols - 1 - x;
        if (mx !== x) writeCell(view, mx, y, char);
      }
      renderCanvases();
      changedPreviewOnly();
    } else {
      drawCanvas(view);
    }
  };

  canvas.onpointermove = (e) => {
    const grid = rows(view);
    const cols = grid[0].length;
    const rowsCount = grid.length;
    const [x, y] = canvasCell(e, canvas, cols, rowsCount);

    state.hoverView = view;
    state.hoverX = x;
    state.hoverY = y;

    if (state.drawing && state.dragView === view) {
      if (state.tool === 'line' || state.tool === 'rect') {
        state.dragCurrent = [x, y];
        drawCanvas(view);
      } else if (state.tool === 'pencil' || state.tool === 'eraser') {
        if (state.lastCell) {
          const pts = bresenhamLine(state.lastCell[0], state.lastCell[1], x, y);
          const char = state.tool === 'eraser' ? '.' : state.color;
          pts.forEach(([px, py]) => {
            writeCell(view, px, py, char);
            if (state.mirror) {
              const mx = cols - 1 - px;
              if (mx !== px) writeCell(view, mx, py, char);
            }
          });
          state.lastCell = [x, y];
          renderCanvases();
          changedPreviewOnly();
        }
      }
    } else {
      drawCanvas(view);
    }
  };

  canvas.onpointerup = (e) => {
    if (state.drawing && state.dragView === view) {
      const grid = rows(view);
      const cols = grid[0].length;
      const rowsCount = grid.length;
      const [x, y] = canvasCell(e, canvas, cols, rowsCount);
      state.dragCurrent = [x, y];

      if (state.tool === 'line' && state.dragStart) {
        const pts = bresenhamLine(state.dragStart[0], state.dragStart[1], state.dragCurrent[0], state.dragCurrent[1]);
        const char = state.color;
        pts.forEach(([px, py]) => {
          writeCell(view, px, py, char);
          if (state.mirror) {
            const mx = cols - 1 - px;
            if (mx !== px) writeCell(view, mx, py, char);
          }
        });
        changed();
      } else if (state.tool === 'rect' && state.dragStart) {
        const pts = rectPoints(state.dragStart[0], state.dragStart[1], state.dragCurrent[0], state.dragCurrent[1], false);
        const char = state.color;
        pts.forEach(([px, py]) => {
          writeCell(view, px, py, char);
          if (state.mirror) {
            const mx = cols - 1 - px;
            if (mx !== px) writeCell(view, mx, py, char);
          }
        });
        changed();
      } else if (state.tool === 'pencil' || state.tool === 'eraser') {
        changed();
      }

      state.drawing = false;
      state.dragStart = null;
      state.dragCurrent = null;
      state.dragView = null;
      state.lastCell = null;
      updateButtons();
      renderCanvases();
    }
  };

  canvas.onpointerleave = () => {
    if (!state.drawing) {
      state.hoverView = null;
      state.hoverX = -1;
      state.hoverY = -1;
      drawCanvas(view);
    }
  };
}

function syncSilhouette() {
  checkpoint();
  const f = rows('front');
  const b = rows('back');
  const fallback = state.color || Object.keys(state.doc.palette)[0];
  const newBack = reconcileSilhouette(f, b, fallback);
  setRows('back', newBack);
  changed();
  clearError();
  validateAndPreview();
}

function validName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name);
}
function uniqueName(base: string): string {
  let name = base, n = 2;
  while (state.doc.parts[name]) name = base + '_' + n++;
  return name;
}

async function addPart() {
  const name = await modalPrompt({
    title: 'New Part',
    defaultValue: uniqueName('part'),
    placeholder: 'part_name',
    validate: (v) => !validName(v) ? 'Use letters, numbers, _ or - (starting with letter/_)' : state.doc.parts[v] ? 'A part with this name already exists' : null
  });
  if (!name) return;

  checkpoint();
  const c = state.color, w = 8, h = 8, d = 8;
  const blank = (n: number) => '.'.repeat(n);
  const f = Array(h).fill(0).map(() => blank(w)), s = Array(h).fill(0).map(() => blank(d));
  f[h - 1] = f[h - 1].slice(0, Math.floor(w / 2)) + c + f[h - 1].slice(Math.floor(w / 2) + 1);
  s[h - 1] = s[h - 1].slice(0, Math.floor(d / 2)) + c + s[h - 1].slice(Math.floor(d / 2) + 1);
  state.doc.parts[name] = { pivot: [(w - 1) / 2, 0, (d - 1) / 2], front: f.join('\n'), back: f.join('\n'), side: s.join('\n') };
  state.part = name;
  changed();
}

async function duplicatePart() {
  const name = await modalPrompt({
    title: 'Duplicate Part',
    defaultValue: uniqueName(state.part),
    validate: (v) => !validName(v) ? 'Choose a unique valid name' : state.doc.parts[v] ? 'A part with this name already exists' : null
  });
  if (!name) return;

  checkpoint();
  state.doc.parts[name] = clone(selectedSpec());
  state.part = name;
  changed();
}

async function renamePart() {
  const old = state.part;
  const name = await modalPrompt({
    title: 'Rename Part',
    defaultValue: old,
    validate: (v) => !validName(v) ? 'Choose a unique valid name' : (v !== old && state.doc.parts[v]) ? 'A part with this name already exists' : null
  });
  if (!name || name === old) return;

  checkpoint();
  const replaced: Record<string, any> = {};
  entries(state.doc.parts).forEach(([key, value]) => replaced[key === old ? name : key] = value);
  state.doc.parts = replaced;
  values(state.doc.rig?.bones || {}).forEach(b => { if (b.part === old) b.part = name; });
  partKeys().forEach(k => { if (k.value === old) k.value = name; });
  state.part = name;
  changed();
}

function partKeys(): any[] {
  return values(state.doc.animations || {}).flatMap((clip: any) =>
    values(clip?.bones || {}).flatMap((t: any) => t?.part || []));
}

function animationUsingPart(part: string): string | null {
  const hit = entries(state.doc.animations || {}).find(([, clip]: [string, any]) =>
    values(clip?.bones || {}).some((t: any) => (t?.part || []).some((k: any) => k.value === part)));
  return hit ? hit[0] : null;
}

async function deletePart() {
  if (Object.keys(state.doc.parts).length === 1) {
    return modalAlert({ title: 'Cannot Delete Part', message: 'A project must contain at least one part.' });
  }
  const usedBy = animationUsingPart(state.part);
  if (usedBy) {
    return modalAlert({ title: 'Cannot Delete Part', message: `Part '${state.part}' is used by animation '${usedBy}'` });
  }
  const refs = entries(state.doc.rig?.bones || {}).filter(([, b]) => b.part === state.part).map(([n]) => n);
  const detail = refs.length ? ` It will detach bones: ${refs.join(', ')}.` : '';
  const confirmed = await modalConfirm({
    title: 'Delete Part',
    message: `Delete ${state.part}?${detail}`,
    confirmText: 'Delete',
    isDanger: true
  });
  if (!confirmed) return;

  checkpoint();
  refs.forEach(n => delete state.doc.rig.bones[n].part);
  delete state.doc.parts[state.part];
  state.part = Object.keys(state.doc.parts)[0];
  changed();
}

function resizeGrid(grid: string[], newW: number, newH: number, offsetX: number, offsetY: number) {
  const out = Array.from({ length: newH }, () => Array(newW).fill('.'));
  grid.forEach((row, y) => [...row].forEach((c, x) => {
    const nx = x + offsetX, ny = y + offsetY;
    if (nx >= 0 && nx < newW && ny >= 0 && ny < newH) out[ny][nx] = c;
  }));
  return out.map(r => r.join(''));
}

async function resizePart() {
  const nw = +$('partWidth').value, nh = +$('partHeight').value, nd = +$('partDepth').value;
  if ([nw, nh, nd].some(n => !Number.isInteger(n) || n < 1 || n > 64)) {
    return modalAlert({ title: 'Invalid Dimensions', message: 'Dimensions must be integers from 1 to 64.' });
  }
  if (isGridSelected()) {
    const spec = selectedSpec() as any, [ow, oh, od] = spec.size as number[];
    if (nw === ow && nh === oh && nd === od) return;
    checkpoint();
    const resized = resizeGrid3(gridFromSpec(spec), nw, nh, nd);
    const ox = Math.floor((nw - ow) / 2), oz = Math.floor((nd - od) / 2);
    const p = spec.pivot || [(ow - 1) / 2, 0, (od - 1) / 2];
    spec.size = [nw, nh, nd];
    spec.voxels = encodeGrid(resized);
    spec.pivot = [+p[0] + ox, +p[1], +p[2] + oz];
    changed();
    return;
  }
  const f = rows('front'), s = rows(sideView()), ow = f[0].length, oh = f.length, od = s[0].length;
  if (nw === ow && nh === oh && nd === od) return;

  checkpoint();
  const ox = Math.floor((nw - ow) / 2), oz = Math.floor((nd - od) / 2), oy = nh - oh;
  setRows('front', resizeGrid(f, nw, nh, ox, oy));
  setRows('back', resizeGrid(rows('back'), nw, nh, ox, oy));
  setRows(sideView(), resizeGrid(s, nd, nh, oz, oy));
  if (isSplit()) setRows('right', resizeGrid(rows('right'), nd, nh, oz, oy));
  const p = selectedSpec().pivot || [(ow - 1) / 2, 0, (od - 1) / 2];
  selectedSpec().pivot = [+p[0] + ox, +p[1], +p[2] + oz];
  changed();
}

async function addColor() {
  const char = await modalPrompt({
    title: 'Add Palette Color',
    placeholder: 'Palette character (one character)',
    validate: (v) => paletteCharError(v, state.doc.palette, undefined, state.doc.parts)
  });
  if (!char) return;

  checkpoint();
  state.doc.palette[char] = '#ffffff';
  state.color = char;
  changed();
}

async function renameColor(old: string) {
  const char = await modalPrompt({
    title: 'Rename Palette Character',
    defaultValue: old,
    validate: (v) => paletteCharError(v, state.doc.palette, old, state.doc.parts)
  });
  if (!char || char === old) return;

  checkpoint();
  const palette: Record<string, Color> = {};
  entries(state.doc.palette).forEach(([k, v]) => palette[k === old ? char : k] = v);
  state.doc.palette = palette;
  values(state.doc.parts).forEach(part => replaceCharInPart(part, old, char));
  state.color = char;
  changed();
}

async function deleteColor(char: string) {
  const used = values(state.doc.parts).some(part => usesChar(part, char));
  if (used) {
    return modalAlert({ title: 'Color In Use', message: `Color ${char} is still used by a part. Erase or replace it first.` });
  }
  if (Object.keys(state.doc.palette).length === 1) {
    return modalAlert({ title: 'Cannot Delete Color', message: 'A project needs at least one color.' });
  }
  const confirmed = await modalConfirm({
    title: 'Delete Color',
    message: `Delete palette color ${char}?`,
    confirmText: 'Delete',
    isDanger: true
  });
  if (!confirmed) return;

  checkpoint();
  delete state.doc.palette[char];
  if (state.color === char) state.color = Object.keys(state.doc.palette)[0];
  changed();
}

function showError(message: string, info: any = null) {
  state.error = message;
  state.errorInfo = info;
  const banner = $('errorBanner');
  banner.replaceChildren();

  const msgSpan = document.createElement('span');
  msgSpan.textContent = message;
  banner.append(msgSpan);

  if (offersSilhouetteSync(message, state.doc ? selectedSpec() : undefined)) {
    const syncBtn = document.createElement('button');
    syncBtn.id = 'bannerSyncBtn';
    syncBtn.className = 'banner-action-btn';
    syncBtn.textContent = 'Sync Silhouette';
    syncBtn.onclick = () => syncSilhouette();
    banner.append(syncBtn);
  }

  banner.classList.remove('hidden');
  if (state.doc) renderCanvases();
}

function clearError() {
  state.error = null;
  state.errorInfo = null;
  $('errorBanner').replaceChildren();
  $('errorBanner').classList.add('hidden');
  if (state.doc) renderCanvases();
}

async function validateAndPreview() {
  const revision = state.revision;
  const project = state.doc;
  try {
    await request('/api/validate', { method: 'POST', body: JSON.stringify({ document: state.doc }) });
    if (revision !== state.revision || project !== state.doc) return;
    state.valid = true;
    if (!token && state.dirty) {
      try {
        await persistDraft(project);
      } catch (error: any) {
        if (revision === state.revision && project === state.doc) {
          $('status').textContent = error.message;
          updateButtons();
          schedulePreview(0);
        }
        return;
      }
      if (revision !== state.revision || project !== state.doc) return;
    }
    clearError();
    $('saveButton').disabled = !state.dirty;
    $('status').textContent = state.dirty ? 'Unsaved changes' : 'Ready';
    schedulePreview(0);
    if (state.workspace !== 'parts') updateRigPreview();
  } catch (error: any) {
    if (revision !== state.revision || project !== state.doc) return;
    state.valid = false;
    showError(error.message, error.body?.error);
    $('saveButton').disabled = true;
  }
  updateButtons();
}

function schedulePreview(delay = 120) {
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(updatePreview, delay);
}

async function updatePreview() {
  if (!state.valid) return;
  const stage = $('previewImage').parentElement;
  stage?.classList.add('busy');
  const payload = {
    document: state.doc,
    mode: state.mode,
    part: state.part,
    direction: +$('yaw').value,
    clip: $('clip').value,
    frame: +$('frame').value,
    // Both renderers (browser TS and the Python edit server) tint this slice of a grid part.
    ...(state.mode === 'part' && isGridSelected() ? { slice: state.slice } : {})
  };
  try {
    const res = await request('/api/preview', { method: 'POST', body: JSON.stringify(payload) });
    const img = $('previewImage');
    if (res.headers?.get('Content-Type')?.includes('image/png')) {
      const blob = await res.blob(), newUrl = URL.createObjectURL(blob), oldUrl = state.previewUrl;
      state.previewUrl = newUrl;
      img.onload = () => {
        if (oldUrl && oldUrl !== newUrl) URL.revokeObjectURL(oldUrl);
      };
      img.src = newUrl;
    } else {
      const data = await res.json();
      img.src = data.dataUrl || ('data:image/png;base64,' + data.png);
    }
    img.dataset.rendered = 'true';
  } catch (error: any) {
    showError(error.message);
  } finally {
    stage?.classList.remove('busy');
  }
}

async function save() {
  if (!state.valid) return;
  const revision = state.revision, project = state.doc;
  try {
    const payload = await (await request('/api/project', { method: 'PUT', body: JSON.stringify({ document: state.doc, source_hash: state.sourceHash }) })).json();
    if (project !== state.doc) return;
    state.sourceHash = payload.source_hash;
    if (revision !== state.revision) return;
    clearError();
    state.dirty = false;
    $('status').textContent = 'Saved';
    updateButtons();
  } catch (error: any) {
    showError(error.message);
    if (error.status === 409) $('status').textContent = 'File changed externally';
  }
}

function stopPlayback() {
  if (state.playing) {
    clearInterval(state.playing);
    state.playing = null;
    $('play').textContent = 'Play';
  }
}

async function newProject() {
  if (state.dirty) {
    const discard = await modalConfirm({
      title: 'Discard Changes',
      message: 'Discard unsaved changes and create a new project?',
      confirmText: 'Discard & Create',
      isDanger: true
    });
    if (!discard) return;
  }
  const filename = await modalPrompt({
    title: 'New Project',
    defaultValue: 'untitled.yaml',
    placeholder: 'filename.yaml',
    validate: (v) => !/^[A-Za-z0-9_.-]+\.ya?ml$/i.test(v) ? 'Use a .yaml or .yml filename without folders.' : null
  });
  if (!filename) return;

  try {
    const previous = token ? undefined : await readDraft();
    if (previous && (sessionStorage.getItem('impossibru-example') === 'true' || String(previous.time) !== sessionStorage.getItem('impossibru-revision')) && !await modalConfirm({
      title: 'Replace recovery draft?',
      message: 'Create ' + filename + ' in place of the recovery draft for ' + (previous.document.export?.name || 'your project') + '?'
    })) return;
    const payload = await (await request('/api/project/new', {
      method: 'POST',
      body: JSON.stringify({ filename, replaceRevision: previous?.time ?? null })
    })).json();
    state.doc = payload.document;
    state.sourceHash = payload.source_hash;
    state.summary = payload.summary;
    state.part = Object.keys(state.doc.parts)[0];
    state.color = Object.keys(state.doc.palette)[0];
    state.selectedBone = Object.keys(state.doc.rig?.bones || {})[0] || null;
    state.selectedChain = null;
    state.selectedClip = Object.keys(state.doc.animations || {})[0] || null;
    state.history = [];
    state.future = [];
    state.dirty = false;
    $('keepExample').hidden = true; $('exampleHint').hidden = true;
    stopPlayback();
    state.valid = true;
    $('filePath').textContent = payload.summary.path;
    $('status').textContent = 'Created';
    setWorkspace('parts');
    renderAll();
    await validateAndPreview();
  } catch (error: any) {
    showError(error.message);
  }
}

function updateHandleVisibility() {
  const animate = state.workspace === 'animate';
  $('handlesControl').hidden = !animate;
  $('rigOverlay').parentElement.classList.toggle('hide-handles', animate && !$('showHandles').checked);
}

function setWorkspace(name: string) {
  if (name !== state.workspace) stopPlayback();
  state.workspace = name;
  updateHandleVisibility();
  document.querySelectorAll<HTMLElement>('[data-workspace]').forEach(b => b.classList.toggle('active', b.dataset.workspace === name));
  document.querySelectorAll('[data-pane=parts]').forEach(e => e.classList.toggle('hidden', name !== 'parts'));
  document.querySelectorAll('[data-pane=rigging]').forEach(e => e.classList.toggle('hidden', name === 'parts'));
  $('rigBonesSection').classList.toggle('hidden', name === 'animate');
  $('clipSection').classList.toggle('hidden', name !== 'animate');
  $('timeline').classList.toggle('hidden', name !== 'animate');
  $('rigModeTitle').textContent = name === 'animate' ? 'Animate' : 'Rest pose';
  $('transport').hidden = name !== 'animate';
  (name === 'animate' ? $('transport') : $('animationControls')).append($('play'));
  if (name === 'parts') renderCanvases();
  renderRig();
  schedulePreview(0);
}

function boneChildren(name: string) {
  return entries(state.doc.rig?.bones || {}).filter(([, b]) => b.parent === name).map(([n]) => n);
}

const collapsedBones = new Set<string>();
function appendBoneTree(parent: string | null, container: HTMLElement, depth = 0) {
  entries(state.doc.rig?.bones || {}).filter(([, b]) => (b.parent || null) === (parent || null)).forEach(([name]) => {
    const b = document.createElement('button');
    b.className = 'bone-name';
    b.textContent = name;
    b.classList.toggle('active', name === state.selectedBone);
    b.onclick = () => {
      state.selectedBone = name;
      state.selectedChain = null;
      renderRig();
      schedulePreview(0);
    };
    const row = document.createElement('div');
    row.className = 'bone-row';
    row.style.paddingLeft = depth * 10 + 'px';
    if (boneChildren(name).length) {
      const toggle = document.createElement('button');
      toggle.textContent = collapsedBones.has(name) ? '▸' : '▾';
      toggle.setAttribute('aria-label','Toggle children of ' + name);
      toggle.setAttribute('aria-expanded',String(!collapsedBones.has(name)));
      toggle.onclick = () => {
        if (!collapsedBones.delete(name)) collapsedBones.add(name);
        renderRig();
      };
      row.append(toggle);
    }
    row.append(b);
    container.append(row);
    if (!collapsedBones.has(name)) appendBoneTree(name, container, depth + 1);
  });
}

function vecEditor(title: string, value: any, onchange: (i: number, val: number) => void) {
  const wrap = document.createElement('div');
  wrap.className = 'vec';
  const label = document.createElement('span');
  label.textContent = title;
  wrap.append(label);
  ['X', 'Y', 'Z'].forEach((axis, i) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.1';
    input.title = axis;
    input.value = String(Number(value?.[i] || 0));
    input.onchange = () => onchange(i, +input.value);
    const axisLabel = document.createElement('label');
    axisLabel.textContent = axis;
    input.setAttribute('aria-label', title + ' ' + axis);
    axisLabel.append(input);
    wrap.append(axisLabel);
  });
  return wrap;
}

function authoredTrack() {
  const clip = state.doc.animations[state.selectedClip];
  if (!clip) return null;
  if (state.selectedChain) return clip.ik?.[state.selectedChain]?.[state.selectedTrack] || null;
  return clip.bones?.[state.selectedBone]?.[state.selectedTrack] || null;
}

function keyAtFrame() {
  return authoredTrack()?.find((k: any) => k.frame === +$('frame').value) || null;
}

function sampleKeys(keys: any[], frame: number, fallback: any, loop = true, frames = 0) {
  if (!keys?.length) return clone(fallback);
  const exact = keys.find(k => k.frame === frame);
  if (exact) return clone(exact.value);
  let left = [...keys].reverse().find(k => k.frame < frame),
    right = keys.find(k => k.frame > frame),
    pos = frame;
  if (!left || !right) {
    if (!loop || keys.length < 2 || frames <= 0) return clone((left || right)!.value);
    if (left) {
      right = { ...keys[0], frame: keys[0].frame + frames };
    } else {
      left = { ...keys.at(-1)!, frame: keys.at(-1)!.frame - frames };
      right = keys[0];
    }
  }
  if (left!.interpolation === 'step') return clone(left!.value);
  let t = (pos - left!.frame) / (right!.frame - left!.frame);
  if (left!.interpolation === 'smooth') t = t * t * (3 - 2 * t);
  if (Array.isArray(left!.value)) return left!.value.map((v: number, i: number) => v * (1 - t) + right!.value[i] * t);
  return left!.value * (1 - t) + right!.value * t;
}

function putKey(group: string, name: string, track: string, value: any) {
  const clip = state.doc.animations[state.selectedClip], bucket = (clip[group] ??= {})[name] ??= {};
  const keys = bucket[track] ??= [];
  const frame = +$('frame').value, index = keys.findIndex((k: any) => k.frame === frame);
  const key: any = { frame, value };
  if (track !== 'part') key.interpolation = index >= 0 ? (keys[index].interpolation || 'linear') : 'linear';
  if (index >= 0) keys[index] = key; else keys.push(key);
  keys.sort((a: any, b: any) => a.frame - b.frame);
}

function renderRig() {
  if (!state.doc) return;
  const tree = $('boneTree');
  tree.replaceChildren();
  appendBoneTree(null, tree);
  const chains = $('chainList');
  chains.replaceChildren();
  entries(state.doc.rig?.ik_chains || {}).forEach(([name, c]) => {
    const b = document.createElement('button');
    b.textContent = `${name}: ${c.root} → ${c.mid} → ${c.end}`;
    b.classList.toggle('active', name === state.selectedChain);
    b.onclick = () => {
      state.selectedChain = name;
      state.selectedTrack = 'target';
      renderRig();
    };
    chains.append(b);
  });
  const clips = $('clipList');
  clips.replaceChildren();
  Object.keys(state.doc.animations || {}).forEach(name => {
    const b = document.createElement('button');
    b.textContent = name;
    b.classList.toggle('active', name === state.selectedClip);
    b.onclick = () => {
      stopPlayback();
      state.selectedClip = name;
      $('clip').value = name;
      $('frame').value = 0;
      renderAll();
      schedulePreview(0);
    };
    clips.append(b);
  });
  renderBoneInspector();
  renderSpringInspector();
  renderConstraintInspector();
  renderClipTiming();
  renderProceduralInspector();
  renderTimeline();
  if (state.workspace !== 'parts' && state.valid) updateRigPreview();
}

function renderBoneInspector() {
  const box = $('boneInspector');
  box.replaceChildren();
  const name = state.selectedBone, spec = state.doc.rig?.bones?.[name];
  if (!spec) return;
  const heading = document.createElement('h3');
  heading.textContent = name;
  box.append(heading);
  const clip = state.doc.animations[state.selectedClip];
  const loop = clip?.loop !== false, frames = clip?.frames || 0;
  const editVec = (path: string[], label: string, animationTrack: string | null = null) => {
    let shown = path.reduce((v, k) => v?.[k], spec) || [0, 0, 0];
    if (state.workspace === 'animate' && animationTrack) {
      const keys = state.doc.animations[state.selectedClip]?.bones?.[name]?.[animationTrack];
      const sampled = sampleKeys(keys, +$('frame').value, [0, 0, 0], loop, frames);
      shown = animationTrack === 'translation' ? (spec.translation || [0, 0, 0]).map((v: number, i: number) => +v + sampled[i]) : sampled;
    }
    box.append(vecEditor(label, shown, (i, value) => {
      checkpoint();
      if (state.workspace === 'animate' && animationTrack) {
        const base = animationTrack === 'translation' ? (spec.translation || [0, 0, 0]) : [0, 0, 0], keys = state.doc.animations[state.selectedClip]?.bones?.[name]?.[animationTrack];
        const current = sampleKeys(keys, +$('frame').value, [0, 0, 0], loop, frames);
        current[i] = value - (animationTrack === 'translation' ? +base[i] : 0);
        putKey('bones', name, animationTrack, current);
        state.selectedTrack = animationTrack;
      } else {
        let target = spec;
        path.slice(0, -1).forEach(k => target = target[k] ??= {});
        const key = path[path.length - 1];
        target[key] = (target[key] || [0, 0, 0]).slice();
        target[key][i] = value;
      }
      changed();
    }));
  };
  editVec(['translation'], 'Position', 'translation');
  editVec(['rotation'], 'Rotation °', 'rotation');
  if (state.workspace === 'rig') {
    const partLabel = document.createElement('label');
    partLabel.textContent = 'Attached part ';
    const select = document.createElement('select');
    select.append(new Option('None', ''));
    Object.keys(state.doc.parts).forEach(p => select.append(new Option(p, p)));
    select.value = spec.part || '';
    select.onchange = () => {
      checkpoint();
      if (select.value) spec.part = select.value; else delete spec.part;
      changed();
    };
    partLabel.append(select);
    box.append(partLabel);
    spec.attachment ??= {};
    editVec(['attachment', 'translation'], 'Attachment position');
    editVec(['attachment', 'rotation'], 'Attachment rotation °');
    if (spec.part) {
      const pivot = state.doc.parts[spec.part].pivot || [0, 0, 0];
      box.append(vecEditor('Pivot', pivot, (i, value) => {
        checkpoint();
        const p = state.doc.parts[spec.part];
        p.pivot = (p.pivot || [0, 0, 0]).slice();
        p.pivot[i] = value;
        changed();
      }));
    }
  }
  renderKeyInspector();
}

function renderKeyInspector() {
  const box = $('keyInspector');
  box.replaceChildren();
  if (state.workspace !== 'animate') return;
  box.className = 'inspector';
  const key = keyAtFrame(), p = document.createElement('p');
  p.textContent = key ? 'Authored key' : 'Sampled value — no authored key';
  p.className = key ? 'authored' : 'sampled';
  box.append(p);
  if (state.selectedChain) {
    if (state.selectedTrack === 'weight') {
      const label = document.createElement('label');
      label.textContent = 'Weight ';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '1';
      input.step = '0.05';
      input.value = String(key?.value ?? 1);
      input.onchange = () => {
        const value = Math.max(0, Math.min(1, +input.value));
        checkpoint();
        putKey('ik', state.selectedChain, 'weight', value);
        changed();
      };
      label.append(input);
      box.append(label);
    } else {
      const fallback = state.selectedTrack === 'pole' ? [0, 0, 1] : [0, 0, 0];
      box.append(vecEditor(state.selectedTrack, key?.value || fallback, (i, value) => {
        const current = (keyAtFrame()?.value || fallback).slice();
        current[i] = value;
        checkpoint();
        putKey('ik', state.selectedChain, state.selectedTrack, current);
        changed();
      }));
    }
  }
  if (!state.selectedChain && state.selectedTrack === 'part' && state.selectedBone) {
    const label = document.createElement('label');
    label.textContent = 'Part ';
    const select = document.createElement('select');
    select.id = 'partKeySelect';
    select.append(new Option('none', ''));
    Object.keys(state.doc.parts).forEach(p => select.append(new Option(p, p)));
    const clipName = state.selectedClip;
    select.value = partKeyDisplay(
      key,
      key ? null : activeParts(state.doc, clipName, +$('frame').value)[state.selectedBone]
    );
    select.onchange = () => {
      checkpoint();
      putKey('bones', state.selectedBone, 'part', select.value || null);
      changed();
    };
    label.append(select);
    box.append(label);
  }
  if (key) {
    if (state.selectedChain || state.selectedTrack !== 'part') {
      const select = document.createElement('select');
      ['linear', 'smooth', 'step'].forEach(v => select.append(new Option(v, v)));
      select.value = key.interpolation || 'linear';
      select.onchange = () => {
        checkpoint();
        key.interpolation = select.value;
        changed();
      };
      box.append(select);
    }

    const delKeyBtn = document.createElement('button');
    delKeyBtn.className = 'danger';
    delKeyBtn.textContent = 'Delete Keyframe';
    delKeyBtn.style.marginTop = '8px';
    delKeyBtn.onclick = () => {
      deleteCurrentKey();
    };
    box.append(delKeyBtn);
  }
}

function renderClipTiming() {
  const box = $('clipTiming');
  box.replaceChildren();
  const clip = state.doc.animations[state.selectedClip];
  if (!clip) return;
  [['Frames', 'frames', 1], ['FPS', 'fps', 0.1]].forEach(([label, key, step]) => {
    const l = document.createElement('label');
    l.textContent = label + ' ';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(step);
    input.step = String(step);
    input.value = String(clip[key]);
    input.onchange = async () => {
      let value = key === 'frames' ? Math.floor(+input.value) : +input.value;
      if (value <= 0) return renderClipTiming();
      if (key === 'frames' && value < clip.frames) {
        const count = countKeysAfter(clip, value);
        if (count) {
          const confirmed = await modalConfirm({
            title: 'Trim Keyframes',
            message: `Remove ${count} key(s) beyond frame ${value - 1}?`,
            confirmText: 'Trim',
            isDanger: true
          });
          if (!confirmed) return renderClipTiming();
        }
      }
      checkpoint();
      if (key === 'frames' && value < clip.frames) trimClip(clip, value);
      clip[key] = value;
      changed();
    };
    l.append(input);
    box.append(l);
  });
  const loop = document.createElement('label');
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = clip.loop !== false;
  check.onchange = () => {
    checkpoint();
    clip.loop = check.checked;
    changed();
  };
  loop.append(check, ' Looping');
  box.append(loop);
}

function renderProceduralInspector() {
  const box = $('proceduralInspector');
  if (!box) return;
  box.replaceChildren();
  if (state.workspace !== 'animate' || !state.selectedClip) return;
  const clip = state.doc?.animations?.[state.selectedClip];
  if (!clip) return;

  const clipBones = Object.keys(state.doc.rig?.bones || {});
  const clipChains = Object.keys(state.doc.rig?.ik_chains || {});
  const proc = clip.procedural || {};

  // --- Generator: Gait (Walk / Run Cycle) ---
  const gaitSection = document.createElement('div');
  gaitSection.className = 'inspector-sub';
  const gaitHeader = document.createElement('label');
  gaitHeader.style.fontWeight = 'bold';
  gaitHeader.style.display = 'flex';
  gaitHeader.style.alignItems = 'center';
  gaitHeader.style.gap = '6px';
  const gaitCheck = document.createElement('input');
  gaitCheck.type = 'checkbox';
  gaitCheck.checked = !!proc.gait;
  gaitCheck.onchange = () => {
    checkpoint();
    if (gaitCheck.checked) {
      clip.procedural ??= {};
      clip.procedural.gait = {
        speed: 1.0,
        stride_length: 4.0,
        stride_height: 2.0,
        hip_bounce: 0.5,
        arm_swing: 25.0,
        left_leg_chain: clipChains[0] || 'left_leg',
        right_leg_chain: clipChains[1] || 'right_leg',
        left_arm_bone: clipBones.find(b => b.includes('arm')) || clipBones[0] || 'left_upper_arm',
        right_arm_bone: clipBones.find(b => b.includes('right') && b.includes('arm')) || clipBones[1] || 'right_upper_arm',
        root_bone: 'root'
      };
    } else {
      if (clip.procedural) {
        delete clip.procedural.gait;
        if (!Object.keys(clip.procedural).length) delete clip.procedural;
      }
    }
    changed();
  };
  gaitHeader.append(gaitCheck, ' Gait (Walk / Run)');
  gaitSection.append(gaitHeader);

  if (proc.gait) {
    const g = proc.gait;
    const makeNum = (label: string, key: string, step = 0.1, min = 0) => {
      const l = document.createElement('label');
      l.textContent = label + ' ';
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = String(step);
      inp.min = String(min);
      inp.value = String(g[key] ?? 0);
      inp.onchange = () => {
        checkpoint();
        g[key] = +inp.value;
        changed();
      };
      l.append(inp);
      gaitSection.append(l);
    };
    makeNum('Speed (Hz)', 'speed', 0.1, 0);
    makeNum('Stride Length', 'stride_length', 0.5, 0);
    makeNum('Stride Height', 'stride_height', 0.5, 0);
    makeNum('Hip Bounce', 'hip_bounce', 0.1, 0);
    makeNum('Arm Swing (°)', 'arm_swing', 1.0, 0);

    const makeSelect = (label: string, key: string, options: string[]) => {
      const l = document.createElement('label');
      l.textContent = label + ' ';
      const sel = document.createElement('select');
      options.forEach(opt => sel.append(new Option(opt, opt)));
      sel.value = g[key] || options[0] || '';
      sel.onchange = () => {
        checkpoint();
        g[key] = sel.value;
        changed();
      };
      l.append(sel);
      gaitSection.append(l);
    };
    if (clipChains.length) {
      makeSelect('Left Leg IK', 'left_leg_chain', clipChains);
      makeSelect('Right Leg IK', 'right_leg_chain', clipChains);
    }
    if (clipBones.length) {
      makeSelect('Left Arm', 'left_arm_bone', clipBones);
      makeSelect('Right Arm', 'right_arm_bone', clipBones);
      makeSelect('Root Bone', 'root_bone', clipBones);
    }
  }
  box.append(gaitSection);

  // --- Generator: Breathing (Respiration) ---
  const breathSection = document.createElement('div');
  breathSection.className = 'inspector-sub';
  const breathHeader = document.createElement('label');
  breathHeader.style.fontWeight = 'bold';
  breathHeader.style.display = 'flex';
  breathHeader.style.alignItems = 'center';
  breathHeader.style.gap = '6px';
  const breathCheck = document.createElement('input');
  breathCheck.type = 'checkbox';
  breathCheck.checked = !!proc.breathing;
  breathCheck.onchange = () => {
    checkpoint();
    if (breathCheck.checked) {
      clip.procedural ??= {};
      clip.procedural.breathing = {
        rate: 0.25,
        intensity: 1.0,
        chest_bone: clipBones.find(b => b.includes('torso') || b.includes('chest')) || clipBones[0] || 'torso',
        head_bone: clipBones.find(b => b.includes('head')) || clipBones[0] || 'head'
      };
    } else {
      if (clip.procedural) {
        delete clip.procedural.breathing;
        if (!Object.keys(clip.procedural).length) delete clip.procedural;
      }
    }
    changed();
  };
  breathHeader.append(breathCheck, ' Breathing (Respiration)');
  breathSection.append(breathHeader);

  if (proc.breathing) {
    const b = proc.breathing;
    const makeNum = (label: string, key: string, step = 0.05, min = 0) => {
      const l = document.createElement('label');
      l.textContent = label + ' ';
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = String(step);
      inp.min = String(min);
      inp.value = String(b[key] ?? 0);
      inp.onchange = () => {
        checkpoint();
        b[key] = +inp.value;
        changed();
      };
      l.append(inp);
      breathSection.append(l);
    };
    makeNum('Rate (Hz)', 'rate', 0.05, 0.01);
    makeNum('Intensity', 'intensity', 0.1, 0);

    const makeSelect = (label: string, key: string, options: string[]) => {
      const l = document.createElement('label');
      l.textContent = label + ' ';
      const sel = document.createElement('select');
      options.forEach(opt => sel.append(new Option(opt, opt)));
      sel.value = b[key] || options[0] || '';
      sel.onchange = () => {
        checkpoint();
        b[key] = sel.value;
        changed();
      };
      l.append(sel);
      breathSection.append(l);
    };
    if (clipBones.length) {
      makeSelect('Chest Bone', 'chest_bone', clipBones);
      makeSelect('Head Bone', 'head_bone', clipBones);
    }
  }
  box.append(breathSection);

  // --- Generator: Lean & Sway ---
  const leanSection = document.createElement('div');
  leanSection.className = 'inspector-sub';
  const leanHeader = document.createElement('label');
  leanHeader.style.fontWeight = 'bold';
  leanHeader.style.display = 'flex';
  leanHeader.style.alignItems = 'center';
  leanHeader.style.gap = '6px';
  const leanCheck = document.createElement('input');
  leanCheck.type = 'checkbox';
  leanCheck.checked = !!proc.lean;
  leanCheck.onchange = () => {
    checkpoint();
    if (leanCheck.checked) {
      clip.procedural ??= {};
      clip.procedural.lean = {
        pitch_factor: 5.0,
        roll_factor: 5.0,
        banking_factor: 10.0,
        turn_rate: 0.0,
        velocity: [0, 0, 0],
        acceleration: [0, 0, 0],
        landing_impact: 0.0,
        stiffness: 100.0,
        damping: 10.0,
        root_bone: 'root',
        torso_bone: clipBones.find(b => b.includes('torso')) || clipBones[0] || 'torso'
      };
    } else {
      if (clip.procedural) {
        delete clip.procedural.lean;
        if (!Object.keys(clip.procedural).length) delete clip.procedural;
      }
    }
    changed();
  };
  leanHeader.append(leanCheck, ' Physics Lean & Tilt');
  leanSection.append(leanHeader);

  if (proc.lean) {
    const l = proc.lean;
    const makeNum = (label: string, key: string, step = 0.5) => {
      const lbl = document.createElement('label');
      lbl.textContent = label + ' ';
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = String(step);
      inp.value = String(l[key] ?? 0);
      inp.onchange = () => {
        checkpoint();
        l[key] = +inp.value;
        changed();
      };
      lbl.append(inp);
      leanSection.append(lbl);
    };
    makeNum('Pitch Factor', 'pitch_factor', 0.5);
    makeNum('Roll Factor', 'roll_factor', 0.5);
    makeNum('Banking Factor', 'banking_factor', 0.5);
    makeNum('Turn Rate', 'turn_rate', 0.05);

    leanSection.append(vecEditor('Velocity', l.velocity || [0, 0, 0], (i, val) => {
      checkpoint();
      l.velocity = (l.velocity || [0, 0, 0]).slice();
      l.velocity[i] = val;
      changed();
    }));
    leanSection.append(vecEditor('Accel', l.acceleration || [0, 0, 0], (i, val) => {
      checkpoint();
      l.acceleration = (l.acceleration || [0, 0, 0]).slice();
      l.acceleration[i] = val;
      changed();
    }));
  }
  box.append(leanSection);

  // --- Generator: Look-At ---
  const lookSection = document.createElement('div');
  lookSection.className = 'inspector-sub';
  const lookHeader = document.createElement('label');
  lookHeader.style.fontWeight = 'bold';
  lookHeader.style.display = 'flex';
  lookHeader.style.alignItems = 'center';
  lookHeader.style.gap = '6px';
  const lookCheck = document.createElement('input');
  lookCheck.type = 'checkbox';
  lookCheck.checked = !!proc.look_at;
  lookCheck.onchange = () => {
    checkpoint();
    if (lookCheck.checked) {
      clip.procedural ??= {};
      clip.procedural.look_at = {
        target: [0, 0, 10],
        head_bone: clipBones.find(b => b.includes('head')) || clipBones[0] || 'head',
        spine_bones: [clipBones.find(b => b.includes('torso')) || clipBones[0] || 'torso'],
        max_angle: 75.0
      };
    } else {
      if (clip.procedural) {
        delete clip.procedural.look_at;
        if (!Object.keys(clip.procedural).length) delete clip.procedural;
      }
    }
    changed();
  };
  lookHeader.append(lookCheck, ' Look-At Target');
  lookSection.append(lookHeader);

  if (proc.look_at) {
    const la = proc.look_at;
    lookSection.append(vecEditor('Target', la.target || [0, 0, 10], (i, val) => {
      checkpoint();
      la.target = (la.target || [0, 0, 10]).slice();
      la.target[i] = val;
      changed();
    }));
    const makeNum = (label: string, key: string, step = 1, min = 0, max = 180) => {
      const lbl = document.createElement('label');
      lbl.textContent = label + ' ';
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = String(step);
      inp.min = String(min);
      inp.max = String(max);
      inp.value = String(la[key] ?? 75);
      inp.onchange = () => {
        checkpoint();
        la[key] = +inp.value;
        changed();
      };
      lbl.append(inp);
      lookSection.append(lbl);
    };
    makeNum('Max Angle (°)', 'max_angle', 1, 0, 180);
  }
  box.append(lookSection);
}

function renderSpringInspector() {
  const box = $('springInspector');
  if (!box) return;
  box.replaceChildren();
  const name = state.selectedBone;
  if (!name || !state.doc?.rig?.bones?.[name]) return;

  box.className = 'inspector';
  const spec = state.doc.rig.bones[name];
  const rigSprings = state.doc.rig.spring_bones || {};
  const currentConfig = rigSprings[name] || spec.spring;

  const heading = document.createElement('h3');
  heading.textContent = 'Spring Physics';
  box.append(heading);

  const enableLabel = document.createElement('label');
  enableLabel.style.fontWeight = 'bold';
  enableLabel.style.display = 'flex';
  enableLabel.style.alignItems = 'center';
  enableLabel.style.gap = '6px';
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = !!currentConfig;
  check.onchange = () => {
    checkpoint();
    if (check.checked) {
      state.doc.rig.spring_bones ??= {};
      state.doc.rig.spring_bones[name] = {
        stiffness: 100.0,
        damping: 10.0,
        mass: 1.0,
        drag: 0.1,
        gravity: [0.0, -9.81, 0.0],
        limit_angle: 45.0
      };
    } else {
      if (state.doc.rig.spring_bones) delete state.doc.rig.spring_bones[name];
      delete spec.spring;
      if (state.doc.rig.spring_bones && !Object.keys(state.doc.rig.spring_bones).length) {
        delete state.doc.rig.spring_bones;
      }
    }
    changed();
  };
  enableLabel.append(check, ' Dynamic Spring Bone');
  box.append(enableLabel);

  if (currentConfig) {
    const makeField = (labelText: string, key: string, step = 1, min = 0) => {
      const l = document.createElement('label');
      l.textContent = labelText + ' ';
      const input = document.createElement('input');
      input.type = 'number';
      input.step = String(step);
      input.min = String(min);
      input.value = String(currentConfig[key] ?? (key === 'mass' ? 1.0 : key === 'stiffness' ? 100.0 : key === 'damping' ? 10.0 : key === 'drag' ? 0.1 : 45.0));
      input.onchange = () => {
        const val = Math.max(min, +input.value);
        checkpoint();
        const cfg = (state.doc.rig.spring_bones ??= {})[name] ??= {
          stiffness: 100.0,
          damping: 10.0,
          mass: 1.0,
          drag: 0.1,
          gravity: [0.0, -9.81, 0.0],
          limit_angle: 45.0
        };
        cfg[key] = val;
        changed();
      };
      l.append(input);
      box.append(l);
    };

    makeField('Stiffness', 'stiffness', 5, 0);
    makeField('Damping', 'damping', 0.5, 0);
    makeField('Mass', 'mass', 0.1, 0.01);
    makeField('Drag', 'drag', 0.05, 0);
    makeField('Limit Angle (°)', 'limit_angle', 1, 0);

    const grav = currentConfig.gravity || [0.0, -9.81, 0.0];
    box.append(vecEditor('Gravity', grav, (i, val) => {
      checkpoint();
      const cfg = (state.doc.rig.spring_bones ??= {})[name] ??= {
        stiffness: 100.0,
        damping: 10.0,
        mass: 1.0,
        drag: 0.1,
        gravity: [0.0, -9.81, 0.0],
        limit_angle: 45.0
      };
      cfg.gravity = (cfg.gravity || [0.0, -9.81, 0.0]).slice();
      cfg.gravity[i] = val;
      changed();
    }));
  }
}

function renderConstraintInspector() {
  const box = $('constraintInspector');
  if (!box) return;
  box.replaceChildren();
  const name = state.selectedBone;
  if (!name || !state.doc?.rig?.bones?.[name]) return;

  box.className = 'inspector';
  const spec = state.doc.rig.bones[name];
  const allBones = Object.keys(state.doc.rig?.bones || {});

  const heading = document.createElement('h3');
  heading.textContent = 'Constraints & Limits';
  box.append(heading);

  // --- Rotational Angle Limits ---
  const limitsLabel = document.createElement('label');
  limitsLabel.style.fontWeight = 'bold';
  limitsLabel.style.display = 'flex';
  limitsLabel.style.alignItems = 'center';
  limitsLabel.style.gap = '6px';
  const limitsCheck = document.createElement('input');
  limitsCheck.type = 'checkbox';
  limitsCheck.checked = !!(spec.limits || spec.rotation_limits);
  limitsCheck.onchange = () => {
    checkpoint();
    if (limitsCheck.checked) {
      spec.limits = {
        pitch: [-90, 90],
        yaw: [-90, 90],
        roll: [-90, 90]
      };
    } else {
      delete spec.limits;
      delete spec.rotation_limits;
    }
    changed();
  };
  limitsLabel.append(limitsCheck, ' Joint Angle Limits');
  box.append(limitsLabel);

  if (spec.limits || spec.rotation_limits) {
    const limits = spec.limits ?? (spec.limits = spec.rotation_limits || {});
    ['pitch', 'yaw', 'roll'].forEach(axis => {
      const row = document.createElement('div');
      row.className = 'vec';
      const lbl = document.createElement('span');
      lbl.textContent = axis.charAt(0).toUpperCase();
      lbl.title = axis;
      row.append(lbl);

      const minInp = document.createElement('input');
      minInp.type = 'number';
      minInp.title = `${axis} Min`;
      minInp.value = String(limits[axis]?.[0] ?? -90);
      minInp.onchange = () => {
        checkpoint();
        limits[axis] = [ +minInp.value, limits[axis]?.[1] ?? 90 ];
        changed();
      };

      const maxInp = document.createElement('input');
      maxInp.type = 'number';
      maxInp.title = `${axis} Max`;
      maxInp.value = String(limits[axis]?.[1] ?? 90);
      maxInp.onchange = () => {
        checkpoint();
        limits[axis] = [ limits[axis]?.[0] ?? -90, +maxInp.value ];
        changed();
      };

      row.append(minInp, maxInp);
      box.append(row);
    });
  }

  // --- Active Rig Constraints ---
  const cList: any[] = Array.isArray(state.doc.rig?.constraints)
    ? state.doc.rig.constraints
    : Object.values(state.doc.rig?.constraints || {});

  const boneConstraints = cList.filter((c: any) =>
    c.target === name || c.source === name || (Array.isArray(c.bones) && c.bones.includes(name))
  );

  const constrHeader = document.createElement('div');
  constrHeader.style.display = 'flex';
  constrHeader.style.justifyContent = 'space-between';
  constrHeader.style.alignItems = 'center';
  constrHeader.style.marginTop = '10px';

  const constrTitle = document.createElement('strong');
  constrTitle.textContent = `Rig Constraints (${boneConstraints.length})`;
  constrHeader.append(constrTitle);

  const addBtn = document.createElement('button');
  addBtn.textContent = '+ Add';
  addBtn.onclick = () => {
    checkpoint();
    state.doc.rig.constraints ??= [];
    const newName = `constraint_${state.doc.rig.constraints.length + 1}`;
    state.doc.rig.constraints.push({
      type: 'copy_rotation',
      name: newName,
      source: allBones.find(b => b !== name) || name,
      target: name,
      influence: 1.0,
      axes: [true, true, true],
      invert: [false, false, false]
    });
    changed();
  };
  constrHeader.append(addBtn);
  box.append(constrHeader);

  boneConstraints.forEach((c: any) => {
    const card = document.createElement('div');
    card.style.border = '1px solid var(--line)';
    card.style.borderRadius = '6px';
    card.style.padding = '8px';
    card.style.marginTop = '6px';
    card.style.background = 'var(--panel2)';

    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.justifyContent = 'space-between';
    topRow.style.alignItems = 'center';

    const typeSelect = document.createElement('select');
    ['copy_rotation', 'mirror', 'spline_spine'].forEach(t => typeSelect.append(new Option(t, t)));
    typeSelect.value = c.type;
    typeSelect.onchange = () => {
      checkpoint();
      c.type = typeSelect.value;
      if (c.type === 'mirror') {
        c.plane ??= 'yz';
        c.influence ??= 1.0;
      } else if (c.type === 'copy_rotation') {
        c.axes ??= [true, true, true];
        c.invert ??= [false, false, false];
        c.influence ??= 1.0;
      } else if (c.type === 'spline_spine') {
        c.bones ??= [name];
        c.total_rotation ??= [0, 0, 0];
      }
      changed();
    };
    topRow.append(typeSelect);

    const delBtn = document.createElement('button');
    delBtn.className = 'danger';
    delBtn.textContent = '✕';
    delBtn.style.padding = '2px 6px';
    delBtn.onclick = () => {
      checkpoint();
      const idx = state.doc.rig.constraints.indexOf(c);
      if (idx >= 0) state.doc.rig.constraints.splice(idx, 1);
      if (!state.doc.rig.constraints.length) delete state.doc.rig.constraints;
      changed();
    };
    topRow.append(delBtn);
    card.append(topRow);

    if (c.type === 'copy_rotation' || c.type === 'mirror') {
      const srcLabel = document.createElement('label');
      srcLabel.textContent = 'Source ';
      const srcSelect = document.createElement('select');
      allBones.forEach(b => srcSelect.append(new Option(b, b)));
      srcSelect.value = c.source || allBones[0];
      srcSelect.onchange = () => {
        checkpoint();
        c.source = srcSelect.value;
        changed();
      };
      srcLabel.append(srcSelect);
      card.append(srcLabel);

      const infLabel = document.createElement('label');
      infLabel.textContent = 'Influence ';
      const infInp = document.createElement('input');
      infInp.type = 'number';
      infInp.min = '0';
      infInp.max = '1';
      infInp.step = '0.1';
      infInp.value = String(c.influence ?? 1);
      infInp.onchange = () => {
        checkpoint();
        c.influence = Math.max(0, Math.min(1, +infInp.value));
        changed();
      };
      infLabel.append(infInp);
      card.append(infLabel);
    }

    if (c.type === 'mirror') {
      const planeLabel = document.createElement('label');
      planeLabel.textContent = 'Plane ';
      const planeSelect = document.createElement('select');
      ['yz', 'xz', 'xy'].forEach(p => planeSelect.append(new Option(p, p)));
      planeSelect.value = c.plane || 'yz';
      planeSelect.onchange = () => {
        checkpoint();
        c.plane = planeSelect.value;
        changed();
      };
      planeLabel.append(planeSelect);
      card.append(planeLabel);
    }

    box.append(card);
  });
}

function allTracks(clip: any) {
  return [...values(clip.bones || {}), ...values(clip.ik || {})].flatMap(value => values(value));
}
function countKeysAfter(clip: any, frames: number) {
  return allTracks(clip).reduce((n, t) => n + t.filter((k: any) => k.frame >= frames).length, 0);
}
function trimClip(clip: any, frames: number) {
  allTracks(clip).forEach(t => {
    for (let i = t.length - 1; i >= 0; i--) if (t[i].frame >= frames) t.splice(i, 1);
  });
  cleanAnimationTracks(state.doc);
}

function getOrCreateTooltip(): HTMLElement {
  let tip = document.getElementById('timelineTooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'timelineTooltip';
    tip.className = 'timeline-tooltip hidden';
    document.body.appendChild(tip);
  }
  return tip;
}

function renderTimeline() {
  const timeline = $('timeline');
  timeline.replaceChildren();
  if (state.workspace !== 'animate') return;
  const clip = state.doc?.animations?.[state.selectedClip];
  if (!clip) return;
  const tracks = state.selectedChain ? ['target', 'pole', 'weight'] : ['translation', 'rotation', 'part'];
  const ruler = document.createElement('div');
  ruler.className = 'time-ruler';
  ruler.style.setProperty('--frames', clip.frames);
  ruler.append(document.createElement('span'));
  for (let frame = 0; frame < clip.frames; frame++) {
    const tick = document.createElement('button');
    tick.textContent = String(frame);
    tick.setAttribute('aria-label', 'Frame ' + frame);
    tick.onclick = () => setAnimationFrame(frame);
    ruler.append(tick);
  }
  timeline.append(ruler);
  tracks.forEach(track => {
    const trackId = state.selectedChain ? `${state.selectedChain}.${track}` : `${state.selectedBone}.${track}`;
    const isMuted = state.mutedTracks.has(trackId);
    const row = document.createElement('div');
    row.className = 'track-row' + (isMuted ? ' muted' : '');
    row.style.setProperty('--frames', clip.frames);

    const label = document.createElement('button');
    label.textContent = track;
    label.classList.toggle('active', state.selectedTrack === track);
    label.onclick = () => {
      state.selectedTrack = track;
      renderRig();
    };
    row.append(label);

    const muteBtn = document.createElement('span');
    muteBtn.className = 'track-mute' + (isMuted ? ' muted' : '');
    muteBtn.title = isMuted ? `Unmute ${track}` : `Mute ${track}`;
    muteBtn.textContent = isMuted ? '🔇' : '🔊';
    muteBtn.onclick = (e) => {
      e.stopPropagation();
      if (state.mutedTracks.has(trackId)) {
        state.mutedTracks.delete(trackId);
      } else {
        state.mutedTracks.add(trackId);
      }
      renderTimeline();
      renderRig();
      schedulePreview(0);
    };
    row.append(muteBtn);

    const keys = (state.selectedChain ? clip.ik?.[state.selectedChain] : clip.bones?.[state.selectedBone])?.[track] || [];
    for (let f = 0; f < clip.frames; f++) {
      const b = document.createElement('button');
      const hasKey = keys.some((k: any) => k.frame === f);
      b.textContent = hasKey ? '◆' : '';
      b.setAttribute('aria-label', track + ', frame ' + f + (hasKey ? ', keyframe' : ''));
      b.classList.toggle('key', hasKey);
      b.classList.toggle('current', f === +$('frame').value);

      let pointerDownX = 0;
      let pointerDownY = 0;
      let isDragging = false;
      let pointerActive = false;

      b.onpointerdown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        pointerDownX = e.clientX;
        pointerDownY = e.clientY;
        isDragging = false;
        pointerActive = true;
        b.setPointerCapture(e.pointerId);
      };

      b.onpointermove = (e: PointerEvent) => {
        if (!pointerActive || !b.hasPointerCapture(e.pointerId)) return;
        if (!isDragging) {
          if (Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY) >= 4) {
            if (hasKey) {
              isDragging = true;
              b.classList.add('dragging');
            }
          }
        }
        if (isDragging) {
          const frameButtons = Array.from(row.querySelectorAll<HTMLButtonElement>('button')).slice(1);
          let targetF = f;
          let targetBtn: HTMLButtonElement | null = null;

          frameButtons.forEach((btn, idx) => {
            btn.classList.remove('drag-target', 'drag-replace');
            const rect = btn.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right) {
              targetF = idx;
              targetBtn = btn;
            }
          });

          if (!targetBtn && frameButtons.length > 0) {
            const firstRect = frameButtons[0].getBoundingClientRect();
            const lastRect = frameButtons[frameButtons.length - 1].getBoundingClientRect();
            const clampedX = Math.max(firstRect.left, Math.min(lastRect.right, e.clientX));
            const fraction = (clampedX - firstRect.left) / Math.max(1, lastRect.right - firstRect.left);
            targetF = Math.max(0, Math.min(clip.frames - 1, Math.round(fraction * (clip.frames - 1))));
            targetBtn = frameButtons[targetF];
          }

          const targetHasKey = keys.some((k: any) => k.frame === targetF);
          if (targetBtn && targetF !== f) {
            if (targetHasKey) {
              targetBtn.classList.add('drag-replace');
            } else {
              targetBtn.classList.add('drag-target');
            }
          }

          const tip = getOrCreateTooltip();
          const isOverwrite = targetHasKey && targetF !== f;
          tip.textContent = `Frame ${f} ➔ Frame ${targetF}${isOverwrite ? ' (Overwrite)' : ''}`;
          tip.classList.toggle('replace', isOverwrite);
          tip.style.left = `${e.clientX}px`;
          tip.style.top = `${e.clientY - 28}px`;
          tip.classList.remove('hidden');
        }
      };

      const handlePointerEnd = (e: PointerEvent) => {
        if (!pointerActive) return;
        pointerActive = false;
        if (b.hasPointerCapture(e.pointerId)) {
          b.releasePointerCapture(e.pointerId);
        }
        b.classList.remove('dragging');

        const tip = getOrCreateTooltip();
        tip.classList.add('hidden');

        const frameButtons = Array.from(row.querySelectorAll<HTMLButtonElement>('button')).slice(1);
        frameButtons.forEach(btn => btn.classList.remove('drag-target', 'drag-replace'));

        if (isDragging) {
          let targetF = f;
          frameButtons.forEach((btn, idx) => {
            const rect = btn.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right) {
              targetF = idx;
            }
          });
          if (frameButtons.length > 0) {
            const firstRect = frameButtons[0].getBoundingClientRect();
            const lastRect = frameButtons[frameButtons.length - 1].getBoundingClientRect();
            const clampedX = Math.max(firstRect.left, Math.min(lastRect.right, e.clientX));
            const fraction = (clampedX - firstRect.left) / Math.max(1, lastRect.right - firstRect.left);
            targetF = Math.max(0, Math.min(clip.frames - 1, Math.round(fraction * (clip.frames - 1))));
          }

          if (targetF !== f) {
            checkpoint();
            const srcKeyIdx = keys.findIndex((k: any) => k.frame === f);
            if (srcKeyIdx >= 0) {
              const keyToMove = keys[srcKeyIdx];
              const dstKeyIdx = keys.findIndex((k: any) => k.frame === targetF);
              if (dstKeyIdx >= 0) {
                keys.splice(dstKeyIdx, 1);
              }
              keyToMove.frame = targetF;
              keys.sort((a: any, b: any) => a.frame - b.frame);
              state.selectedTrack = track;
              setAnimationFrame(targetF);
              changed();
            }
          }
        } else {
          state.selectedTrack = track;
          setAnimationFrame(f);
        }
      };

      b.onpointerup = handlePointerEnd;
      b.onpointercancel = handlePointerEnd;

      row.append(b);
    }
    timeline.append(row);
  });
  const current = timeline.querySelector('.track-row .current');
  if (current) {
    const marker = document.createElement('div');
    marker.className = 'playhead';
    marker.style.left = (current.offsetLeft + current.offsetWidth / 2) + 'px';
    marker.style.height = (timeline.lastElementChild.offsetTop + timeline.lastElementChild.offsetHeight - ruler.offsetTop) + 'px';
    marker.style.top = ruler.offsetTop + 'px';
    timeline.append(marker);
  }
}

function uniqueObjectName(map: any, base: string) {
  let n = base, i = 2;
  while (map[n]) n = base + '_' + i++;
  return n;
}

function renameMapKey(map: any, old: string, name: string) {
  const out: Record<string, any> = {};
  entries(map).forEach(([k, v]) => out[k === old ? name : k] = v);
  return out;
}

async function handleAutoRig() {
  if (!state.doc) return;
  const partCount = Object.keys(state.doc.parts || {}).length;
  if (partCount === 0) {
    return modalAlert({
      title: 'Autorig Error',
      message: 'Project must contain at least one part to generate a rig.',
    });
  }

  const presetSelect = $('autoRigPreset') as HTMLSelectElement | null;
  const preset = presetSelect?.value || 'humanoid';

  checkpoint();
  $('status').textContent = 'Autorigging…';
  const autoRigBtn = $('autoRigButton') as HTMLButtonElement | null;
  if (autoRigBtn) autoRigBtn.disabled = true;

  try {
    const updated = await autoRig(state.doc, preset, request);
    state.doc = updated;
    const boneNames = Object.keys(state.doc.rig?.bones || {});
    state.selectedBone = boneNames[0] || null;
    state.selectedChain = Object.keys(state.doc.rig?.ik_chains || {})[0] || null;
    state.selectedTrack = 'translation';

    changed();
    renderRig();
    renderTimeline();
    if (state.valid) {
      await updateRigPreview(true);
    }
    $('status').textContent = 'Autorig complete';
  } catch (error: any) {
    state.history.pop();
    $('status').textContent = 'Autorig failed';
    modalAlert({
      title: 'Autorig Failed',
      message: error.message || 'Failed to autorig character.',
    });
  } finally {
    if (autoRigBtn) autoRigBtn.disabled = false;
  }
}

async function addBone() {
  const name = await modalPrompt({
    title: 'New Bone',
    defaultValue: uniqueObjectName(state.doc.rig?.bones || {}, 'bone'),
    placeholder: 'bone_name',
    validate: (v) => (!validName(v) || state.doc.rig?.bones?.[v]) ? 'Choose a unique valid bone name' : null
  });
  if (!name) return;

  checkpoint();
  const spec: any = { translation: [0, 1, 0] };
  if (state.selectedBone) spec.parent = state.selectedBone;
  state.doc.rig.bones[name] = spec;
  state.selectedBone = name;
  changed();
}

async function renameBone() {
  const old = state.selectedBone;
  if (!old) return;
  const name = await modalPrompt({
    title: 'Rename Bone',
    defaultValue: old,
    validate: (v) => (!validName(v) || (v !== old && state.doc.rig?.bones?.[v])) ? 'Choose a unique valid bone name' : null
  });
  if (!name || name === old) return;

  checkpoint();
  state.doc.rig.bones = renameMapKey(state.doc.rig.bones, old, name);
  values(state.doc.rig.bones).forEach(b => { if (b.parent === old) b.parent = name; });
  values(state.doc.rig.ik_chains || {}).forEach(c => ['root', 'mid', 'end'].forEach(k => { if (c[k] === old) c[k] = name; }));
  values(state.doc.animations).forEach(c => { if (c.bones?.[old]) c.bones = renameMapKey(c.bones, old, name); });
  if (state.doc.rig.spring_bones?.[old]) {
    state.doc.rig.spring_bones = renameMapKey(state.doc.rig.spring_bones, old, name);
  }
  if (state.doc.rig.constraints) {
    const cList = Array.isArray(state.doc.rig.constraints)
      ? state.doc.rig.constraints
      : Object.values(state.doc.rig.constraints);
    cList.forEach((c: any) => {
      if (c.source === old) c.source = name;
      if (c.target === old) c.target = name;
      if (c.driver === old) c.driver = name;
      if (Array.isArray(c.bones)) {
        c.bones = c.bones.map((b: string) => (b === old ? name : b));
      }
    });
  }
  values(state.doc.animations).forEach(c => {
    if (c.procedural) {
      const p = c.procedural;
      if (p.gait) {
        if (p.gait.left_arm_bone === old) p.gait.left_arm_bone = name;
        if (p.gait.right_arm_bone === old) p.gait.right_arm_bone = name;
        if (p.gait.root_bone === old) p.gait.root_bone = name;
      }
      if (p.breathing) {
        if (p.breathing.chest_bone === old) p.breathing.chest_bone = name;
        if (p.breathing.head_bone === old) p.breathing.head_bone = name;
      }
      if (p.lean) {
        if (p.lean.root_bone === old) p.lean.root_bone = name;
        if (p.lean.torso_bone === old) p.lean.torso_bone = name;
      }
      if (p.look_at) {
        if (p.look_at.head_bone === old) p.look_at.head_bone = name;
        if (p.look_at.neck_bone === old) p.look_at.neck_bone = name;
        if (Array.isArray(p.look_at.spine_bones)) {
          p.look_at.spine_bones = p.look_at.spine_bones.map((b: string) => (b === old ? name : b));
        }
      }
    }
  });
  state.selectedBone = name;
  changed();
}

async function reparentBone() {
  const choices = ['(root)', ...Object.keys(state.doc.rig?.bones || {}).filter(n => n !== state.selectedBone)];
  const currentParent = state.doc.rig?.bones?.[state.selectedBone]?.parent || '(root)';
  const answer = await modalPrompt({
    title: 'Reparent Bone',
    message: `Available parents: ${choices.join(', ')}`,
    defaultValue: currentParent,
    validate: (v) => {
      const p = v === '(root)' || v === '' ? null : v;
      if (p && !state.doc.rig?.bones?.[p]) return 'Unknown parent.';
      return null;
    }
  });
  if (answer === null) return;
  const parent = answer === '(root)' || answer === '' ? null : answer;
  checkpoint();
  try {
    const payload = await (await request('/api/rig/reparent', { method: 'POST', body: JSON.stringify({ document: state.doc, bone: state.selectedBone, parent }) })).json();
    state.doc = payload.document;
    changed();
  } catch (error: any) {
    state.history.pop();
    modalAlert({ title: 'Reparenting Failed', message: error.message });
  }
}

async function deleteBone() {
  const name = state.selectedBone, children = boneChildren(name), tracks = entries(state.doc.animations).filter(([, c]) => c.bones?.[name]).map(([n]) => n), chains = entries(state.doc.rig.ik_chains || {}).filter(([, c]) => [c.root, c.mid, c.end].includes(name)).map(([n]) => n), blocks = [];
  if (children.length) blocks.push('children: ' + children.join(', '));
  if (tracks.length) blocks.push('animation tracks: ' + tracks.join(', '));
  if (chains.length) blocks.push('IK chains: ' + chains.join(', '));
  const constrRefs = (Array.isArray(state.doc.rig?.constraints) ? state.doc.rig.constraints : Object.values(state.doc.rig?.constraints || {}))
    .filter((c: any) => c.source === name || c.target === name || c.driver === name || (Array.isArray(c.bones) && c.bones.includes(name)))
    .map((c: any) => c.name || c.type);
  if (constrRefs.length) blocks.push('constraints: ' + constrRefs.join(', '));
  if (blocks.length) return modalAlert({ title: 'Cannot Delete Bone', message: `Cannot delete ${name}; ${blocks.join('; ')}` });
  if (Object.keys(state.doc.rig?.bones || {}).length === 1) return modalAlert({ title: 'Cannot Delete Bone', message: 'At least one bone must remain.' });

  const confirmed = await modalConfirm({
    title: 'Delete Bone',
    message: `Delete ${name}?`,
    confirmText: 'Delete',
    isDanger: true
  });
  if (!confirmed) return;

  checkpoint();
  delete state.doc.rig.bones[name];
  if (state.doc.rig.spring_bones) {
    delete state.doc.rig.spring_bones[name];
    if (!Object.keys(state.doc.rig.spring_bones).length) delete state.doc.rig.spring_bones;
  }
  state.selectedBone = Object.keys(state.doc.rig.bones)[0];
  changed();
}

async function addChain() {
  const suggestions = Object.keys(state.doc.rig?.bones || {}).filter(e => {
    const m = state.doc.rig.bones[e].parent;
    return m && state.doc.rig.bones[m].parent;
  });
  const end = await modalPrompt({
    title: 'Add IK Chain - End Bone',
    message: `Valid end bones: ${suggestions.join(', ')}`,
    defaultValue: suggestions[0] || '',
    validate: (v) => (!v || !suggestions.includes(v)) ? 'Choose a direct three-bone path.' : null
  });
  if (!end || !suggestions.includes(end)) return;

  const mid = state.doc.rig.bones[end].parent!, root = state.doc.rig.bones[mid].parent!;
  const name = await modalPrompt({
    title: 'Add IK Chain - Name',
    message: `Chain path: ${root} → ${mid} → ${end}`,
    defaultValue: uniqueObjectName(state.doc.rig.ik_chains || {}, 'chain'),
    validate: (v) => (!validName(v) || state.doc.rig.ik_chains?.[v]) ? 'Choose a unique valid chain name' : null
  });
  if (!name) return;

  checkpoint();
  (state.doc.rig.ik_chains ??= {})[name] = { root, mid, end };
  state.selectedChain = name;
  changed();
}

async function renameChain() {
  const old = state.selectedChain;
  if (!old) return;
  const name = await modalPrompt({
    title: 'Rename IK Chain',
    defaultValue: old,
    validate: (v) => (!validName(v) || (v !== old && state.doc.rig.ik_chains?.[v])) ? 'Choose a unique valid chain name' : null
  });
  if (!name || name === old) return;

  checkpoint();
  state.doc.rig.ik_chains = renameMapKey(state.doc.rig.ik_chains, old, name);
  values(state.doc.animations).forEach(c => {
    if (c.ik?.[old]) c.ik = renameMapKey(c.ik, old, name);
    if (c.procedural?.gait) {
      if (c.procedural.gait.left_leg_chain === old) c.procedural.gait.left_leg_chain = name;
      if (c.procedural.gait.right_leg_chain === old) c.procedural.gait.right_leg_chain = name;
    }
  });
  state.selectedChain = name;
  changed();
}

async function deleteChain() {
  const name = state.selectedChain;
  if (!name) return;
  const refs = entries(state.doc.animations).filter(([, c]) => c.ik?.[name]).map(([n]) => n);
  if (refs.length) return modalAlert({ title: 'Cannot Delete Chain', message: 'Remove IK tracks first: ' + refs.join(', ') });

  checkpoint();
  delete state.doc.rig.ik_chains[name];
  state.selectedChain = null;
  changed();
}

async function addClip() {
  const name = await modalPrompt({
    title: 'New Animation Clip',
    defaultValue: uniqueObjectName(state.doc.animations, 'clip'),
    validate: (v) => (!validName(v) || state.doc.animations[v]) ? 'Choose a unique valid clip name' : null
  });
  if (!name) return;

  checkpoint();
  const hadExplicit = Array.isArray(state.doc.export?.animations);
  state.doc.animations[name] = { frames: 8, fps: 10, loop: true, bones: {}, ik: {} };
  if (hadExplicit) state.doc.export.animations.push(name);
  state.selectedClip = name;
  changed();
}

async function duplicateClip() {
  const old = state.selectedClip;
  const name = await modalPrompt({
    title: 'Duplicate Clip',
    defaultValue: uniqueObjectName(state.doc.animations, old),
    validate: (v) => (!validName(v) || state.doc.animations[v]) ? 'Choose a unique valid clip name' : null
  });
  if (!name) return;

  checkpoint();
  state.doc.animations[name] = clone(state.doc.animations[old]);
  state.selectedClip = name;
  changed();
}

async function renameClip() {
  const old = state.selectedClip;
  const name = await modalPrompt({
    title: 'Rename Clip',
    defaultValue: old,
    validate: (v) => (!validName(v) || (v !== old && state.doc.animations[v])) ? 'Choose a unique valid clip name' : null
  });
  if (!name || name === old) return;

  checkpoint();
  state.doc.animations = renameMapKey(state.doc.animations, old, name);
  if (state.doc.export?.animations) state.doc.export.animations = state.doc.export.animations.map((v: string) => v === old ? name : v);
  state.selectedClip = name;
  changed();
}

async function deleteClip() {
  if (Object.keys(state.doc.animations).length === 1) {
    return modalAlert({ title: 'Cannot Delete Clip', message: 'At least one clip must remain.' });
  }
  const confirmed = await modalConfirm({
    title: 'Delete Clip',
    message: `Delete ${state.selectedClip}?`,
    confirmText: 'Delete',
    isDanger: true
  });
  if (!confirmed) return;

  checkpoint();
  const removed = state.selectedClip;
  delete state.doc.animations[removed];
  if (state.doc.export?.animations) {
    state.doc.export.animations = state.doc.export.animations.filter((v: string) => v !== removed);
    if (!state.doc.export.animations.length) state.doc.export.animations = [Object.keys(state.doc.animations)[0]];
  }
  state.selectedClip = Object.keys(state.doc.animations)[0];
  changed();
}

function deleteCurrentKey() {
  const keys = authoredTrack(), frame = +$('frame').value;
  if (!keys) return;
  const i = keys.findIndex((k: any) => k.frame === frame);
  if (i < 0) return;
  checkpoint();
  keys.splice(i, 1);
  cleanAnimationTracks(state.doc);
  changed();
}

function setAnimationFrame(frameIndex: number) {
  const clip = state.doc?.animations?.[state.selectedClip];
  const frames = clip?.frames || 1;
  const f = ((frameIndex % frames) + frames) % frames;
  $('frame').value = String(f);
  $('frameValue').value = String(f);
  $('timeValue').value = 'Frame ' + f;
  renderTimeline();
  renderBoneInspector();
  renderKeyInspector();
  schedulePreview(0);
  if (state.workspace !== 'parts' && state.valid) updateRigPreview(true);
}

function navigateKey(direction: number) {
  const keys = authoredTrack() || [], frame = +$('frame').value, candidates = keys.map((k: any) => k.frame).filter((f: number) => direction < 0 ? f < frame : f > frame);
  if (!candidates.length) return;
  const next = direction < 0 ? Math.max(...candidates) : Math.min(...candidates);
  setAnimationFrame(next);
}

async function updateRigPreview(redraw = true) {
  if (!state.valid || state.workspace === 'parts') return;
  const payload = {
    document: state.doc,
    mode: state.workspace === 'animate' ? 'animate' : 'rest',
    clip: state.selectedClip,
    frame: +$('frame').value,
    direction: +$('yaw').value,
    mutedTracks: Array.from(state.mutedTracks)
  };
  try {
    const body = await (await request('/api/rig/preview', { method: 'POST', body: JSON.stringify(payload) })).json();
    const img = $('rigImage');
    img.src = 'data:image/png;base64,' + body.png;
    img.dataset.rendered = 'true';
    state.overlay = body.overlay;
    if (redraw) drawOverlay();
  } catch (error: any) {
    $('rigErrorBanner').textContent = error.message;
    $('rigErrorBanner').classList.remove('hidden');
  }
}

function drawOverlay() {
  const svg = $('rigOverlay'), g = state.overlay;
  if (!g) return;
  svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);
  svg.replaceChildren();
  const byName = Object.fromEntries(g.bones.map((b: any) => [b.name, b])), chainLinks: Record<string, string> = {};
  g.chains.forEach((c: any) => { chainLinks[c.mid] = c.color; chainLinks[c.end] = c.color; });
  g.bones.forEach((b: any) => {
    if (!b.parent) return;
    const p = byName[b.parent], line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(p.x));
    line.setAttribute('y1', String(p.y));
    line.setAttribute('x2', String(b.x));
    line.setAttribute('y2', String(b.y));
    line.setAttribute('class', 'rig-link' + (chainLinks[b.name] ? ' chain' : ''));
    if (chainLinks[b.name]) line.setAttribute('stroke', chainLinks[b.name]);
    svg.append(line);
  });
  g.chains.forEach((c: any) => {
    [c.target, c.pole].forEach((h: any, i: number) => {
      if (!h) return;
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(h.x));
      circle.setAttribute('cy', String(h.y));
      circle.setAttribute('r', String(i ? 2 : 2.5));
      circle.setAttribute('fill', c.color);
      circle.setAttribute('class', 'rig-handle');
      circle.onclick = () => {
        state.selectedChain = c.name;
        state.selectedTrack = i ? 'pole' : 'target';
        renderRig();
      };
      bindRigDrag(circle, i ? 'pole' : 'target', c.name, h.depth);
      svg.append(circle);
    });
  });
  g.bones.forEach((b: any) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(b.x));
    circle.setAttribute('cy', String(b.y));
    circle.setAttribute('r', String(b.name === state.selectedBone ? 2.3 : 1.7));
    circle.setAttribute('class', 'rig-joint' + (b.name === state.selectedBone ? ' selected' : ''));
    circle.onclick = () => {
      state.selectedBone = b.name;
      for (let parent = state.doc.rig.bones[b.name].parent; parent; parent = state.doc.rig.bones[parent].parent) collapsedBones.delete(parent);
      state.selectedChain = null;
      renderRig();
    };
    bindRigDrag(circle, 'joint', b.name, b.depth);
    svg.append(circle);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(b.x + 2.5));
    text.setAttribute('y', String(b.y - 2));
    text.setAttribute('class', 'rig-label');
    text.textContent = b.name;
    text.classList.toggle('selected', b.name === state.selectedBone);
    circle.setAttribute('tabindex', '0');
    circle.setAttribute('role', 'button');
    circle.setAttribute('aria-label', b.name);
    circle.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        circle.dispatchEvent(new MouseEvent('click'));
      }
    };
    circle.onfocus = () => text.classList.add('focused');
    circle.onblur = () => text.classList.remove('focused');
    svg.append(text);
  });
}

function bindRigDrag(element: SVGElement, kind: string, name: string, depth: number) {
  element.onpointerdown = e => {
    e.preventDefault();
    e.stopPropagation();
    const pointerId = e.pointerId, dragStart = structuredClone(state.doc);
    element.setPointerCapture(pointerId);
    let moved = false;
    let pending = false, latest: any = null;
    const apply = async () => {
      if (pending || !latest) return;
      pending = true;
      const screen = latest;
      latest = null;
      try {
        const body = await (await request('/api/rig/drag', { method: 'POST', body: JSON.stringify({ document: dragStart, kind, name, screen, depth, direction: +$('yaw').value, mode: state.workspace === 'animate' ? 'animate' : 'rest', clip: state.selectedClip, frame: +$('frame').value }) })).json();
        state.doc = body.document;
        state.dirty = true;
        state.valid = true;
        renderBoneInspector();
        renderTimeline();
        await updateRigPreview(false);
      } catch (error: any) {
        showError(error.message);
      } finally {
        pending = false;
        if (latest) apply();
      }
    };
    element.onpointermove = move => {
      if (!element.hasPointerCapture(move.pointerId)) return;
      if (!moved) checkpoint();
      moved = true;
      const matrix = $('rigOverlay').getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(move.clientX, move.clientY).matrixTransform(matrix.inverse());
      const screen = [point.x, point.y];
      latest = [screen[0] - (state.overlay.offset?.[0] || 0), screen[1] - (state.overlay.offset?.[1] || 0)];
      element.setAttribute('cx', String(screen[0]));
      element.setAttribute('cy', String(screen[1]));
      apply();
    };
    const finish = async () => {
      element.onpointermove = null;
      element.onpointerup = null;
      element.onpointercancel = null;
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      if (!moved) return;
      while (pending || latest) await new Promise(resolve => setTimeout(resolve, 10));
      changed();
      await updateRigPreview(true);
    };
    element.onpointerup = finish;
    element.onpointercancel = finish;
  };
}

// Tool Selection Handlers
if (typeof document !== 'undefined') {
  document.querySelectorAll<HTMLElement>('[data-tool]').forEach(button => button.onclick = () => {
    state.tool = button.dataset.tool;
    document.querySelectorAll<HTMLElement>('[data-tool]').forEach(b => b.classList.toggle('active', b === button));
    renderCanvases();
  });

const views = document.querySelector<HTMLElement>('.views')!;
let focusedView = 'front', manualFocus = false;
const compactLayout = matchMedia('(max-width:1279px)');
function arrangeViews() {
  const focus = manualFocus || compactLayout.matches;
  views.classList.toggle('focus-layout', focus);
  $('allViews').hidden = !manualFocus || compactLayout.matches;
  for (const button of views.querySelectorAll<HTMLButtonElement>('[data-focus]')) {
    const article = button.closest('article')!;
    article.classList.toggle('primary-view', button.dataset.focus === focusedView);
    article.onclick = event => {
      if (event.target === button || (focus && !article.classList.contains('primary-view'))) {
        focusedView = button.dataset.focus!;
        manualFocus = !compactLayout.matches;
        arrangeViews();
      }
    };
  }
  if (state.doc) {
    renderCanvases();
    if (state.workspace === 'animate') renderTimeline();
  }
}
$('allViews').onclick = () => { manualFocus = false; arrangeViews(); };
window.addEventListener('resize',arrangeViews);
arrangeViews();
$('dismissHint').onclick = () => $('exampleHint').hidden = true;
$('expandPreview').onclick = () => {
  const expanded = document.querySelector('.preview-panel')!.classList.toggle('expanded');
  $('openPreviewImage').hidden = expanded;
  $('expandPreview').textContent = expanded ? 'Collapse preview' : 'Expand preview';
  $('expandPreview').setAttribute('aria-expanded',String(expanded));
  arrangeViews();
};
$('openPreviewImage').onclick = () => $('expandPreview').click();
// Mode Selection
document.querySelectorAll<HTMLElement>('[data-mode]').forEach(button => button.onclick = () => {
  state.mode = button.dataset.mode;
  renderPreviewControls();
  schedulePreview(0);
});

$('showHandles').checked = sessionStorage.getItem('impossibru-show-handles') !== 'false';
$('showHandles').onchange = () => {
  sessionStorage.setItem('impossibru-show-handles', String($('showHandles').checked));
  updateHandleVisibility();
};

// Workspace Selection
document.querySelectorAll<HTMLElement>('[data-workspace]').forEach(button => button.onclick = () => setWorkspace(button.dataset.workspace || 'parts'));

$('sliceIndex').oninput = () => goToSlice(+$('sliceIndex').value);
$('sliceGhost').onchange = () => renderCanvases();

// Canvas Binding
['front', 'side', 'left', 'right', 'back', 'slice'].forEach(bindCanvas);

// Mirror & Sync Silhouette Buttons
$('mirrorToggle').onclick = () => {
  state.mirror = !state.mirror;
  updateButtons();
  renderCanvases();
};

$('syncSilhouette').onclick = () => syncSilhouette();
$('separateSides').onchange = async () => {
  const spec = selectedSpec() as any;
  if (isGridSelected()) return;
  const turnOn = $('separateSides').checked;
  if (turnOn === ('left' in spec)) return;
  if (!turnOn) {
    const ok = await modalConfirm({
      title: 'Merge Side Views',
      message: 'Keep the left view as the single side view? Right-side paint will be lost.',
      confirmText: 'Keep left'
    });
    if (!ok) { $('separateSides').checked = true; return; }
  }
  checkpoint();
  if (turnOn) {
    spec.left = spec.side;
    spec.right = spec.side;
    delete spec.side;
    if (focusedView === 'side') focusedView = 'left';
  } else {
    spec.side = spec.left;
    delete spec.left;
    delete spec.right;
    if (focusedView === 'left' || focusedView === 'right') focusedView = 'side';
  }
  changed();
  arrangeViews();
  validateAndPreview();
};

// Action Buttons
$('addPart').onclick = addPart;
$('duplicatePart').onclick = duplicatePart;
$('renamePart').onclick = renamePart;
$('deletePart').onclick = deletePart;
$('resizePart').onclick = resizePart;
$('addColor').onclick = addColor;
$('undoButton').onclick = undo;
$('redoButton').onclick = redo;
$('saveButton').onclick = save;
$('newProjectButton').onclick = newProject;
$('addExportDirection').onclick = addExportDirection;
$('exportZipButton').onclick = () => {
  if (!state.valid) return;
  exportChoice = {
    animations: [...(state.doc.export?.animations || Object.keys(state.doc.animations))],
    directions: [...(state.doc.export?.directions || defaultDirections)]
  };
  $('exportAngle').value = '';
  $('exportError').textContent = '';
  renderExportSettings();
  $('exportBrowserNote').hidden = !!token;
  $('exportDialog').showModal();
};
$('cancelExport').onclick = () => $('exportDialog').close();
$('confirmExport').onclick = async () => {
  $('exportDialog').close();
  if (JSON.stringify(exportChoice.animations) !== JSON.stringify(selectedExportAnimations()) || JSON.stringify(exportChoice.directions) !== JSON.stringify(ensureExportSettings().directions)) {
    checkpoint();
    Object.assign(ensureExportSettings(), exportChoice);
    changed();
  }
  try {
    $('status').textContent = 'Exporting…';
    if (token) {
      const result = await (await request('/api/export', { method: 'POST', body: JSON.stringify({ document: clone(state.doc) }) })).json();
      const png = Uint8Array.from(atob(result.png), c => c.charCodeAt(0));
      packageExportZip(clone(state.doc), png, result.json, $('includePlayer').checked);
    } else {
      await exportProjectZip(clone(state.doc), p => { $('status').textContent = `Exporting ${p}%`; }, $('includePlayer').checked);
    }
    $('status').textContent = 'Export ready';
  } catch (error: any) {
    showError(error.message);
  }
};

$('undoButtonRig').onclick = undo;
$('redoButtonRig').onclick = redo;
$('autoRigButton').onclick = handleAutoRig;
$('addBone').onclick = addBone;
$('renameBone').onclick = renameBone;
$('reparentBone').onclick = reparentBone;
$('deleteBone').onclick = deleteBone;
$('addChain').onclick = addChain;
$('renameChain').onclick = renameChain;
$('deleteChain').onclick = deleteChain;
$('addClip').onclick = addClip;
$('duplicateClip').onclick = duplicateClip;
$('renameClip').onclick = renameClip;
$('deleteClip').onclick = deleteClip;
$('deleteKey').onclick = deleteCurrentKey;
$('previousKey').onclick = () => navigateKey(-1);
$('nextKey').onclick = () => navigateKey(1);
$('viewFront').onclick = () => { $('yaw').value = 0; $('yaw').dispatchEvent(new Event('input')); };
$('viewSide').onclick = () => { $('yaw').value = 90; $('yaw').dispatchEvent(new Event('input')); };

$('yaw').oninput = () => {
  $('yawValue').value = $('yaw').value + '°';
  schedulePreview();
  if (state.workspace !== 'parts') updateRigPreview();
};
$('clip').onchange = () => {
  stopPlayback();
  state.selectedClip = $('clip').value;
  renderPreviewControls();
  renderRig();
  schedulePreview(0);
};
$('frame').oninput = () => {
  setAnimationFrame(+$('frame').value);
};

function startPlayback() {
  const clip = state.doc?.animations?.[state.selectedClip || $('clip').value];
  if (!clip || clip.frames <= 1) return;
  $('play').textContent = 'Pause';
  state.playing = setInterval(() => {
    const currentFrame = +$('frame').value;
    const nextFrame = currentFrame + 1;
    if (nextFrame >= clip.frames) {
      if (clip.loop === false) {
        setAnimationFrame(clip.frames - 1);
        stopPlayback();
        return;
      }
    }
    setAnimationFrame(nextFrame % clip.frames);
  }, 1000 / (clip.fps || 12));
}

function togglePlayback() {
  if (state.playing) {
    stopPlayback();
  } else {
    startPlayback();
  }
}

$('play').onclick = togglePlayback;

// Global Keyboard Shortcuts
window.addEventListener('keydown', event => {
  const target = event.target as HTMLElement | null;
  const isInput = target && (
    ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) ||
    target.isContentEditable ||
    target.getAttribute('contenteditable') === 'true'
  );
  const modalOverlay = $('modalOverlay');
  const isModalOpen = modalOverlay && !modalOverlay.classList.contains('hidden');

  if (!state.doc || $('exportDialog').open || $('examplesDialog').open) return;
  if (isInput || isModalOpen) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
    return;
  }

  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 's') {
    event.preventDefault();
    save();
  } else if ((event.ctrlKey || event.metaKey) && key === 'z') {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
  } else if ((event.ctrlKey || event.metaKey) && key === 'y') {
    event.preventDefault();
    redo();
  } else if ((event.code === 'Space' || event.key === ' ') && (!target?.closest('button') || state.workspace === 'animate' && !target.closest('.time-ruler, #transport, .workspace-tabs'))) {
    event.preventDefault();
    togglePlayback();
  } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && state.workspace === 'parts' && isGridSelected()) {
    event.preventDefault();
    goToSlice(state.slice + (event.key === 'ArrowUp' ? 1 : -1));
  } else if (event.key === '[') {
    event.preventDefault();
    setAnimationFrame(+$('frame').value - 1);
  } else if (event.key === ']') {
    event.preventDefault();
    setAnimationFrame(+$('frame').value + 1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    setAnimationFrame(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    const clip = state.doc?.animations?.[state.selectedClip];
    setAnimationFrame(clip ? clip.frames - 1 : 0);
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    if (state.workspace === 'animate' && keyAtFrame()) {
      event.preventDefault();
      deleteCurrentKey();
    }
  } else if (key === 'm') {
    event.preventDefault();
    state.mirror = !state.mirror;
    updateButtons();
    renderCanvases();
  } else {
    const map: Record<string, string> = {
      p: 'pencil',
      e: 'eraser',
      f: 'fill',
      g: 'fill',
      l: 'line',
      r: 'rect',
      c: 'replace',
      i: 'eyedropper'
    };
    if (map[key]) {
      const targetTool = map[key];
      const btn = document.querySelector<HTMLElement>(`[data-tool=${targetTool}]`);
      if (btn) btn.click();
    }
  }
});

window.addEventListener('beforeunload', event => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});

if (typeof window !== 'undefined' && typeof document !== 'undefined' && $('welcome')) {
  const welcome = $('welcome');
  async function enter(project: any, example = false, recovered = false, fileHandle = null) {
    try {
      validateProject(project);
      if (!example && !recovered) {
        const previous = await readDraft();
        if (previous && !await modalConfirm({
          title: 'Replace recovery draft?',
          message: 'Use this project in place of ' + (previous.document.export?.name || 'your last project') + '?'
        })) return;
        await persistDraft(project, previous?.time ?? null);
      } else {
        sessionStorage.setItem('impossibru-project', JSON.stringify(project));
        sessionStorage.setItem('impossibru-example', String(example));
      }
      setProjectHandle(fileHandle);
      welcome.classList.add('hidden');
      await load();
      if (recovered) $('saveButton').disabled = false;
      if (example) {
        const mundusName = mundusExamples.get(project.export?.name);
        if (mundusName) {
          $('filePath').textContent = 'Mundus · ' + mundusName;
          $('yaw').value = '60';
        } else {
          state.part = 'torso';
          state.color = 'b';
        }
        state.mode = 'character';
        state.selectedClip = 'walk';
        renderAll();
        schedulePreview(0);
        $('exampleHint').hidden = !!mundusName;
        $('keepExample').hidden = false;
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) startPlayback();
      }
    } catch (error: any) {
      await modalAlert(error.message);
    }
  }
  $('welcomeNew').onclick = () => enter(starterProject('untitled'));
  $('welcomeOpen').onclick = async () => {
    try {
      const opened = await openProject();
      if (opened) await enter(opened.document, false, false, opened.handle);
    } catch (error: any) {
      if (error.name !== 'AbortError') await modalAlert(error.message);
    }
  };
  $('welcomeRecover').onclick = async () => {
    try {
      if (await recoverDraft()) await enter(JSON.parse(sessionStorage.getItem('impossibru-project')!), false, true);
    } catch (error: any) {
      await modalAlert(error.message);
    }
  };
  $('keepExample').onclick = async () => {
    try {
      validateProject(state.doc);
      const prior = await readDraft();
      if (prior && !await modalConfirm({
        title: 'Keep example as project',
        message: 'Replace the recovery draft for ' + (prior.document.export?.name || 'your project') + '?'
      })) return;
      await persistDraft(state.doc, prior?.time ?? null);
      $('keepExample').hidden = true;
    } catch (error: any) {
      await modalAlert(error.message);
    }
  };
  const mundusExamples = new Map<string, string>();
  function addExampleRow(list: HTMLElement, labelText: string, idForSex: (sex: string) => string) {
    const row = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = labelText;
    row.append(label);
    for (const sex of ['Female', 'Male']) {
      const id = idForSex(sex.toLowerCase());
      const name = labelText + ' · ' + sex;
      mundusExamples.set(id, name);
      const link = document.createElement('a');
      link.href = '?example=' + id;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = sex;
      link.setAttribute('aria-label', name);
      row.append(link);
    }
    list.append(row);
  }
  for (const species of ['Deer', 'Wolf', 'Rabbit', 'Mus']) {
    addExampleRow($('animalList'), species, sex => species.toLowerCase() + '-' + sex);
  }
  for (const age of ['Baby', 'Juvenile', 'Adult', 'Elder']) {
    addExampleRow($('orcList'), age + ' orc', sex => 'orc-' + sex + '-' + age.toLowerCase());
  }
  document.querySelectorAll<HTMLButtonElement>('[data-open-examples]').forEach(button => {
    button.onclick = () => $('examplesDialog').showModal();
  });

  async function openExample(id: string) {
    try {
      const humanoid = id === 'humanoid';
      const url = humanoid ? './example.yaml' : new URL(`../../examples/mundus/${id}.json`, import.meta.url);
      const response = await fetch(url);
      if (!response.ok) throw new Error('Could not load example ' + id);
      await enter(humanoid ? parseYaml(await response.text()) : await response.json(), true);
      if (welcome.classList.contains('hidden')) history.replaceState(null, '', location.pathname);
    } catch (error: any) {
      await modalAlert(error.message);
    }
  }
  $('welcomeExample').onclick = () => openExample('humanoid');
  const query = new URLSearchParams(location.search);
  const exampleId = query.get('example') ?? query.get('animal');
  if (!token && (exampleId === 'humanoid' || mundusExamples.has(exampleId))) {
    openExample(exampleId);
  } else if (token || sessionStorage.getItem('impossibru-project') || sessionStorage.getItem('impossibru-yaml')) {
    welcome.classList.add('hidden');
    // Bind older sessions to their matching single-slot draft before editing.
    const resume = async () => {
      if (!token && !sessionStorage.getItem('impossibru-revision')) {
        const record = await readDraft();
        if (record && JSON.stringify(record.document) === sessionStorage.getItem('impossibru-project')) {
          sessionStorage.setItem('impossibru-revision', String(record.time));
        }
      }
      await load();
    };
    resume().catch(error => showError(error.message));
    $('keepExample').hidden = !!token || sessionStorage.getItem('impossibru-example') !== 'true';
  } else {
    readDraft().then(record => {
      if (record) {
        $('welcomeRecover').hidden = false;
        $('welcomeRecover').textContent = 'Resume ' + (record.document.export?.name || 'project') + ' · ' + new Date(record.time).toLocaleString();
        $('welcomeRecover').focus();
      }
    }).catch(() => {});
  }
}
}
