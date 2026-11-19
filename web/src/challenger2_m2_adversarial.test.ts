import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isValidHex,
  paletteHex,
  replaceColorInPart,
  reconcileSilhouette,
  bresenhamLine,
  rectPoints,
  canvasCell,
  fastFloodFill,
} from './canvas';
import {
  modalAlert,
  modalConfirm,
  modalPrompt,
  modalColorReplace,
} from './modal';
import {
  color,
  ProjectError,
  validateProject,
  render,
} from './engine';
import { starterProject, browserRequest } from './runtime';
import { setupTestEnvironment } from './test-helpers';
import type { ProjectDocument, PartSpec } from './types';

// ============================================================================
// 1. PALETTE HEX VALIDATION & SERIALIZATION ADVERSARIAL TESTS
// ============================================================================

describe('Adversarial Palette Hex Validation & Parsing', () => {
  const malformedHexes = [
    '',
    '#',
    '#1',
    '#12',
    '#123',
    '#1234',
    '#12345',
    '#ffff',
    '#1234567',
    '#123456789',
    '#1234567890',
    '#xyz123',
    '#fffffg',
    '#12345g',
    '#GGG000',
    '#GGGGGGGG',
    '123456',
    '12345678',
    'ffffff',
    '#12 3456',
    '#123456#',
    'rgba(255,0,0,1)',
    'rgb(255,0,0)',
    'red',
    'transparent',
  ];

  const valid6Hexes = [
    '#000000',
    '#ffffff',
    '#FFFFFF',
    '#123456',
    '#abcdef',
    '#ABCDEF',
    '#aBcDeF',
    '#66d9a3',
    '#ff0080',
    '#010203',
  ];

  const valid8Hexes = [
    '#00000000',
    '#ffffffff',
    '#FFFFFFFF',
    '#12345678',
    '#abcdef80',
    '#ABCDEF99',
    '#aBcDeF12',
    '#66d9a3ff',
    '#ff008000',
    '#01020304',
  ];

  it('isValidHex rejects all malformed hex strings', () => {
    for (const bad of malformedHexes) {
      expect(isValidHex(bad), `Should reject malformed hex: "${bad}"`).toBe(false);
    }
  });

  it('isValidHex accepts valid 6-digit (#RRGGBB) and 8-digit (#RRGGBBAA) hex strings', () => {
    for (const good6 of valid6Hexes) {
      expect(isValidHex(good6), `Should accept 6-digit hex: "${good6}"`).toBe(true);
    }
    for (const good8 of valid8Hexes) {
      expect(isValidHex(good8), `Should accept 8-digit hex: "${good8}"`).toBe(true);
    }
  });

  it('engine color() parser rejects all malformed hex strings with ProjectError', () => {
    for (const bad of malformedHexes) {
      expect(() => color(bad as any), `color() should throw for "${bad}"`).toThrow(ProjectError);
    }
  });

  it('engine color() parser correctly parses 6-digit and 8-digit hex strings into RGBA tuples', () => {
    expect(color('#ff0000')).toEqual([255, 0, 0, 255]);
    expect(color('#00ff00')).toEqual([0, 255, 0, 255]);
    expect(color('#0000ff')).toEqual([0, 0, 255, 255]);
    expect(color('#ffffff')).toEqual([255, 255, 255, 255]);
    expect(color('#000000')).toEqual([0, 0, 0, 255]);
    expect(color('#123456')).toEqual([0x12, 0x34, 0x56, 255]);

    // 8-digit with alpha
    expect(color('#ff000080')).toEqual([255, 0, 0, 128]);
    expect(color('#00ff0000')).toEqual([0, 255, 0, 0]);
    expect(color('#0000ffff')).toEqual([0, 0, 255, 255]);
    expect(color('#12345678')).toEqual([0x12, 0x34, 0x56, 0x78]);
  });

  it('paletteHex formats and normalizes hex strings and RGBA arrays correctly', () => {
    expect(paletteHex('#FF00AA')).toBe('#ff00aa');
    expect(paletteHex('FF00AA')).toBe('#ff00aa');
    expect(paletteHex('#123456FF')).toBe('#123456ff');
    expect(paletteHex('123456FF')).toBe('#123456ff');
    expect(paletteHex([255, 0, 128])).toBe('#ff0080');
    expect(paletteHex([255, 0, 128, 255])).toBe('#ff0080ff');
    expect(paletteHex([255, 0, 128, 128])).toBe('#ff008080');
    expect(paletteHex([255, 0, 128, 0.5])).toBe('#ff008080');
    expect(paletteHex([255, 0, 128, 0])).toBe('#ff008000');
    expect(paletteHex([-10, 300, 128])).toBe('#00ff80');
  });

  it('validateProject accepts documents with mixed #RRGGBB, #RRGGBBAA, and numeric array colors', () => {
    const doc = starterProject('hex_test');
    doc.palette = {
      x: '#66D9A3',
      y: '#ff000080',
      z: [0, 255, 128],
      w: [100, 150, 200, 128],
    };
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('validateProject rejects project when any palette entry has malformed hex', () => {
    for (const bad of ['#12', '#ffff', '#xyz123', '#123456789']) {
      const doc = starterProject('bad_hex');
      doc.palette.bad = bad;
      expect(() => validateProject(doc), `Should throw for palette entry "${bad}"`).toThrow(ProjectError);
    }
  });
});

// ============================================================================
// 2. COLOR REPLACEMENT & MULTI-PART SWAPS ADVERSARIAL TESTS
// ============================================================================

describe('Adversarial Color Replacement & Multi-Part Swaps', () => {
  function createMultiPartDoc(): ProjectDocument {
    const doc = starterProject('multi_part_character');
    doc.palette = {
      a: '#ff0000',
      b: '#00ff00',
      c: '#0000ff',
      d: '#ffff00',
      t: '#ffffff',
    };

    doc.parts = {
      head: {
        front: 'aaaa\nabbb\nabbb\naaaa',
        back: 'aaaa\nabbb\nabbb\naaaa',
        side: 'aaaa\nabbb\nabbb\naaaa',
      },
      torso: {
        front: 'bccc\nbcca\nbcca\nbccc',
        back: 'bccc\nbcca\nbcca\nbccc',
        side: 'bccc\nbcca\nbcca\nbccc',
      },
      limbs: {
        front: 'dddd\nd..d\nd..d\ndddd',
        back: 'dddd\nd..d\nd..d\ndddd',
        side: 'dddd\nd..d\nd..d\ndddd',
      },
    };

    doc.rig.bones = {
      root: { part: 'torso', translation: [0, 0, 0] },
      head_bone: { parent: 'root', part: 'head', translation: [0, 4, 0] },
      limbs_bone: { parent: 'root', part: 'limbs', translation: [0, -4, 0] },
    };

    return doc;
  }

  it('replaces color strictly within active part without mutating other parts', () => {
    const doc = createMultiPartDoc();
    const originalTorsoFront = doc.parts.torso.front;
    const originalLimbsFront = doc.parts.limbs.front;

    // Replace 'a' with 'c' only in 'head'
    replaceColorInPart(doc.parts.head, 'a', 'c');

    expect(doc.parts.head.front).toBe('cccc\ncbbb\ncbbb\ncccc');
    expect(doc.parts.head.back).toBe('cccc\ncbbb\ncbbb\ncccc');
    expect(doc.parts.head.side).toBe('cccc\ncbbb\ncbbb\ncccc');

    // Other parts MUST NOT be mutated
    expect(doc.parts.torso.front).toBe(originalTorsoFront);
    expect(doc.parts.limbs.front).toBe(originalLimbsFront);

    expect(() => validateProject(doc)).not.toThrow();
  });

  it('replaces color across all parts uniformly when scope is all', () => {
    const doc = createMultiPartDoc();

    // Replace 'b' with 'd' across all parts
    Object.values(doc.parts).forEach(part => {
      replaceColorInPart(part as PartSpec, 'b', 'd');
    });

    expect(doc.parts.head.front).toBe('aaaa\naddd\naddd\naaaa');
    expect(doc.parts.torso.front).toBe('dccc\ndcca\ndcca\ndccc');
    expect(doc.parts.limbs.front).toBe('dddd\nd..d\nd..d\ndddd');

    expect(() => validateProject(doc)).not.toThrow();
  });

  it('executes a 3-step cyclical color swap (a <-> c) across all parts without collision', () => {
    const doc = createMultiPartDoc();

    // Swap 'a' and 'c' using temporary color 't'
    for (const part of Object.values(doc.parts)) {
      replaceColorInPart(part as PartSpec, 'a', 't'); // 1. a -> temp
      replaceColorInPart(part as PartSpec, 'c', 'a'); // 2. c -> a
      replaceColorInPart(part as PartSpec, 't', 'c'); // 3. temp -> c
    }

    // head had 'a' and 'b' -> should now have 'c' and 'b'
    expect(doc.parts.head.front).toBe('cccc\ncbbb\ncbbb\ncccc');
    // torso had 'b', 'c', and 'a' -> should now have 'b', 'a', and 'c'
    expect(doc.parts.torso.front).toBe('baaa\nbaac\nbaac\nbaaa');

    expect(() => validateProject(doc)).not.toThrow();
  });

  it('handles replacement with "." (erasure) preserving grid dimensions', () => {
    const doc = createMultiPartDoc();

    // Replace 'b' with '.' in head
    replaceColorInPart(doc.parts.head, 'b', '.');

    expect(doc.parts.head.front).toBe('aaaa\na...\na...\naaaa');
    expect(doc.parts.head.back).toBe('aaaa\na...\na...\naaaa');
    expect(doc.parts.head.side).toBe('aaaa\na...\na...\naaaa');

    // Check dimensions still 4x4
    const rows = doc.parts.head.front.split('\n');
    expect(rows.length).toBe(4);
    expect(rows.every(r => r.length === 4)).toBe(true);

    expect(() => validateProject(doc)).not.toThrow();
  });

  it('handles special characters and non-matching replacement gracefully', () => {
    const part = {
      front: 'a.b\nc.d',
      back: 'a.b\nc.d',
      side: 'a.b\nc.d',
    };

    // Replacing non-existent char 'z' does nothing
    replaceColorInPart(part, 'z', 'x');
    expect(part.front).toBe('a.b\nc.d');

    // Replacing same char with itself does nothing
    replaceColorInPart(part, 'a', 'a');
    expect(part.front).toBe('a.b\nc.d');

    // Replacing with empty string does nothing
    replaceColorInPart(part, 'a', '');
    expect(part.front).toBe('a.b\nc.d');
  });
});

// ============================================================================
// 3. SILHOUETTE RECONCILIATION & COMPLEX ASYMMETRIC GRIDS ADVERSARIAL TESTS
// ============================================================================

describe('Adversarial Silhouette Parity Reconciliation', () => {
  it('reconciles completely empty back grid against complex asymmetric front grid', () => {
    const front = [
      '..xx..x.',
      '.x..xx..',
      'xxx...xx',
      '..x.xx..',
    ];
    const emptyBack = [
      '........',
      '........',
      '........',
      '........',
    ];

    const reconciled = reconcileSilhouette(front, emptyBack, 'x');

    expect(reconciled.length).toBe(front.length);
    for (let y = 0; y < front.length; y++) {
      expect(reconciled[y].length).toBe(front[y].length);
      for (let x = 0; x < front[y].length; x++) {
        const fSolid = front[y][x] !== '.';
        const bSolid = reconciled[y][x] !== '.';
        expect(bSolid).toBe(fSolid);
      }
    }
  });

  it('reconciles completely empty front grid against solid back grid to empty', () => {
    const emptyFront = [
      '....',
      '....',
    ];
    const solidBack = [
      'yyyy',
      'yyyy',
    ];

    const reconciled = reconcileSilhouette(emptyFront, solidBack, 'x');
    expect(reconciled).toEqual([
      '....',
      '....',
    ]);
  });

  it('preserves distinct color characters in back grid while fixing silhouette discrepancies', () => {
    const front = [
      'r.g.',
      '.b.y',
      'wwww',
    ];
    const back = [
      '.c.d', // mismatched at (0, 0), (1, 1), (2, 2)
      'e...f', // ragged or different
      '....',
    ];

    const reconciled = reconcileSilhouette(front, back, 'k');

    // Row 0: front has 'r' at 0 and 'g' at 2; back had '.' at 0 and 'c' at 1, '.' at 2, 'd' at 3
    // Reconciled should have solid at 0 (filled with 'r') and 2 (filled with 'g'), empty at 1 and 3
    expect(reconciled[0]).toBe('r.g.');

    // Row 1: front has '.' at 0, 'b' at 1, '.' at 2, 'y' at 3
    // Reconciled should have '.' at 0, 'b' at 1, '.' at 2, 'y' at 3
    expect(reconciled[1]).toBe('.b.y');

    // Row 2: front has 'wwww', back had '....' -> reconciled filled with 'wwww'
    expect(reconciled[2]).toBe('wwww');

    // Verify 100% silhouette parity
    for (let y = 0; y < front.length; y++) {
      for (let x = 0; x < front[y].length; x++) {
        expect(reconciled[y][x] !== '.').toBe(front[y][x] !== '.');
      }
    }
  });

  it('reconciled grid passes TS validateProject and produces valid 3D voxels', () => {
    const doc = starterProject('silhouette_sync_test');
    doc.palette = {
      r: '#ff0000',
      g: '#00ff00',
      b: '#0000ff',
    };

    const frontRows = [
      '.rr.',
      'r..g',
      'gggg',
      '.bb.',
    ];
    const mismatchedBackRows = [
      '....',
      'gggg',
      '....',
      'rrrr',
    ];

    // Verify mismatched document fails validation
    doc.parts.part.front = frontRows.join('\n');
    doc.parts.part.back = mismatchedBackRows.join('\n');
    doc.parts.part.side = 'rrrr\nrrrr\nrrrr\nrrrr';
    expect(() => validateProject(doc)).toThrow(ProjectError);
    expect(() => validateProject(doc)).toThrow(/front\/back silhouettes differ/);

    // Reconcile silhouette
    const reconciledBack = reconcileSilhouette(frontRows, mismatchedBackRows, 'r');
    doc.parts.part.back = reconciledBack.join('\n');

    // Now validateProject MUST pass
    expect(() => validateProject(doc)).not.toThrow();

    // Model renders without errors
    setupTestEnvironment();
    const imgData = render(doc, 'part', 0);
    expect(imgData).toBeDefined();
  });

  it('handles 1x1, narrow 1x8, wide 8x1, and checkerboard grids', () => {
    // 1x1
    expect(reconcileSilhouette(['x'], ['.'])).toEqual(['x']);
    expect(reconcileSilhouette(['.'], ['x'])).toEqual(['.']);

    // 1x8
    const front1x8 = ['x.x.x.x.'];
    const back1x8 = ['........'];
    expect(reconcileSilhouette(front1x8, back1x8)).toEqual(['x.x.x.x.']);

    // 8x1
    const front8x1 = ['x', '.', 'x', '.', 'x', '.', 'x', '.'];
    const back8x1 = ['.', '.', '.', '.', '.', '.', '.', '.'];
    expect(reconcileSilhouette(front8x1, back8x1)).toEqual(front8x1);

    // 4x4 Checkerboard
    const cbFront = [
      'x.x.',
      '.x.x',
      'x.x.',
      '.x.x',
    ];
    const cbInvertedBack = [
      '.x.x',
      'x.x.',
      '.x.x',
      'x.x.',
    ];
    const reconciledCB = reconcileSilhouette(cbFront, cbInvertedBack, 'y');
    expect(reconciledCB).toEqual(cbFront);
  });
});

// ============================================================================
// 4. IN-DOM MODAL DIALOG SYSTEM MECHANICS & BEHAVIOR
// ============================================================================

class MockClassList {
  private classes = new Set<string>();
  constructor(initial = '') {
    if (initial) initial.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
  }
  add(...names: string[]) { names.forEach(n => this.classes.add(n)); }
  remove(...names: string[]) { names.forEach(n => this.classes.delete(n)); }
  contains(name: string) { return this.classes.has(name); }
  toggle(name: string, force?: boolean) {
    if (force !== undefined) {
      if (force) this.classes.add(name); else this.classes.delete(name);
      return force;
    }
    if (this.classes.has(name)) { this.classes.delete(name); return false; }
    this.classes.add(name); return true;
  }
  toString() { return Array.from(this.classes).join(' '); }
}

class MockElement {
  id: string = '';
  tagName: string = 'DIV';
  classList = new MockClassList();
  textContent: string = '';
  value: string = '';
  placeholder: string = '';
  disabled: boolean = false;
  title: string = '';
  style: Record<string, string> = {};
  onclick: ((e: any) => void) | null = null;
  oninput: ((e: any) => void) | null = null;
  children: MockElement[] = [];
  parentNode: MockElement | null = null;

  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
  }

  get className() { return this.classList.toString(); }
  set className(val: string) {
    this.classList = new MockClassList(val);
  }

  append(...items: any[]) {
    for (const item of items) {
      if (item instanceof MockElement) {
        item.parentNode = this;
        this.children.push(item);
      }
    }
  }

  replaceChildren(...items: any[]) {
    this.children = [];
    this.append(...items);
  }

  click() {
    if (this.onclick) {
      this.onclick({ target: this, preventDefault: () => {}, stopPropagation: () => {} });
    }
  }

  focus() {
    if ((globalThis as any).document) {
      (globalThis as any).document.activeElement = this;
    }
  }

  select() {}

  querySelector(selector: string): MockElement | null {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      if (this.classList.contains(cls)) return this;
      for (const child of this.children) {
        const res = child.querySelector(selector);
        if (res) return res;
      }
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const check = (el: MockElement) => {
      if (!el.disabled) {
        results.push(el);
      }
      for (const child of el.children) check(child);
    };
    for (const child of this.children) check(child);
    return results;
  }
}

describe('Adversarial In-DOM Modal System Mechanics', () => {
  let elementsById: Map<string, MockElement>;
  let overlay: MockElement;
  let card: MockElement;
  let title: MockElement;
  let message: MockElement;
  let inputContainer: MockElement;
  let input: MockElement;
  let error: MockElement;
  let customSlot: MockElement;
  let cancelBtn: MockElement;
  let confirmBtn: MockElement;
  let closeBtn: MockElement;
  let eventListeners: Map<string, Array<(e: any) => void>>;

  beforeEach(() => {
    elementsById = new Map();
    eventListeners = new Map();

    overlay = new MockElement('div', 'modalOverlay');
    overlay.classList.add('modal-overlay', 'hidden');

    card = new MockElement('div');
    card.classList.add('modal-card');
    overlay.append(card);

    title = new MockElement('h3', 'modalTitle');
    closeBtn = new MockElement('button', 'modalClose');
    closeBtn.classList.add('modal-close-btn');

    message = new MockElement('p', 'modalMessage');
    inputContainer = new MockElement('div', 'modalInputContainer');
    inputContainer.classList.add('hidden');
    input = new MockElement('input', 'modalInput');
    error = new MockElement('div', 'modalError');
    error.classList.add('hidden');
    inputContainer.append(input, error);

    customSlot = new MockElement('div', 'modalCustomSlot');
    customSlot.classList.add('hidden');

    cancelBtn = new MockElement('button', 'modalCancelButton');
    confirmBtn = new MockElement('button', 'modalConfirmButton');
    confirmBtn.classList.add('modal-confirm');

    card.append(title, closeBtn, message, inputContainer, customSlot, cancelBtn, confirmBtn);

    const all = [overlay, title, closeBtn, message, inputContainer, input, error, customSlot, cancelBtn, confirmBtn];
    all.forEach(el => {
      if (el.id) elementsById.set(el.id, el);
    });

    (globalThis as any).Option = class {
      text: string;
      value: string;
      constructor(text: string, value: string) {
        this.text = text;
        this.value = value;
      }
    };

    (globalThis as any).document = {
      activeElement: null,
      getElementById: (id: string) => elementsById.get(id) || null,
      querySelector: (sel: string) => {
        if (sel === '.modal-card') return card;
        return null;
      },
      createElement: (tag: string) => {
        const el = new MockElement(tag);
        return el;
      },
      addEventListener: (type: string, handler: (e: any) => void) => {
        if (!eventListeners.has(type)) eventListeners.set(type, []);
        eventListeners.get(type)!.push(handler);
      },
      removeEventListener: (type: string, handler: (e: any) => void) => {
        const list = eventListeners.get(type) || [];
        eventListeners.set(type, list.filter(h => h !== handler));
      },
      dispatchEvent: (e: any) => {
        const list = eventListeners.get(e.type) || [];
        list.forEach(h => h(e));
      },
    };
  });

  afterEach(async () => {
    await new Promise(r => setTimeout(r, 20));
    delete (globalThis as any).document;
    delete (globalThis as any).Option;
  });

  it('modalAlert displays title and message, hides cancel button, and resolves on confirm', async () => {
    const alertPromise = modalAlert({ title: 'Attention', message: 'Project saved!' });

    expect(overlay.classList.contains('active')).toBe(true);
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(title.textContent).toBe('Attention');
    expect(message.textContent).toBe('Project saved!');
    expect(cancelBtn.classList.contains('hidden')).toBe(true);

    confirmBtn.click();
    await expect(alertPromise).resolves.toBeUndefined();
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  it('modalConfirm resolves true on Confirm button and false on Cancel button', async () => {
    // 1. Confirm true
    const confirmPromise1 = modalConfirm({ title: 'Delete part?', message: 'Cannot be undone', isDanger: true });
    expect(confirmBtn.classList.contains('danger')).toBe(true);
    confirmBtn.click();
    await expect(confirmPromise1).resolves.toBe(true);

    // 2. Confirm false
    const confirmPromise2 = modalConfirm({ title: 'Discard?', message: 'Unsaved changes' });
    cancelBtn.click();
    await expect(confirmPromise2).resolves.toBe(false);
  });

  it('modalConfirm cancels and resolves false on Escape key', async () => {
    const confirmPromise = modalConfirm({ title: 'Confirm Action', message: 'Test Escape' });
    (globalThis as any).document.dispatchEvent({
      type: 'keydown',
      key: 'Escape',
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    await expect(confirmPromise).resolves.toBe(false);
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  it('modalPrompt live validation disables confirm and displays error on invalid input', async () => {
    const promptPromise = modalPrompt({
      title: 'Rename Part',
      defaultValue: 'valid_name',
      validate: (val: string) => {
        if (!val.trim()) return 'Name cannot be empty';
        if (/[^a-zA-Z0-9_]/.test(val)) return 'Name must be alphanumeric';
        return null;
      },
    });

    expect(input.value).toBe('valid_name');
    expect(confirmBtn.disabled).toBe(false);
    expect(error.classList.contains('hidden')).toBe(true);

    // Enter invalid name with spaces
    input.value = 'invalid name with spaces';
    if (input.oninput) input.oninput({ target: input });

    expect(input.classList.contains('invalid')).toBe(true);
    expect(error.textContent).toBe('Name must be alphanumeric');
    expect(error.classList.contains('hidden')).toBe(false);
    expect(confirmBtn.disabled).toBe(true);

    // Pressing Enter must NOT submit while invalid
    (globalThis as any).document.dispatchEvent({
      type: 'keydown',
      key: 'Enter',
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    expect(overlay.classList.contains('active')).toBe(true); // Still open!

    // Fix the input
    input.value = 'good_name';
    if (input.oninput) input.oninput({ target: input });

    expect(input.classList.contains('invalid')).toBe(false);
    expect(error.classList.contains('hidden')).toBe(true);
    expect(confirmBtn.disabled).toBe(false);

    // Press Enter to submit
    (globalThis as any).document.dispatchEvent({
      type: 'keydown',
      key: 'Enter',
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    await expect(promptPromise).resolves.toBe('good_name');
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  it('modalPrompt cancels and resolves null on Close button', async () => {
    const promptPromise = modalPrompt({ title: 'Test Prompt' });
    closeBtn.click();
    await expect(promptPromise).resolves.toBeNull();
  });

  it('modalColorReplace populates palette options and returns selection result', async () => {
    const replacePromise = modalColorReplace({
      title: 'Replace Color',
      palette: { x: '#ff0000', y: '#00ff00', z: '#0000ff' },
      currentPart: 'head',
      currentColor: 'x',
    });

    expect(customSlot.classList.contains('hidden')).toBe(false);
    const fromSelect = customSlot.children[0]?.children[0]?.children[1] as MockElement;
    const toSelect = customSlot.children[0]?.children[1]?.children[1] as MockElement;
    const scopeSelect = customSlot.children[0]?.children[2]?.children[1] as MockElement;

    expect(fromSelect).toBeDefined();
    expect(toSelect).toBeDefined();
    expect(scopeSelect).toBeDefined();

    expect(fromSelect.value).toBe('x');
    // Change to 'y' and scope to 'all'
    toSelect.value = 'y';
    scopeSelect.value = 'all';

    confirmBtn.click();

    await expect(replacePromise).resolves.toEqual({
      fromChar: 'x',
      toChar: 'y',
      scope: 'all',
    });
  });

  it('opening a new modal aborts and cleans up previous active modal cleanly', async () => {
    const firstPromise = modalPrompt({ title: 'First' });
    const secondPromise = modalPrompt({ title: 'Second' });

    // First modal should resolve null upon abort
    await expect(firstPromise).resolves.toBeNull();

    // Second modal is active
    expect(title.textContent).toBe('Second');
    cancelBtn.click();
    await expect(secondPromise).resolves.toBeNull();
  });
});
