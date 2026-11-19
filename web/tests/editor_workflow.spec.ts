import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { load } from 'js-yaml';
import type { ProjectDocument } from '../src/types';

async function draft(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => {
      const req = indexedDB.open('impossibru', 1);
      req.onsuccess = () => resolve(req.result);
    });
    return new Promise<{document: ProjectDocument; time: number}>(resolve => {
      const req = db.transaction('drafts').objectStore('drafts').get('current');
      req.onsuccess = () => { db.close(); resolve(req.result); };
    });
  });
}

test('trying and painting an example preserves the previous working draft', async ({ page, context }) => {
  await page.goto('/');
  await page.locator('#welcomeNew').click();
  await page.locator('#frontCanvas').click({position:{x:5,y:5}});
  await expect.poll(async () => (await draft(page)).document.parts.part.front[0]).toBe('x');
  const original = await draft(page);

  const example = await context.newPage();
  await example.goto('/');
  await expect(example.locator('#welcomeRecover')).toContainText('untitled');
  await example.locator('#welcomeExample').click();
  await example.locator('#frontCanvas').click({position:{x:5,y:5}});
  await expect.poll(() => example.evaluate(() => JSON.parse(sessionStorage.getItem('impossibru-project')!).parts.torso.front[0])).toBe('b');
  expect(await draft(example)).toEqual(original);

  const resume = await context.newPage();
  await resume.goto('/');
  await resume.locator('#welcomeRecover').click();
  await expect(resume.locator('#partList button.active')).toHaveText('part');
  expect(await draft(resume)).toEqual(original);

  await example.locator('#keepExample').click();
  await example.locator('#modalConfirmButton').click();
  await expect.poll(async () => (await draft(example)).document.export?.name).toBe('humanoid');
  await resume.locator('#frontCanvas').click({position:{x:100,y:5}});
  await expect(resume.locator('#status')).toContainText('Recovery draft changed');
  expect((await draft(example)).document.export?.name).toBe('humanoid');
});

for (const [width,height] of [[1024,768],[1280,800],[1440,900]]) {
  test('paint views and playback at ' + width, async ({page}, info) => {
    await page.setViewportSize({width,height});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto('/');
    await page.locator('#welcomeExample').click();
    await expect(page.locator('#clip')).toHaveValue('walk');
    await expect(page.locator('#previewImage')).toHaveAttribute('data-rendered','true');
    const preview = await page.locator('.preview-panel').boundingBox();
    const back = await page.locator('#backCanvas').boundingBox();
    expect(back!.x + back!.width).toBeLessThanOrEqual(preview!.x);
    await page.locator('[data-focus="side"]').click();
    await expect(page.locator('.primary-view canvas')).toHaveId('sideCanvas');
    await expect(page.locator('#status')).toHaveText('Ready');
    await page.screenshot({path:info.outputPath('parts.png')});
    await page.locator('[data-workspace="rig"]').click();
    await expect(page.locator('#rigImage')).toHaveAttribute('data-rendered','true');
    await page.screenshot({path:info.outputPath('rig.png')});
    await page.locator('[data-workspace="animate"]').click();
    await page.locator('#play').click();
    await expect(page.locator('#timeValue')).not.toHaveText('Frame 0');
    await page.locator('#play').click();
    await page.screenshot({path:info.outputPath('animate.png')});
  });
}

test('paint the shirt, export the walk and reopen its YAML', async ({page, context}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  await page.locator('#welcomeExample').click();
  await page.locator('#frontCanvas').click({position:{x:5,y:5}});
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('impossibru-project')!).parts.torso.front[0])).toBe('b');
  const image = page.locator('#previewImage');
  const first = await image.getAttribute('src');
  await page.keyboard.press(']');
  await expect(image).not.toHaveAttribute('src',first!);
  await page.locator('#exportZipButton').click();
  await page.getByLabel('idle',{exact:true}).uncheck();
  await page.locator('#cancelExport').click();
  await page.locator('#exportZipButton').click();
  await expect(page.getByLabel('idle',{exact:true})).toBeChecked();
  await page.getByLabel('idle',{exact:true}).uncheck();
  await page.getByLabel('attack',{exact:true}).uncheck();
  const download = page.waitForEvent('download');
  await page.locator('#confirmExport').click();
  const files = unzipSync(await readFile((await (await download).path())!));
  const yaml = files['humanoid.yaml'];
  expect((load(strFromU8(yaml)) as ProjectDocument).parts.torso.front[0]).toBe('b');
  expect(Object.keys(JSON.parse(strFromU8(files['humanoid.json'])).animations)).toEqual(['walk']);
  expect(files['humanoid.png'].length).toBeGreaterThan(100);
  const reopen = await context.newPage();
  await reopen.addInitScript(() => Object.defineProperty(window,'showOpenFilePicker',{value:undefined}));
  await reopen.goto('/');
  const chooser = reopen.waitForEvent('filechooser');
  await reopen.locator('#welcomeOpen').click();
  await (await chooser).setFiles({name:'humanoid.yaml',mimeType:'application/yaml',buffer:Buffer.from(yaml)});
  await expect(reopen.locator('#partList button.active')).toHaveText('torso');
  expect((await draft(reopen)).document.parts.torso.front[0]).toBe('b');
});

test('cancelled and invalid file opens preserve the draft; Save retries the picked file', async ({ page }) => {
  await page.addInitScript(() => {
    let attempt = 0;
    let saves = 0;
    Object.defineProperty(window,'showOpenFilePicker',{value: async () => {
      attempt++;
      if (attempt === 1) throw new DOMException('Cancelled','AbortError');
      const body = attempt === 2 ? 'parts: [' : await (await fetch('./example.yaml')).text();
      return [{
        name:'artist.yaml',
        getFile:async () => new File([body],'artist.yaml'),
        requestPermission:async () => 'granted',
        createWritable:async () => {
          if (!saves++) throw new Error('File unavailable');
          return {write:async (text: string) => sessionStorage.setItem('test-file',text), close:async () => {}};
        }
      }];
    }});
  });
  await page.goto('/');
  await page.locator('#welcomeOpen').click();
  await expect(page.locator('#welcome')).toBeVisible();
  await page.locator('#welcomeOpen').click();
  await expect(page.locator('#modalOverlay')).toBeVisible();
  await page.locator('#modalConfirmButton').click();
  expect(await draft(page)).toBeUndefined();
  await page.locator('#welcomeOpen').click();
  await expect(page.locator('#filePath')).toHaveText('artist.yaml');
  await page.locator('#frontCanvas').click({position:{x:5,y:5}});
  await expect(page.locator('#saveButton')).toBeEnabled();
  await page.locator('#saveButton').click();
  await expect(page.locator('#errorBanner')).toContainText('File unavailable');
  await expect(page.locator('#saveButton')).toBeEnabled();
  await page.locator('#saveButton').click();
  await expect(page.locator('#status')).toHaveText('Saved');
  const saved = await page.evaluate(() => sessionStorage.getItem('test-file'));
  expect((load(saved!) as ProjectDocument).parts.torso.front[0]).toBe('s');
});
