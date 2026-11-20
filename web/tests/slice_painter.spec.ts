import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const qio = readFileSync(resolve(process.cwd(), '../examples/qio.yaml'), 'utf8');

async function openQio(page: Page) {
  await page.addInitScript(text => {
    if (!sessionStorage.getItem('impossibru-yaml')) sessionStorage.setItem('impossibru-yaml', text);
  }, qio);
  await page.goto('/');
  await expect(page.locator('#sliceCanvas')).toBeVisible();
}
const stored = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('impossibru-project')!));
function decode(v: string): string[] {
  return [...v.matchAll(/(\d*)(\D)/g)].flatMap(m => Array(m[1] ? +m[1] : 1).fill(m[2]));
}
async function respond(page: Page, value?: string) {
  await expect(page.locator('#modalOverlay')).toBeVisible();
  if (value !== undefined) await page.locator('#modalInput').fill(value);
  await page.locator('#modalConfirmButton').click();
}

test('qio head shows the slice canvas and hides drawn views', async ({ page }) => {
  await openQio(page);
  await expect(page.locator('#errorBanner')).toBeHidden();
  await expect(page.locator('#frontCanvas')).toBeHidden();
  await expect(page.locator('#sideCanvas')).toBeHidden();
  await expect(page.locator('#backCanvas')).toBeHidden();
  await expect(page.locator('#sliceLabel')).toHaveText('Slice 1 / 21');
});

test('painting one cell on slice 0 changes exactly that voxel', async ({ page }) => {
  await openQio(page);
  const before = decode((await stored(page)).parts.head.voxels);
  await page.locator('#sliceCanvas').click({ position: { x: 3, y: 3 } });
  await page.waitForTimeout(300);
  await page.locator('#saveButton').click();
  await expect(page.locator('#status')).toHaveText('Saved');
  const head = (await stored(page)).parts.head;
  const after = decode(head.voxels);
  expect(after.length).toBe(before.length);
  const diff = after.map((c, i) => (c !== before[i] ? i : -1)).filter(i => i >= 0);
  expect(diff).toEqual([0]);
  expect(Math.floor(diff[0] / (29 * 24))).toBe(0);
});

test('arrow keys move through slices', async ({ page }) => {
  await openQio(page);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#sliceLabel')).toHaveText('Slice 2 / 21');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#sliceLabel')).toHaveText('Slice 1 / 21');
});

test('renaming a palette char rewrites head voxels', async ({ page }) => {
  await openQio(page);
  const rename = page.locator('#paletteEditor .swatch-rename');
  await rename.click();
  await respond(page, 'Z');
  await page.waitForTimeout(300);
  const doc = await stored(page);
  const cells = decode(doc.parts.head.voxels);
  expect(cells).toContain('Z');
  expect(cells).not.toContain('r');
  expect(Object.keys(doc.palette)).toContain('Z');
});

test('duplicate part keeps a grid part', async ({ page }) => {
  await openQio(page);
  await page.locator('#duplicatePart').click();
  await respond(page, 'head2');
  await page.waitForTimeout(300);
  const doc = await stored(page);
  expect(doc.parts.head2.voxels).toBe(doc.parts.head.voxels);
  expect(doc.parts.head2.size).toEqual([29, 21, 24]);
  await expect(page.locator('#sliceCanvas')).toBeVisible();
});

test('resizing depth keeps the voxel count', async ({ page }) => {
  await openQio(page);
  const count = (v: string) => decode(v).filter(c => c !== '.').length;
  const before = count((await stored(page)).parts.head.voxels);
  await page.locator('#partDepth').fill('26');
  await page.locator('#resizePart').click();
  await page.waitForTimeout(300);
  const head = (await stored(page)).parts.head;
  expect(head.size).toEqual([29, 21, 26]);
  expect(count(head.voxels)).toBe(before);
});

test('resize centres voxels in X/Z, keeps them at the bottom and shifts the pivot', async ({ page }) => {
  await openQio(page);
  const orig = (await stored(page)).parts.head;
  const [w, h, d] = orig.size as number[];
  const old = decode(orig.voxels);
  await page.locator('#partWidth').fill('32');
  await page.locator('#partDepth').fill('26');
  await page.locator('#resizePart').click();
  await page.waitForTimeout(300);
  const head = (await stored(page)).parts.head;
  expect(head.size).toEqual([32, h, 26]);
  const ox = Math.floor((32 - w) / 2), oz = Math.floor((26 - d) / 2);
  const next = decode(head.voxels);
  expect(next.length).toBe(32 * h * 26);
  let checked = 0;
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const c = old[x + z * w + y * w * d];
    if (c === '.') continue;
    expect(next[(x + ox) + (z + oz) * 32 + y * 32 * 26]).toBe(c);
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
  expect(next.filter(c => c !== '.').length).toBe(checked);
  expect(head.pivot).toEqual([orig.pivot[0] + ox, orig.pivot[1], orig.pivot[2] + oz]);
});

test('deleting a palette char used by a grid part is blocked', async ({ page }) => {
  await openQio(page);
  const before = await stored(page);
  await page.locator('#paletteEditor .swatch-delete').click();
  await expect(page.locator('#modalOverlay')).toContainText('still used');
  await page.locator('#modalConfirmButton').click();
  await page.waitForTimeout(300);
  const after = await stored(page);
  expect(Object.keys(after.palette)).toEqual(Object.keys(before.palette));
  expect(after.parts.head.voxels).toBe(before.parts.head.voxels);
});
