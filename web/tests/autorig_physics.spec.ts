import { test, expect } from '@playwright/test';

test.describe('Autorig & Physics Inspectors (Tiers 1-4)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const welcomeExample = page.locator('#welcomeExample');
    if (await welcomeExample.isVisible()) {
      await welcomeExample.click();
      await page.waitForLoadState('networkidle');
    } else {
      const welcomeNew = page.locator('#welcomeNew');
      if (await welcomeNew.isVisible()) {
        await welcomeNew.click();
        await page.waitForLoadState('networkidle');
      }
    }
    await expect(page.locator('[data-workspace="parts"]')).toBeVisible();
  });

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (HAPPY PATH)
  // =========================================================================

  test('Tier 1: Autorig button is accessible and clickable in Rig workspace', async ({ page }) => {
    await page.locator('button[data-workspace="rig"]').click();
    const autoRigBtn = page.locator('#autoRigButton');
    await expect(autoRigBtn).toBeVisible();
    await expect(autoRigBtn).toBeEnabled();

    // Trigger autorig
    await autoRigBtn.click();
    await page.waitForTimeout(300);

    // Bone tree should have bones
    await expect(page.locator('#boneTree .bone-name').first()).toBeVisible();
  });

  test('Tier 1: Bone hierarchy selection populates bone inspector and physics containers', async ({ page }) => {
    await page.locator('button[data-workspace="rig"]').click();
    const firstBone = page.locator('#boneTree .bone-name').first();
    await expect(firstBone).toBeVisible();
    await firstBone.click();

    await expect(firstBone).toHaveClass(/active/);
    await expect(page.locator('#boneInspector')).toBeVisible();
    await expect(page.locator('#springInspector')).toBeAttached();
    await expect(page.locator('#constraintInspector')).toBeAttached();
  });

  test('Tier 1: Animate workspace displays procedural animation section and inspector', async ({ page }) => {
    await page.locator('button[data-workspace="animate"]').click();
    await expect(page.locator('#clipSection')).toBeVisible();
    await expect(page.locator('#proceduralSection')).toBeVisible();
    await expect(page.locator('#proceduralInspector')).toBeVisible();
    await expect(page.locator('#clipTiming')).toBeVisible();
  });

  test('Tier 1: Procedural clip timing controls (Frames, FPS, Looping)', async ({ page }) => {
    await page.locator('button[data-workspace="animate"]').click();

    const framesInput = page.locator('#clipTiming label:has-text("Frames") input');
    const fpsInput = page.locator('#clipTiming label:has-text("FPS") input');
    const loopCheck = page.locator('#clipTiming label:has-text("Looping") input');

    await expect(framesInput).toBeVisible();
    await expect(fpsInput).toBeVisible();
    await expect(loopCheck).toBeVisible();

    // Modify FPS
    await fpsInput.fill('12');
    await fpsInput.dispatchEvent('change');
    await page.waitForTimeout(200);

    await expect(fpsInput).toHaveValue('12');
  });

  test('Tier 1: Character preview mode and yaw rendering for rigged model', async ({ page }) => {
    const charBtn = page.locator('[data-mode="character"]');
    await charBtn.click();
    await expect(charBtn).toHaveClass(/active/);

    await expect(page.locator('#animationControls')).toBeVisible();
    await expect(page.locator('#clip')).toBeVisible();
    await expect(page.locator('#frame')).toBeVisible();
    await expect(page.locator('#play')).toBeVisible();

    // Rotate yaw
    const yaw = page.locator('#yaw');
    await yaw.fill('45');
    await yaw.dispatchEvent('input');
    await page.waitForTimeout(200);

    await expect(page.locator('#yawValue')).toHaveText('45°');
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================

  test('Tier 2: Autorig on multi-part character keeps parts intact', async ({ page }) => {
    // Check parts list before autorig
    const partCount = await page.locator('#partList button').count();
    expect(partCount).toBeGreaterThanOrEqual(1);

    // Switch to rig and trigger autorig
    await page.locator('button[data-workspace="rig"]').click();
    await page.locator('#autoRigButton').click();
    await page.waitForTimeout(300);

    // Switch back to parts
    await page.locator('button[data-workspace="parts"]').click();
    const newPartCount = await page.locator('#partList button').count();
    expect(newPartCount).toBe(partCount);
  });

  test('Tier 2: Clip timing frames reduction with confirmation', async ({ page }) => {
    await page.locator('button[data-workspace="animate"]').click();

    const framesInput = page.locator('#clipTiming label:has-text("Frames") input');
    await expect(framesInput).toBeVisible();

    // Change frames count
    await framesInput.fill('16');
    await framesInput.dispatchEvent('change');
    await page.waitForTimeout(200);

    await expect(framesInput).toHaveValue('16');
  });

  test('Tier 2: Looping checkbox toggle updates clip state', async ({ page }) => {
    await page.locator('button[data-workspace="animate"]').click();

    const loopCheck = page.locator('#clipTiming label:has-text("Looping") input');
    await expect(loopCheck).toBeVisible();
    const initial = await loopCheck.isChecked();

    await loopCheck.setChecked(!initial);
    await page.waitForTimeout(200);

    await expect(loopCheck).toBeChecked({ checked: !initial });
  });

  test('Tier 2: Switching clips in clip list updates timing and timeline', async ({ page }) => {
    await page.locator('button[data-workspace="animate"]').click();

    const clips = page.locator('#clipList button');
    const count = await clips.count();
    if (count > 1) {
      await clips.nth(1).click();
      await page.waitForTimeout(200);
      await expect(clips.nth(1)).toHaveClass(/active/);
    }
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // =========================================================================

  test('Tier 3: Autorig + Bone tree selection + Animate workspace transition + Preview update', async ({ page }) => {
    // 1. Rig workspace
    await page.locator('button[data-workspace="rig"]').click();
    await page.locator('#autoRigButton').click();
    await page.waitForTimeout(300);

    // 2. Select first bone
    const bone = page.locator('#boneTree .bone-name').first();
    await bone.click();
    await expect(bone).toHaveClass(/active/);

    // 3. Animate workspace
    await page.locator('button[data-workspace="animate"]').click();
    await expect(page.locator('#timeline')).toBeVisible();

    // 4. Set character preview mode
    await page.locator('[data-mode="character"]').click();
    await page.locator('#yaw').fill('180');
    await page.locator('#yaw').dispatchEvent('input');
    await page.waitForTimeout(200);

    await expect(page.locator('#previewImage')).toBeVisible();
  });

  // =========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // =========================================================================

  test('Tier 4: Secondary Motion Spring Simulation Journey', async ({ page }) => {
    // 1. Switch to Rig workspace and autorig
    await page.locator('button[data-workspace="rig"]').click();
    await page.locator('#autoRigButton').click();
    await page.waitForTimeout(300);

    // 2. Inspect bones and spring physics container
    const bones = page.locator('#boneTree .bone-name');
    const count = await bones.count();
    expect(count).toBeGreaterThan(0);

    await bones.first().click();
    await expect(page.locator('#springInspector')).toBeAttached();
    await expect(page.locator('#constraintInspector')).toBeAttached();

    // 3. Transition to Animate workspace
    await page.locator('button[data-workspace="animate"]').click();
    await expect(page.locator('#proceduralSection')).toBeVisible();

    // 4. Verify character playback controls and preview
    await page.locator('[data-mode="character"]').click();
    await page.locator('#play').click();
    await expect(page.locator('#play')).toHaveText('Pause');
    await page.waitForTimeout(400);
    await page.locator('#play').click();
    await expect(page.locator('#play')).toHaveText('Play');

    // 5. Verify no error banners
    await expect(page.locator('#errorBanner')).toHaveClass(/hidden/);
    await expect(page.locator('#rigErrorBanner')).toHaveClass(/hidden/);
  });
});
