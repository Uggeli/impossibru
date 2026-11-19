import { test, expect } from '@playwright/test';

test.describe('Challenger 2 Adversarial Stress Tests: Drag-to-Retime, Collision Handling, Undo/Redo & Playback Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const welcomeNew = page.locator('#welcomeNew');
    if (await welcomeNew.isVisible()) {
      await welcomeNew.click();
      await page.waitForLoadState('networkidle');
    }
    await expect(page.locator('button[data-workspace="parts"]')).toBeVisible();
    await page.locator('button[data-workspace="animate"]').click();
    await expect(page.locator('#timeline')).toBeVisible();
  });

  function vecInput(page: any, label: string, axis: 'X' | 'Y' | 'Z') {
    return page.locator('#boneInspector .vec').filter({ has: page.getByText(label, { exact: true }) }).locator(`input[title="${axis}"]`);
  }

  // =========================================================================
  // 1. DRAG-TO-RETIME BOUNDARY CONDITIONS & CLAMPING
  // =========================================================================

  test('Adversarial: Keyframe drag across full boundary 0 to L-1 and L-1 to 0', async ({ page }) => {
    const rotRow = page.locator('#timeline .track-row').filter({ hasText: 'rotation' });
    const frame0Btn = rotRow.locator('button').nth(1); // Frame 0
    const frame7Btn = rotRow.locator('button').nth(8); // Frame 7 (L-1)

    // 1. Create key at frame 0 with rotation Y = 40
    await frame0Btn.click();
    const rotY = vecInput(page, 'Rotation °', 'Y');
    await rotY.fill('40');
    await rotY.dispatchEvent('change');
    await page.waitForTimeout(100);

    await expect(frame0Btn).toHaveClass(/key/);
    await expect(frame0Btn).toHaveText('◆');

    // 2. Drag frame 0 to frame 7 (extreme right boundary)
    const box0 = await frame0Btn.boundingBox();
    const box7 = await frame7Btn.boundingBox();
    expect(box0).toBeTruthy();
    expect(box7).toBeTruthy();

    await page.mouse.move(box0!.x + box0!.width / 2, box0!.y + box0!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box7!.x + box7!.width / 2, box7!.y + box7!.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    await expect(frame0Btn).not.toHaveClass(/key/);
    await expect(frame7Btn).toHaveClass(/key/);
    await expect(page.locator('#frameValue')).toHaveText('7');
    await expect(rotY).toHaveValue('40');

    // 3. Drag frame 7 back to frame 0 (extreme left boundary)
    const newBox0 = await frame0Btn.boundingBox();
    const newBox7 = await frame7Btn.boundingBox();
    await page.mouse.move(newBox7!.x + newBox7!.width / 2, newBox7!.y + newBox7!.height / 2);
    await page.mouse.down();
    await page.mouse.move(newBox0!.x + newBox0!.width / 2, newBox0!.y + newBox0!.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    await expect(frame7Btn).not.toHaveClass(/key/);
    await expect(frame0Btn).toHaveClass(/key/);
    await expect(page.locator('#frameValue')).toHaveText('0');
    await expect(rotY).toHaveValue('40');
  });

  test('Adversarial: Out-of-bounds pointer drag clamps safely to boundaries [0, L-1]', async ({ page }) => {
    const rotRow = page.locator('#timeline .track-row').filter({ hasText: 'rotation' });
    const frame3Btn = rotRow.locator('button').nth(4); // Frame 3
    const frame0Btn = rotRow.locator('button').nth(1); // Frame 0
    const frame7Btn = rotRow.locator('button').nth(8); // Frame 7

    // 1. Create key at frame 3
    await frame3Btn.click();
    const rotZ = vecInput(page, 'Rotation °', 'Z');
    await rotZ.fill('75');
    await rotZ.dispatchEvent('change');
    await page.waitForTimeout(100);

    // 2. Drag far beyond the left edge of timeline (x = 0)
    const box3 = await frame3Btn.boundingBox();
    expect(box3).toBeTruthy();

    await page.mouse.move(box3!.x + box3!.width / 2, box3!.y + box3!.height / 2);
    await page.mouse.down();
    await page.mouse.move(0, box3!.y + box3!.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Should clamp to frame 0
    await expect(frame3Btn).not.toHaveClass(/key/);
    await expect(frame0Btn).toHaveClass(/key/);
    await expect(page.locator('#frameValue')).toHaveText('0');

    // 3. Drag far beyond the right edge of viewport (x = 2000)
    const newBox0 = await frame0Btn.boundingBox();
    await page.mouse.move(newBox0!.x + newBox0!.width / 2, newBox0!.y + newBox0!.height / 2);
    await page.mouse.down();
    await page.mouse.move(2000, newBox0!.y + newBox0!.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Should clamp to frame 7 (L-1)
    await expect(frame0Btn).not.toHaveClass(/key/);
    await expect(frame7Btn).toHaveClass(/key/);
    await expect(page.locator('#frameValue')).toHaveText('7');
    await expect(rotZ).toHaveValue('75');
  });

  // =========================================================================
  // 2. MULTI-STEP DRAG RETIME UNDO / REDO CHAIN & COLLISION RESTORATION
  // =========================================================================

  test('Adversarial: Multi-step consecutive retime undo/redo history preserves exact track trajectory', async ({ page }) => {
    const rotRow = page.locator('#timeline .track-row').filter({ hasText: 'rotation' });
    const f0 = rotRow.locator('button').nth(1);
    const f2 = rotRow.locator('button').nth(3);
    const f4 = rotRow.locator('button').nth(5);
    const f6 = rotRow.locator('button').nth(7);

    // Create key at frame 0
    await f0.click();
    await vecInput(page, 'Rotation °', 'X').fill('50');
    await vecInput(page, 'Rotation °', 'X').dispatchEvent('change');
    await page.waitForTimeout(100);

    // Step 1: Retime 0 -> 2
    let bSrc = await f0.boundingBox();
    let bDst = await f2.boundingBox();
    await page.mouse.move(bSrc!.x + bSrc!.width / 2, bSrc!.y + bSrc!.height / 2);
    await page.mouse.down();
    await page.mouse.move(bDst!.x + bDst!.width / 2, bDst!.y + bDst!.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    await expect(f2).toHaveClass(/key/);

    // Step 2: Retime 2 -> 4
    bSrc = await f2.boundingBox();
    bDst = await f4.boundingBox();
    await page.mouse.move(bSrc!.x + bSrc!.width / 2, bSrc!.y + bSrc!.height / 2);
    await page.mouse.down();
    await page.mouse.move(bDst!.x + bDst!.width / 2, bDst!.y + bDst!.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    await expect(f4).toHaveClass(/key/);

    // Step 3: Retime 4 -> 6
    bSrc = await f4.boundingBox();
    bDst = await f6.boundingBox();
    await page.mouse.move(bSrc!.x + bSrc!.width / 2, bSrc!.y + bSrc!.height / 2);
    await page.mouse.down();
    await page.mouse.move(bDst!.x + bDst!.width / 2, bDst!.y + bDst!.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    await expect(f6).toHaveClass(/key/);

    // Undo Step 3 -> Key returns to frame 4
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    await expect(f6).not.toHaveClass(/key/);
    await expect(f4).toHaveClass(/key/);

    // Undo Step 2 -> Key returns to frame 2
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    await expect(f4).not.toHaveClass(/key/);
    await expect(f2).toHaveClass(/key/);

    // Undo Step 1 -> Key returns to frame 0
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    await expect(f2).not.toHaveClass(/key/);
    await expect(f0).toHaveClass(/key/);

    // Redo Step 1 -> Key advances to frame 2
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(150);
    await expect(f0).not.toHaveClass(/key/);
    await expect(f2).toHaveClass(/key/);

    // Redo Step 2 -> Key advances to frame 4
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(150);
    await expect(f2).not.toHaveClass(/key/);
    await expect(f4).toHaveClass(/key/);

    // Redo Step 3 -> Key advances to frame 6
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(150);
    await expect(f4).not.toHaveClass(/key/);
    await expect(f6).toHaveClass(/key/);
  });

  test('Adversarial: Undo of collision overwrite restores both original keyframes perfectly', async ({ page }) => {
    const rotRow = page.locator('#timeline .track-row').filter({ hasText: 'rotation' });
    const f1 = rotRow.locator('button').nth(2);
    const f5 = rotRow.locator('button').nth(6);

    // 1. Key 1 at frame 1 (value = 25)
    await f1.click();
    await vecInput(page, 'Rotation °', 'X').fill('25');
    await vecInput(page, 'Rotation °', 'X').dispatchEvent('change');
    await page.waitForTimeout(100);

    // 2. Key 2 at frame 5 (value = 85)
    await f5.click();
    await vecInput(page, 'Rotation °', 'X').fill('85');
    await vecInput(page, 'Rotation °', 'X').dispatchEvent('change');
    await page.waitForTimeout(100);

    await expect(rotRow.locator('button.key')).toHaveCount(2);

    // 3. Drag frame 1 onto frame 5 (collision overwrite)
    const b1 = await f1.boundingBox();
    const b5 = await f5.boundingBox();
    await page.mouse.move(b1!.x + b1!.width / 2, b1!.y + b1!.height / 2);
    await page.mouse.down();
    await page.mouse.move(b5!.x + b5!.width / 2, b5!.y + b5!.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Verify 1 key remains at frame 5 with value 25
    await expect(rotRow.locator('button.key')).toHaveCount(1);
    await expect(f1).not.toHaveClass(/key/);
    await expect(f5).toHaveClass(/key/);
    await expect(vecInput(page, 'Rotation °', 'X')).toHaveValue('25');

    // 4. Undo collision overwrite
    await page.locator('#undoButtonRig').click();
    await page.waitForTimeout(200);

    // Verify BOTH keys are fully restored with their respective values
    await expect(rotRow.locator('button.key')).toHaveCount(2);
    await expect(f1).toHaveClass(/key/);
    await expect(f5).toHaveClass(/key/);

    await f1.click();
    await expect(vecInput(page, 'Rotation °', 'X')).toHaveValue('25');

    await f5.click();
    await expect(vecInput(page, 'Rotation °', 'X')).toHaveValue('85');
  });

  // =========================================================================
  // 3. PLAYBACK CONTROLS, RAPID TOGGLES & NON-LOOPING HALT
  // =========================================================================

  test('Adversarial: 20 rapid Space key toggles execute cleanly without interval leaks or race conditions', async ({ page }) => {
    await page.locator('[data-mode="character"]').click();
    const playBtn = page.locator('#play');
    await expect(playBtn).toHaveText('Play');

    // Rapidly toggle Space 20 times
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(300);

    // Verify UI is in a consistent state ('Play' or 'Pause') without errors
    const text = await playBtn.textContent();
    expect(['Play', 'Pause']).toContain(text);
    await expect(page.locator('#rigErrorBanner')).toHaveClass(/hidden/);

    // Stop playback if playing
    if (text === 'Pause') {
      await page.keyboard.press('Space');
      await expect(playBtn).toHaveText('Play');
    }
  });

  test('Adversarial: Multi-cycle boundary wrap-around via [ and ] shortcuts', async ({ page }) => {
    await page.locator('[data-mode="character"]').click();
    const frameValue = page.locator('#frameValue');

    // Start at 0
    await page.keyboard.press('Home');
    await expect(frameValue).toHaveText('0');

    // 16 backward steps (2 full cycles backwards on 8-frame clip)
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press('[');
    }
    // 0 - 16 = -16 = 0 (mod 8)
    await expect(frameValue).toHaveText('0');

    // Step back once -> should be 7
    await page.keyboard.press('[');
    await expect(frameValue).toHaveText('7');

    // 16 forward steps (2 full cycles forwards)
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press(']');
    }
    await expect(frameValue).toHaveText('7');

    // Step forward once -> should be 0
    await page.keyboard.press(']');
    await expect(frameValue).toHaveText('0');
  });

  test('Adversarial: Non-looping animation halts cleanly at frame L-1 and resets play button', async ({ page }) => {
    await page.locator('[data-mode="character"]').click();

    // 1. Set clip frames to 4 and loop to false
    const framesInput = page.locator('#clipTiming label:has-text("Frames") input');
    await framesInput.fill('4');
    await framesInput.dispatchEvent('change');

    const loopCheckbox = page.locator('#clipTiming input[type="checkbox"]');
    if (await loopCheckbox.isChecked()) {
      await loopCheckbox.uncheck();
    }
    await page.waitForTimeout(100);

    // Set FPS to 10 so 4 frames play in ~400ms
    const fpsInput = page.locator('#clipTiming label:has-text("FPS") input');
    await fpsInput.fill('10');
    await fpsInput.dispatchEvent('change');
    await page.waitForTimeout(100);

    // 2. Start from frame 0
    await page.keyboard.press('Home');
    await expect(page.locator('#frameValue')).toHaveText('0');

    // 3. Start playback
    const playBtn = page.locator('#play');
    await playBtn.click();
    await expect(playBtn).toHaveText('Pause');

    // 4. Wait for animation to reach frame 3 (L-1) and halt
    await page.waitForTimeout(800);

    // Playback must halt automatically at frame 3 and toggle button back to 'Play'
    await expect(playBtn).toHaveText('Play');
    await expect(page.locator('#frameValue')).toHaveText('3');

    // Wait an additional 300ms to confirm no further advancement occurs
    await page.waitForTimeout(300);
    await expect(page.locator('#frameValue')).toHaveText('3');
  });

  // =========================================================================
  // 4. SHORTCUT ISOLATION ACROSS ALL TEXT INPUTS & MODALS
  // =========================================================================

  test('Adversarial: Typing playback/tool shortcuts in text inputs and modals never triggers timeline/playback actions', async ({ page }) => {
    const playBtn = page.locator('#play');
    const frameValue = page.locator('#frameValue');

    await page.locator('[data-mode="character"]').click();
    await page.keyboard.press('Home');
    await expect(frameValue).toHaveText('0');

    // 1. Test FPS input isolation
    const fpsInput = page.locator('#clipTiming label:has-text("FPS") input');
    await fpsInput.focus();
    // Type shortcuts: Space, [, ], Home, End, Delete, m, p
    await page.keyboard.press('Space');
    await page.keyboard.press('[');
    await page.keyboard.press(']');
    await page.keyboard.press('Home');
    await page.keyboard.press('End');
    await page.keyboard.press('m');
    await page.keyboard.press('p');

    // Verify playback NOT started and frame unchanged
    await expect(playBtn).toHaveText('Play');
    await expect(frameValue).toHaveText('0');

    // 2. Test Bone vector input isolation
    const rotX = vecInput(page, 'Rotation °', 'X');
    await rotX.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('[');
    await page.keyboard.press(']');
    await page.keyboard.press('Home');

    await expect(playBtn).toHaveText('Play');
    await expect(frameValue).toHaveText('0');

    // 3. Test Modal Input isolation (e.g. Add Clip modal)
    await page.locator('#addClip').click();
    const modalOverlay = page.locator('#modalOverlay');
    await expect(modalOverlay).toBeVisible();

    const modalInput = page.locator('#modalInput');
    await modalInput.focus();
    await page.keyboard.type('test_clip with spaces');
    await page.keyboard.press('Space');
    await page.keyboard.press('[');
    await page.keyboard.press(']');
    await page.keyboard.press('Home');

    // Verify modal remains open, play not triggered, frame not shifted
    await expect(modalOverlay).toBeVisible();
    await expect(playBtn).toHaveText('Play');
    await expect(frameValue).toHaveText('0');

    // Close modal
    await page.keyboard.press('Escape');
    await expect(modalOverlay).toBeHidden();
  });
});
