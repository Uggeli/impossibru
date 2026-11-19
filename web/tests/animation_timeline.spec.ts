import { test, expect } from '@playwright/test';

test.describe('Animation Timeline & Playback Controls (Tiers 1-4)', () => {
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

  // Precise helper for vector input
  function vecInput(page: any, label: string, axis: 'X' | 'Y' | 'Z') {
    return page.locator('#boneInspector .vec').filter({ has: page.getByText(label, { exact: true }) }).locator(`input[title="${axis}"]`);
  }

  async function respondModal(page: any, value: string | boolean | null = true) {
    const overlay = page.locator('#modalOverlay');
    await expect(overlay).toBeVisible();
    if (typeof value === 'string') {
      const input = page.locator('#modalInput');
      await input.fill(value);
      await input.dispatchEvent('input');
      await page.locator('#modalConfirmButton').click();
    } else if (value === false || value === null) {
      await page.locator('#modalCancelButton').click();
    } else {
      await page.locator('#modalConfirmButton').click();
    }
  }

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (HAPPY PATH)
  // =========================================================================

  test('Tier 1: Switch to Animate workspace reveals timeline, clip controls, and keyframe actions', async ({ page }) => {
    await expect(page.locator('#timeline')).toBeVisible();
    await expect(page.locator('#clipSection')).toBeVisible();
    await expect(page.locator('#clipList')).toBeVisible();
    await expect(page.locator('#clipTiming')).toBeVisible();
    await expect(page.locator('#deleteKey')).toBeVisible();
    await expect(page.locator('#previousKey')).toBeVisible();
    await expect(page.locator('#nextKey')).toBeVisible();
    await expect(page.locator('#rigModeTitle')).toHaveText('Animate');
  });

  test('Tier 1: Timeline renders track rows for selected bone', async ({ page }) => {
    const trackRows = page.locator('#timeline .track-row');
    await expect(trackRows).toHaveCount(2); // translation & rotation
    await expect(trackRows.nth(0).locator('button').first()).toHaveText('translation');
    await expect(trackRows.nth(1).locator('button').first()).toHaveText('rotation');
  });

  test('Tier 1: Frame selection on timeline updates current frame indicator and value', async ({ page }) => {
    // Switch to character mode so frame controls are active
    await page.locator('[data-mode="character"]').click();

    // Click on frame 3 button on translation track
    const frameBtn = page.locator('#timeline .track-row').first().locator('button').nth(4); // index 0 is label, 1..8 are frames 0..7
    await frameBtn.click();
    await page.waitForTimeout(200);

    await expect(page.locator('#frameValue')).toHaveText('3');
    await expect(frameBtn).toHaveClass(/current/);
  });

  test('Tier 1: Keyframe creation via bone inspector edits', async ({ page }) => {
    // Select frame 2
    const frame2Btn = page.locator('#timeline .track-row').filter({ hasText: 'rotation' }).locator('button').nth(3);
    await frame2Btn.click();

    // Modify bone rotation X to 45
    const rotX = vecInput(page, 'Rotation °', 'X');
    await rotX.fill('45');
    await rotX.dispatchEvent('change');
    await page.waitForTimeout(200);

    // Frame 2 on rotation track should now have a key indicator
    await expect(frame2Btn).toHaveClass(/key/);
    await expect(frame2Btn).toHaveText('◆');

    // Key inspector should indicate authored key
    await expect(page.locator('#keyInspector p')).toHaveText('Authored key');
  });

  test('Tier 1: Keyframe deletion removes keyframe at active frame', async ({ page }) => {
    // First create a keyframe at frame 1
    const frame1Btn = page.locator('#timeline .track-row').filter({ hasText: 'translation' }).locator('button').nth(2);
    await frame1Btn.click();

    const transY = vecInput(page, 'Position', 'Y');
    await transY.fill('2.5');
    await transY.dispatchEvent('change');
    await page.waitForTimeout(200);

    await expect(frame1Btn).toHaveClass(/key/);

    // Click Delete key button
    await page.locator('#deleteKey').click();
    await page.waitForTimeout(200);

    // Key should be removed
    await expect(frame1Btn).not.toHaveClass(/key/);
    await expect(frame1Btn).toHaveText('');
  });

  test('Tier 1: Keyframe navigation with Previous key and Next key buttons', async ({ page }) => {
    // Create keys at frame 1 and frame 5
    const frame1 = page.locator('#timeline .track-row').filter({ hasText: 'rotation' }).locator('button').nth(2);
    const frame5 = page.locator('#timeline .track-row').filter({ hasText: 'rotation' }).locator('button').nth(6);

    await frame1.click();
    await vecInput(page, 'Rotation °', 'Y').fill('15');
    await vecInput(page, 'Rotation °', 'Y').dispatchEvent('change');

    await frame5.click();
    await vecInput(page, 'Rotation °', 'Y').fill('30');
    await vecInput(page, 'Rotation °', 'Y').dispatchEvent('change');

    // Go to frame 0
    await page.locator('#timeline .track-row').filter({ hasText: 'rotation' }).locator('button').nth(1).click();
    await expect(page.locator('#frameValue')).toHaveText('0');

    // Click Next key -> should jump to frame 1
    await page.locator('#nextKey').click();
    await expect(page.locator('#frameValue')).toHaveText('1');

    // Click Next key again -> should jump to frame 5
    await page.locator('#nextKey').click();
    await expect(page.locator('#frameValue')).toHaveText('5');

    // Click Previous key -> should jump back to frame 1
    await page.locator('#previousKey').click();
    await expect(page.locator('#frameValue')).toHaveText('1');
  });

  test('Tier 1: Keyframe interpolation mode selection (linear, smooth, step)', async ({ page }) => {
    // Create key at frame 0
    const frame0 = page.locator('#timeline .track-row').filter({ hasText: 'rotation' }).locator('button').nth(1);
    await frame0.click();

    await vecInput(page, 'Rotation °', 'Z').fill('20');
    await vecInput(page, 'Rotation °', 'Z').dispatchEvent('change');
    await page.waitForTimeout(200);

    // Key inspector should have interpolation select dropdown
    const interpSelect = page.locator('#keyInspector select');
    await expect(interpSelect).toBeVisible();
    await expect(interpSelect).toHaveValue('linear');

    // Change to smooth
    await interpSelect.selectOption('smooth');
    await expect(interpSelect).toHaveValue('smooth');

    // Change to step
    await interpSelect.selectOption('step');
    await expect(interpSelect).toHaveValue('step');
  });

  test('Tier 1: Animation playback toggle via Play button', async ({ page }) => {
    await page.locator('[data-mode="character"]').click();
    const playBtn = page.locator('#play');
    await expect(playBtn).toHaveText('Play');

    await playBtn.click();
    await expect(playBtn).toHaveText('Pause');
    await page.waitForTimeout(500);

    await playBtn.click();
    await expect(playBtn).toHaveText('Play');
  });

  test('Tier 1: Add and duplicate animation clips', async ({ page }) => {
    // Add clip
    await page.locator('#addClip').click();
    await respondModal(page, 'walk');
    await page.waitForTimeout(200);
    await expect(page.locator('#clipList button:has-text("walk")')).toBeVisible();

    // Duplicate clip
    await page.locator('#duplicateClip').click();
    await respondModal(page, 'walk_run');
    await page.waitForTimeout(200);
    await expect(page.locator('#clipList button:has-text("walk_run")')).toBeVisible();
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================

  test('Tier 2: Single clip deletion prevention alert', async ({ page }) => {
    await page.locator('#deleteClip').click();
    const overlay = page.locator('#modalOverlay');
    await expect(overlay).toBeVisible();
    await expect(page.locator('#modalMessage')).toContainText('At least one clip must remain');
    await page.locator('#modalConfirmButton').click();
    await page.waitForTimeout(200);

    await expect(page.locator('#clipList button')).toHaveCount(1);
  });

  test('Tier 2: Frame slider scrubbing updates frame value across entire range', async ({ page }) => {
    await page.locator('[data-mode="character"]').click();
    const frameSlider = page.locator('#frame');
    const frameValue = page.locator('#frameValue');

    await frameSlider.fill('7');
    await frameSlider.dispatchEvent('input');
    await page.waitForTimeout(100);
    await expect(frameValue).toHaveText('7');

    await frameSlider.fill('0');
    await frameSlider.dispatchEvent('input');
    await page.waitForTimeout(100);
    await expect(frameValue).toHaveText('0');
  });

  test('Tier 2: Track label clicking toggles active track selection', async ({ page }) => {
    const rotLabel = page.locator('#timeline .track-row button:has-text("rotation")');
    await rotLabel.click();
    await page.waitForTimeout(100);
    await expect(rotLabel).toHaveClass(/active/);

    const transLabel = page.locator('#timeline .track-row button:has-text("translation")');
    await transLabel.click();
    await page.waitForTimeout(100);
    await expect(transLabel).toHaveClass(/active/);
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // =========================================================================

  test('Tier 3: Multi-keyframe interpolation sequence + clip timing update', async ({ page }) => {
    // 1. Set FPS to 15
    const fpsInput = page.locator('#clipTiming label:has-text("FPS") input');
    await fpsInput.fill('15');
    await fpsInput.dispatchEvent('change');

    // 2. Set key at frame 0
    const frame0 = page.locator('#timeline .track-row').filter({ hasText: 'rotation' }).locator('button').nth(1);
    await frame0.click();
    const rotX = vecInput(page, 'Rotation °', 'X');
    await rotX.fill('0');
    await rotX.dispatchEvent('change');
    await page.waitForTimeout(100);

    // 3. Set key at frame 4
    const frame4 = page.locator('#timeline .track-row').filter({ hasText: 'rotation' }).locator('button').nth(5);
    await frame4.click();
    await rotX.fill('60');
    await rotX.dispatchEvent('change');
    await page.waitForTimeout(100);

    // 4. Set smooth interpolation on frame 0
    await frame0.click();
    await page.locator('#keyInspector select').selectOption('smooth');
    await page.waitForTimeout(100);

    // 5. Verify 2 keyframes exist on rotation track
    await expect(page.locator('#timeline .track-row').filter({ hasText: 'rotation' }).locator('button.key')).toHaveCount(2);
  });

  test('Tier 3: Duplicate clip + modify keyframe in clone + verify original unchanged', async ({ page }) => {
    // Create keyframe in idle at frame 0
    const frame0 = page.locator('#timeline .track-row').filter({ hasText: 'rotation' }).locator('button').nth(1);
    await frame0.click();
    const rotX = vecInput(page, 'Rotation °', 'X');
    await rotX.fill('10');
    await rotX.dispatchEvent('change');
    await page.waitForTimeout(100);

    // Duplicate idle -> idle_fast
    await page.locator('#duplicateClip').click();
    await respondModal(page, 'idle_fast');
    await page.waitForTimeout(200);

    // Modify keyframe in idle_fast
    await frame0.click();
    await rotX.fill('80');
    await rotX.dispatchEvent('change');
    await page.waitForTimeout(100);

    // Switch back to idle
    await page.locator('#clipList button:has-text("idle")').first().click();
    await page.waitForTimeout(200);
    await frame0.click();

    // Verify rotation X in idle is still 10
    await expect(rotX).toHaveValue('10');
  });

  // =========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // =========================================================================

  test('Tier 4: Custom Jump-Attack Keyframe Animation Journey', async ({ page }) => {
    // 1. Create jump_attack clip
    await page.locator('#addClip').click();
    await respondModal(page, 'jump_attack');
    await page.waitForTimeout(200);
    await expect(page.locator('#clipList button:has-text("jump_attack")')).toBeVisible();

    // 2. Set timing: 8 frames, 12 FPS, looping
    const framesInput = page.locator('#clipTiming label:has-text("Frames") input');
    const fpsInput = page.locator('#clipTiming label:has-text("FPS") input');
    await framesInput.fill('8');
    await framesInput.dispatchEvent('change');
    await fpsInput.fill('12');
    await fpsInput.dispatchEvent('change');
    await page.waitForTimeout(100);

    // 3. Anticipation pose at frame 0 (Translation Y = -0.5)
    const frame0 = page.locator('#timeline .track-row').filter({ hasText: 'translation' }).locator('button').nth(1);
    await frame0.click();
    const transY = vecInput(page, 'Position', 'Y');
    await transY.fill('-0.5');
    await transY.dispatchEvent('change');
    await page.waitForTimeout(100);

    // 4. Apex jump pose at frame 3 (Translation Y = 2.0, Rotation X = -15)
    const frame3 = page.locator('#timeline .track-row').filter({ hasText: 'translation' }).locator('button').nth(4);
    await frame3.click();
    await transY.fill('2.0');
    await transY.dispatchEvent('change');
    const rotX = vecInput(page, 'Rotation °', 'X');
    await rotX.fill('-15');
    await rotX.dispatchEvent('change');
    await page.waitForTimeout(100);

    // 5. Landing pose at frame 6 (Translation Y = 0.0, Rotation X = 0)
    const frame6 = page.locator('#timeline .track-row').filter({ hasText: 'translation' }).locator('button').nth(7);
    await frame6.click();
    await transY.fill('0');
    await transY.dispatchEvent('change');
    await rotX.fill('0');
    await rotX.dispatchEvent('change');
    await page.waitForTimeout(100);

    // 6. Test playback
    await page.locator('[data-mode="character"]').click();
    await page.locator('#play').click();
    await expect(page.locator('#play')).toHaveText('Pause');
    await page.waitForTimeout(500);
    await page.locator('#play').click();
    await expect(page.locator('#play')).toHaveText('Play');

    // 7. Verify no errors
    await expect(page.locator('#rigErrorBanner')).toHaveClass(/hidden/);
  });

  test('Tier 4: Drag-to-retime keyframe across timeline with pointer events and undo', async ({ page }) => {
    // 1. Create a keyframe at frame 1 on rotation track
    const rotRow = page.locator('#timeline .track-row').filter({ hasText: 'rotation' });
    const frame1Btn = rotRow.locator('button').nth(2);
    await frame1Btn.click();

    const rotX = vecInput(page, 'Rotation °', 'X');
    await rotX.fill('35');
    await rotX.dispatchEvent('change');
    await page.waitForTimeout(150);

    await expect(frame1Btn).toHaveClass(/key/);
    await expect(frame1Btn).toHaveText('◆');

    // 2. Drag frame 1 to frame 4
    const frame4Btn = rotRow.locator('button').nth(5);
    const box1 = await frame1Btn.boundingBox();
    const box4 = await frame4Btn.boundingBox();
    expect(box1).toBeTruthy();
    expect(box4).toBeTruthy();

    await page.mouse.move(box1!.x + box1!.width / 2, box1!.y + box1!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box4!.x + box4!.width / 2, box4!.y + box4!.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Frame 1 should now be empty, and Frame 4 should have the key
    await expect(frame1Btn).not.toHaveClass(/key/);
    await expect(frame1Btn).toHaveText('');
    await expect(frame4Btn).toHaveClass(/key/);
    await expect(frame4Btn).toHaveText('◆');

    // Active frame should be 4
    await expect(page.locator('#frameValue')).toHaveText('4');

    // 3. Test Undo moves keyframe back to Frame 1
    await page.locator('#undoButtonRig').click();
    await page.waitForTimeout(200);

    await expect(frame1Btn).toHaveClass(/key/);
    await expect(frame1Btn).toHaveText('◆');
    await expect(frame4Btn).not.toHaveClass(/key/);
  });

  test('Tier 4: Drag-to-retime collision overwrite replaces destination key', async ({ page }) => {
    const rotRow = page.locator('#timeline .track-row').filter({ hasText: 'rotation' });
    const frame1Btn = rotRow.locator('button').nth(2);
    const frame5Btn = rotRow.locator('button').nth(6);

    // Create key at frame 1 with value 20
    await frame1Btn.click();
    await vecInput(page, 'Rotation °', 'Y').fill('20');
    await vecInput(page, 'Rotation °', 'Y').dispatchEvent('change');

    // Create key at frame 5 with value 50
    await frame5Btn.click();
    await vecInput(page, 'Rotation °', 'Y').fill('50');
    await vecInput(page, 'Rotation °', 'Y').dispatchEvent('change');
    await page.waitForTimeout(150);

    await expect(rotRow.locator('button.key')).toHaveCount(2);

    // Drag frame 1 onto frame 5 (collision)
    const box1 = await frame1Btn.boundingBox();
    const box5 = await frame5Btn.boundingBox();
    await page.mouse.move(box1!.x + box1!.width / 2, box1!.y + box1!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box5!.x + box5!.width / 2, box5!.y + box5!.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Frame 1 is cleared, Frame 5 retains key, total keys is 1
    await expect(frame1Btn).not.toHaveClass(/key/);
    await expect(frame5Btn).toHaveClass(/key/);
    await expect(rotRow.locator('button.key')).toHaveCount(1);
    await expect(vecInput(page, 'Rotation °', 'Y')).toHaveValue('20');
  });

  test('Tier 4: Delete keyframe via inspector button and Delete keyboard shortcut', async ({ page }) => {
    const rotRow = page.locator('#timeline .track-row').filter({ hasText: 'rotation' });
    const frame2Btn = rotRow.locator('button').nth(3);

    // 1. Create key at frame 2
    await frame2Btn.click();
    await vecInput(page, 'Rotation °', 'Z').fill('30');
    await vecInput(page, 'Rotation °', 'Z').dispatchEvent('change');
    await page.waitForTimeout(150);

    await expect(frame2Btn).toHaveClass(/key/);

    // 2. Delete via Key Inspector button
    const delInspectorBtn = page.locator('#keyInspector button:has-text("Delete Keyframe")');
    await expect(delInspectorBtn).toBeVisible();
    await delInspectorBtn.click();
    await page.waitForTimeout(150);

    await expect(frame2Btn).not.toHaveClass(/key/);

    // 3. Create key at frame 3 and delete via Delete keyboard shortcut
    const frame3Btn = rotRow.locator('button').nth(4);
    await frame3Btn.click();
    await vecInput(page, 'Rotation °', 'Z').fill('45');
    await vecInput(page, 'Rotation °', 'Z').dispatchEvent('change');
    await page.waitForTimeout(150);

    await expect(frame3Btn).toHaveClass(/key/);

    // Press Delete key
    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);

    await expect(frame3Btn).not.toHaveClass(/key/);
  });

  test('Tier 4: Track active/mute toggle button', async ({ page }) => {
    const rotRow = page.locator('#timeline .track-row').filter({ hasText: 'rotation' });
    const muteBtn = rotRow.locator('.track-mute');

    await expect(muteBtn).toBeVisible();
    await expect(muteBtn).toHaveText('🔊');
    await expect(rotRow).not.toHaveClass(/muted/);

    // Click mute
    await muteBtn.click();
    await page.waitForTimeout(100);

    await expect(muteBtn).toHaveText('🔇');
    await expect(rotRow).toHaveClass(/muted/);

    // Click unmute
    await muteBtn.click();
    await page.waitForTimeout(100);

    await expect(muteBtn).toHaveText('🔊');
    await expect(rotRow).not.toHaveClass(/muted/);
  });

  test('Tier 4: Playback keyboard shortcuts (Space, [, ], Home, End) and input guard', async ({ page }) => {
    await page.locator('[data-mode="character"]').click();

    // 1. Space toggles play/pause
    const playBtn = page.locator('#play');
    await expect(playBtn).toHaveText('Play');

    await page.keyboard.press('Space');
    await expect(playBtn).toHaveText('Pause');

    await page.keyboard.press('Space');
    await expect(playBtn).toHaveText('Play');

    // 2. Bracket keys step frames
    await expect(page.locator('#frameValue')).toHaveText('0');
    await page.keyboard.press(']');
    await expect(page.locator('#frameValue')).toHaveText('1');

    await page.keyboard.press('[');
    await expect(page.locator('#frameValue')).toHaveText('0');

    // Wrap-around backward from 0 -> 7
    await page.keyboard.press('[');
    await expect(page.locator('#frameValue')).toHaveText('7');

    // 3. Home / End shortcuts
    await page.keyboard.press('Home');
    await expect(page.locator('#frameValue')).toHaveText('0');

    await page.keyboard.press('End');
    await expect(page.locator('#frameValue')).toHaveText('7');

    // 4. Input focus isolation: typing Space in input does not trigger playback
    const fpsInput = page.locator('#clipTiming label:has-text("FPS") input');
    await fpsInput.focus();
    await page.keyboard.press('Space');
    await expect(playBtn).toHaveText('Play');
  });
});

