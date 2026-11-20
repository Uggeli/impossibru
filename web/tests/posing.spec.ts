import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

test.use({ viewport: { width: 1500, height: 960 }, reducedMotion: 'reduce' });

async function grabPoint(page: Page, name: string) {
  // An actual exposed sleeve pixel, away from its pivot and any handles.
  return page.evaluate(name => {
    const art = document.querySelector<SVGPathElement>(`.rig-artwork[data-bone="${name}"]`)!;
    const m = art.getScreenCTM()!, box = art.getBBox();
    for (let y = Math.floor(box.y + box.height - 1); y >= box.y; y--) {
      for (let x = Math.floor(box.x); x < box.x + box.width; x++) {
        const p = new DOMPoint(x + .5, y + .5).matrixTransform(m);
        if (document.elementFromPoint(p.x, p.y) === art) return { x: p.x, y: p.y };
      }
    }
    throw Error('No exposed sleeve pixel on ' + name);
  }, name);
}

async function center(page: Page, name: string) {
  return page.evaluate(name => {
    const dot = document.querySelector<SVGCircleElement>(`.rig-joint[aria-label="${name}"]`)!;
    const p = new DOMPoint(dot.cx.baseVal.value, dot.cy.baseVal.value).matrixTransform(dot.getScreenCTM()!);
    return { x: p.x, y: p.y };
  }, name);
}

for (const editor of ['browser', 'local']) {
  test.describe(editor + ' humanoid posing', () => {
    let url = '/?example=humanoid';
    let server: ChildProcess;
    test.beforeAll(async () => {
      if (editor === 'local') {
        server = spawn('python3', ['-u', '-m', 'spritebuilder', 'edit', 'examples/humanoid.yaml', '--no-browser'],
          { cwd: '..', stdio: ['ignore', 'pipe', 'inherit'] });
        for await (const line of createInterface({ input: server.stdout! })) {
          const address = line.match(/http:\/\/127\.0\.0\.1:\S+/);
          if (address) { url = address[0]; break; }
        }
        expect(url).toContain('token=');
      }
    });
    test.afterAll(() => server?.kill());
    test.beforeEach(async ({ page }) => {
      await page.goto(url);
      await page.locator('[data-workspace="animate"]').click();
      await page.locator('#clipList').getByText('idle', { exact: true }).click();
      await expect(page.locator('#rigImage')).toHaveAttribute('data-clip', 'idle');
      await expect(page.locator('.rig-artwork').first()).toBeVisible();
    });

    for (const [view, arm] of [['Front', 'left'], ['Front', 'right'], ['Side', 'right'], ['Opposite side', 'left']]) {
      test(view + ' ' + arm + ' sleeve selects and swings in one drag', async ({ page }) => {
        const bone = arm + '_lower_arm';
        if (view === 'Opposite side') await page.locator('#yaw').fill('270');
        else await page.locator('#view' + view).click();
        const yaw = view === 'Front' ? '0' : view === 'Side' ? '90' : '270';
        await expect(page.locator('#rigImage')).toHaveAttribute('data-direction', yaw);
        if (view !== 'Front') {
          // Both sleeves share a part and project onto each other in idle.
          const farArm = arm === 'right' ? 'left' : 'right';
          await expect(page.locator(`.rig-artwork[data-bone="${farArm}_lower_arm"]`)).toHaveCount(0);
        }
        const p = await grabPoint(page, bone);
        const pivot = await center(page, bone);
        const image = page.locator('#rigImage');
        const before = await image.getAttribute('src');
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await expect(page.locator('#boneTree .active')).toHaveText(bone);
        await expect(page.locator('.rig-outline')).toBeVisible();
        await expect(page.locator('.rig-ring')).toBeVisible();
        await expect(page.locator('#undoButtonRig')).toBeDisabled();
        // Quarter-turn around the elbow, retaining the grab radius.
        await page.mouse.move(pivot.x + p.y - pivot.y, pivot.y - p.x + pivot.x, { steps: 4 });
        await expect.poll(() => image.getAttribute('src')).not.toBe(before);
        await page.mouse.up();
        await expect(page.getByRole('button', { name: 'rotation, frame 0, keyframe', exact: true })).toBeVisible();
        const after = await image.getAttribute('src');
        const planted = await center(page, bone);
        expect(Math.hypot(planted.x - pivot.x, planted.y - pivot.y)).toBeLessThan(.1);
        await page.locator('#play').click();
        await expect(page.locator('#timeValue')).not.toHaveText('Frame 0');
        await page.locator('#play').click();
        await page.getByRole('button', { name: 'Frame 0', exact: true }).click();
        await expect.poll(() => image.getAttribute('src')).toBe(after);
        await page.locator('#undoButtonRig').click();
        await expect.poll(() => image.getAttribute('src')).toBe(before);
        await expect(page.locator('#undoButtonRig')).toBeDisabled();
      });
    }

    test('Rotate ring keys the current frame and a cancelled drag leaves it untouched', async ({ page }) => {
      await page.getByRole('button', { name: 'Frame 1', exact: true }).click();
      await expect(page.locator('#rigImage')).toHaveAttribute('data-frame', '1');
      await page.keyboard.press('e');
      await expect(page.locator('[data-pose-tool="rotate"]')).toHaveAttribute('aria-pressed', 'true');
      const point = await grabPoint(page, 'left_lower_arm');
      await page.mouse.click(point.x, point.y);
      const ringPoint = await page.evaluate(() => {
        const ring = document.querySelector<SVGCircleElement>('.rig-ring')!;
        const p = new DOMPoint(ring.cx.baseVal.value + ring.r.baseVal.value, ring.cy.baseVal.value)
          .matrixTransform(ring.getScreenCTM()!);
        return { x: p.x, y: p.y };
      });
      await page.evaluate(() => {
        document.addEventListener('pointerdown', e => {
          document.querySelector<SVGSVGElement>('#rigOverlay')!.dataset.testPointer = String(e.pointerId);
        }, true);
      });
      const before = await page.locator('#rigImage').getAttribute('src');
      for (const cancel of [true, false]) {
        await page.mouse.move(ringPoint.x, ringPoint.y);
        await page.mouse.down();
        await page.mouse.move(ringPoint.x, ringPoint.y + 32);
        await expect.poll(() => page.locator('#rigImage').getAttribute('src')).not.toBe(before);
        if (cancel) {
          await page.evaluate(() => {
            const svg = document.querySelector<SVGSVGElement>('#rigOverlay')!;
            const pointerId = Number(svg.dataset.testPointer);
            if (!svg.hasPointerCapture(pointerId)) throw Error('No captured pointer ' + pointerId);
            svg.dispatchEvent(new PointerEvent('pointercancel', { pointerId, bubbles: true }));
          });
          await expect.poll(() => page.locator('#rigImage').getAttribute('src')).toBe(before);
          await expect(page.locator('#undoButtonRig')).toBeDisabled();
        }
        await page.mouse.up();
      }
      await expect(page.locator('#timeline .track-row button.key')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'rotation, frame 1, keyframe' })).toBeVisible();
    });

    test('Move arrows translate the root and Rig requires Move pivot to reposition an elbow', async ({ page }) => {
      await page.keyboard.press('w');
      await page.locator('#boneTree').getByRole('button', { name: 'root', exact: true }).click();
      const arrow = page.locator('.rig-arrow.x');
      await expect(arrow).toBeVisible();
      const arrowPoint = await page.evaluate(() => {
        const arrow = document.querySelector<SVGPathElement>('.rig-arrow.x')!;
        const p = new DOMPoint(8, 0).matrixTransform(arrow.getScreenCTM()!);
        return { x: p.x, y: p.y };
      });
      const root = await center(page, 'root');
      await page.mouse.move(arrowPoint.x, arrowPoint.y);
      await page.mouse.down();
      await page.mouse.move(arrowPoint.x + 20, arrowPoint.y + 12);
      await page.mouse.up();
      await expect(page.locator('#undoButtonRig')).toBeEnabled();
      const shifted = await center(page, 'root');
      expect(shifted.x - root.x).toBeCloseTo(20, 0);
      expect(shifted.y).toBeCloseTo(root.y, 0);
      await page.locator('#undoButtonRig').click();
      await page.locator('[data-workspace="rig"]').click();
      await expect(page.locator('.rig-artwork').first()).toBeVisible();
      await page.keyboard.press('w');
      await expect(page.getByRole('button', { name: 'Move pivot W' })).toHaveAttribute('aria-pressed', 'true');
      const elbow = await center(page, 'left_lower_arm');
      await page.mouse.move(elbow.x, elbow.y);
      await page.mouse.down();
      await page.mouse.move(elbow.x + 15, elbow.y - 10);
      await page.mouse.up();
      await expect(page.locator('#undoButtonRig')).toBeEnabled();
      const moved = await center(page, 'left_lower_arm');
      expect(moved.x - elbow.x).toBeCloseTo(15, 0);
      expect(moved.y - elbow.y).toBeCloseTo(-10, 0);
    });

    test('grabbing an IK-controlled leg highlights and keys its target', async ({ page }) => {
      await page.locator('#clipList').getByText('walk', { exact: true }).click();
      await page.getByRole('button', { name: 'Frame 1', exact: true }).click();
      await expect(page.locator('#rigImage')).toHaveAttribute('data-frame', '1');
      await expect(page.locator('.rig-handle').first()).toBeVisible();
      const p = await grabPoint(page, 'left_lower_leg');
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await expect(page.locator('.rig-handle.selected')).toHaveAttribute('aria-label', 'left_leg target');
      await expect(page.locator('.rig-arrow')).toHaveCount(2);
      await page.mouse.move(p.x + 12, p.y - 16);
      await page.mouse.up();
      await expect(page.getByRole('button', { name: 'target, frame 1, keyframe', exact: true })).toBeVisible();
    });

    test('click selects and dragging the elbow swings its parent', async ({ page }) => {
      const p = await grabPoint(page, 'left_lower_arm');
      await page.mouse.click(p.x, p.y);
      await expect(page.locator('#boneTree .active')).toHaveText('left_lower_arm');
      await expect(page.locator('#undoButtonRig')).toBeDisabled();
      const elbow = await center(page, 'left_lower_arm');
      const shoulder = await center(page, 'left_upper_arm');
      await page.mouse.move(elbow.x, elbow.y);
      await page.mouse.down();
      await page.mouse.move(shoulder.x + elbow.y - shoulder.y, shoulder.y);
      await page.mouse.up();
      await expect(page.locator('#boneTree .active')).toHaveText('left_upper_arm');
      await expect(page.getByRole('button', { name: 'rotation, frame 0, keyframe' })).toBeVisible();
      const moved = await center(page, 'left_lower_arm');
      expect(moved.x).toBeCloseTo(shoulder.x + elbow.y - shoulder.y, 0);
      expect(moved.y).toBeCloseTo(shoulder.y, 0);
    });
  });
}
