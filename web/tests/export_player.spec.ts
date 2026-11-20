import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

test('exported player loads the actual metadata and draws the sprite', async ({page, context}) => {
  await page.goto('/');
  await page.locator('#welcomeNew').click();
  await page.locator('#exportZipButton').click();
  await page.getByLabel('Include JavaScript player and decoder').check();
  const download = page.waitForEvent('download');
  await page.locator('#confirmExport').click();
  const files = unzipSync(await readFile((await (await download).path())!));
  expect(files['player/decode-voxels.js']).toBeDefined();

  const demo = await context.newPage();
  const mime = {html:'text/html', js:'text/javascript', json:'application/json', png:'image/png'};
  await demo.route('**/bundle/**', route => {
    const name = new URL(route.request().url()).pathname.slice('/bundle/'.length);
    const bytes = files[name];
    return bytes ? route.fulfill({contentType:mime[name.split('.').pop()!], body:Buffer.from(bytes)})
      : route.fulfill({status:404});
  });
  await demo.goto('/bundle/player/index.html');
  await expect(demo.locator('#clip')).toHaveValue('idle');
  await expect(demo.locator('#angle option')).toHaveCount(8);
  await expect.poll(() => demo.locator('canvas').evaluate(canvas =>
    canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data.some(channel => channel > 0)
  )).toBe(true);
});

test('browser export dialog warns that it is a quick preview', async ({page}) => {
  await page.goto('/');
  await page.locator('#welcomeNew').click();
  await page.locator('#exportZipButton').click();
  await expect(page.locator('#exportBrowserNote')).toBeVisible();
  await expect(page.locator('#exportBrowserNote')).toHaveText('Browser export is a quick preview: no lighting, trim, or shell. Use "impossibru edit" for final spritesheets.');
});
