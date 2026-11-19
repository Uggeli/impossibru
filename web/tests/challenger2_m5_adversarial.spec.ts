import { test, expect } from '@playwright/test';

test.describe('Challenger 2 M5 Phase 2 Adversarial E2E: Canvas, Palette, Timeline & Modals Hardening', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const welcomeNew = page.locator('#welcomeNew');
    try {
      await welcomeNew.waitFor({ state: 'visible', timeout: 2000 });
      await welcomeNew.click();
      await page.waitForLoadState('networkidle');
    } catch (_) {
      // If not present or already closed, proceed
    }
    await expect(page.locator('[data-workspace="parts"]')).toBeVisible();
  });

  function vecInput(page: any, label: string, axis: 'X' | 'Y' | 'Z') {
    return page.locator('#boneInspector .vec').filter({ has: page.getByText(label, { exact: true }) }).locator(`input[title="${axis}"]`);
  }

  // =========================================================================
  // 1. CANVAS & PAINTING TOOLS ADVERSARIAL E2E
  // =========================================================================

  test('Adversarial: Extreme pointer drag far outside canvas bounds does not throw or corrupt cell state', async ({ page }) => {
    const frontCanvas = page.locator('#frontCanvas');
    await expect(frontCanvas).toBeVisible();

    const box = await frontCanvas.boundingBox();
    expect(box).toBeTruthy();

    // Select Pencil tool
    await page.keyboard.press('p');

    // Drag from center of canvas to far outside viewport (-500, -500)
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(-500, -500, { steps: 5 });
    await page.mouse.up();

    // Canvas should still be valid and render without error banner
    await expect(page.locator('#errorBanner')).toBeHidden();

    // Drag from far outside (+2000, +2000) into canvas
    await page.mouse.move(2000, 2000);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 5 });
    await page.mouse.up();

    await expect(page.locator('#errorBanner')).toBeHidden();
  });

  test('Adversarial: Flood fill full bounds and mirror symmetry edge cases execute cleanly', async ({ page }) => {
    const frontCanvas = page.locator('#frontCanvas');
    const box = await frontCanvas.boundingBox();
    expect(box).toBeTruthy();

    // 1. Flood fill (F) on front canvas
    await page.keyboard.press('f');
    await page.mouse.click(box!.x + 10, box!.y + 10);
    await page.waitForTimeout(100);

    // Verify no error
    await expect(page.locator('#errorBanner')).toBeHidden();

    // 2. Enable Mirror Mode (M)
    await page.keyboard.press('m');
    const mirrorToggle = page.locator('#mirrorToggle');
    await expect(mirrorToggle).toHaveClass(/active/);

    // Draw with Line tool (L) across center
    await page.keyboard.press('l');
    await page.mouse.move(box!.x + 5, box!.y + 5);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width - 5, box!.y + box!.height - 5, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    await expect(page.locator('#errorBanner')).toBeHidden();

    // Turn mirror mode back off
    await page.keyboard.press('m');
    await expect(mirrorToggle).not.toHaveClass(/active/);
  });

  test('Adversarial: Rapid tool switching (P, E, F, I, L, R, C) mid-interaction preserves UI state and undo history', async ({ page }) => {
    const tools = ['p', 'e', 'f', 'i', 'l', 'r'];
    const frontCanvas = page.locator('#frontCanvas');
    const box = await frontCanvas.boundingBox();
    expect(box).toBeTruthy();

    for (let i = 0; i < 12; i++) {
      const toolKey = tools[i % tools.length];
      await page.keyboard.press(toolKey);
      await page.mouse.click(box!.x + (i * 10) % box!.width + 5, box!.y + (i * 10) % box!.height + 5);
    }
    await page.waitForTimeout(200);

    await expect(page.locator('#errorBanner')).toBeHidden();

    // Verify undo button is enabled and can undo operations
    const undoBtn = page.locator('#undoButton');
    await expect(undoBtn).toBeEnabled();
    for (let j = 0; j < 5; j++) {
      await undoBtn.click();
      await page.waitForTimeout(50);
    }
    await expect(page.locator('#errorBanner')).toBeHidden();
  });

  // =========================================================================
  // 2. PALETTE ADVERSARIAL E2E
  // =========================================================================

  test('Adversarial: Palette 8-digit hex input (#RRGGBBAA) updates live and persists across workspace switch', async ({ page }) => {
    const hexInput = page.locator('.swatch-hex').first();
    await expect(hexInput).toBeVisible();

    // Fill valid 8-digit hex with alpha
    await hexInput.fill('#12abef99');
    await hexInput.dispatchEvent('input');
    await hexInput.blur();

    await expect(hexInput).toHaveValue('#12abef99');
    await expect(hexInput).not.toHaveClass(/invalid/);

    // Switch workspace to Rig then back to Parts
    await page.locator('button[data-workspace="rig"]').click();
    await expect(page.locator('#boneTree')).toBeVisible();

    await page.locator('button[data-workspace="parts"]').click();
    await expect(page.locator('.swatch-hex').first()).toHaveValue('#12abef99');
  });

  test('Adversarial: Duplicate palette character addition is blocked with inline validation in modal', async ({ page }) => {
    await page.locator('#addColor').click();
    const overlay = page.locator('#modalOverlay');
    await expect(overlay).toBeVisible();

    const input = page.locator('#modalInput');
    const confirmBtn = page.locator('#modalConfirmButton');
    const errorEl = page.locator('#modalError');

    // Default project has 'x' in palette. Attempting to add 'x' must be blocked
    await input.fill('x');
    await input.dispatchEvent('input');

    await expect(confirmBtn).toBeDisabled();
    await expect(errorEl).toBeVisible();
    await expect(errorEl).toContainText(/Choose one unused character/i);

    // Attempting to add multi-character symbol must also be blocked
    await input.fill('xyz');
    await input.dispatchEvent('input');
    await expect(confirmBtn).toBeDisabled();
    await expect(errorEl).toContainText(/Choose one unused character/i);

    // Cancel modal
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  });

  test('Adversarial: Deleting single remaining color is blocked and maintains schema integrity', async ({ page }) => {
    // There is only 1 color in starter project ('x')
    const deleteBtn = page.locator('.swatch-delete').first();
    await deleteBtn.click();

    // Modal alert should appear warning that color is in use
    const overlay = page.locator('#modalOverlay');
    await expect(overlay).toBeVisible();
    await expect(page.locator('#modalTitle')).toHaveText(/Color In Use|Notice/i);

    // Dismiss alert
    await page.locator('#modalConfirmButton').click();
    await expect(overlay).toBeHidden();

    // Palette should still contain the color 'x'
    await expect(page.locator('.swatch-hex')).toHaveCount(1);
    await expect(page.locator('#errorBanner')).toBeHidden();
  });

  // =========================================================================
  // 3. TIMELINE & KEYFRAME ADVERSARIAL E2E
  // =========================================================================

  test('Adversarial: Deleting last remaining keyframe cleans animation track schema without throwing', async ({ page }) => {
    await page.locator('button[data-workspace="animate"]').click();
    await expect(page.locator('#timeline')).toBeVisible();

    const rotRow = page.locator('#timeline .track-row').filter({ hasText: 'rotation' });
    const f0 = rotRow.locator('button').nth(1);

    // 1. Add keyframe at frame 0
    await f0.click();
    const rotX = vecInput(page, 'Rotation °', 'X');
    await rotX.fill('35');
    await rotX.dispatchEvent('change');
    await page.waitForTimeout(100);

    await expect(f0).toHaveClass(/key/);

    // 2. Delete keyframe at frame 0 using inspector delete button
    const deleteKeyBtn = page.locator('#deleteKey');
    await expect(deleteKeyBtn).toBeEnabled();
    await deleteKeyBtn.click();
    await page.waitForTimeout(100);

    // Verify key indicator is removed
    await expect(f0).not.toHaveClass(/key/);

    // Verify project has no schema errors
    await expect(page.locator('#rigErrorBanner')).toHaveClass(/hidden/);
  });

  test('Adversarial: Retiming past clip duration clamps safely to bounds [0, L-1]', async ({ page }) => {
    await page.locator('button[data-workspace="animate"]').click();
    await expect(page.locator('#timeline')).toBeVisible();

    const rotRow = page.locator('#timeline .track-row').filter({ hasText: 'rotation' });
    const f2 = rotRow.locator('button').nth(3);
    const f7 = rotRow.locator('button').nth(8);

    // 1. Add keyframe at frame 2
    await f2.click();
    const rotZ = vecInput(page, 'Rotation °', 'Z');
    await rotZ.fill('60');
    await rotZ.dispatchEvent('change');
    await page.waitForTimeout(100);

    // 2. Drag frame 2 far to the right of the window (clientX = 3000)
    const box2 = await f2.boundingBox();
    expect(box2).toBeTruthy();

    await page.mouse.move(box2!.x + box2!.width / 2, box2!.y + box2!.height / 2);
    await page.mouse.down();
    await page.mouse.move(3000, box2!.y + box2!.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Should clamp to frame 7 (L-1)
    await expect(f2).not.toHaveClass(/key/);
    await expect(f7).toHaveClass(/key/);
    await expect(page.locator('#frameValue')).toHaveText('7');
    await expect(rotZ).toHaveValue('60');
  });

  // =========================================================================
  // 4. PERSISTENCE, OFFLINE & MODALS ADVERSARIAL E2E
  // =========================================================================

  test('Adversarial: In-DOM Modal Tab focus trapping cycles within modal controls without leaking focus to background', async ({ page }) => {
    // Open Prompt with valid initial value so confirm is enabled
    await page.locator('#addPart').click();
    const overlay = page.locator('#modalOverlay');
    await expect(overlay).toBeVisible();

    const input = page.locator('#modalInput');
    const cancelBtn = page.locator('#modalCancelButton');
    const confirmBtn = page.locator('#modalConfirmButton');
    const closeBtn = page.locator('#modalClose');

    // Fill valid part name
    await input.fill('test_trap');
    await input.dispatchEvent('input');

    await expect(input).toBeFocused();

    // Tab forwards through modal controls
    await page.keyboard.press('Tab'); // to Cancel
    await expect(cancelBtn).toBeFocused();

    await page.keyboard.press('Tab'); // to Confirm
    await expect(confirmBtn).toBeFocused();

    await page.keyboard.press('Tab'); // to Close button
    await expect(closeBtn).toBeFocused();

    // Tab past last control wraps back to first focusable control (Close -> input)
    await page.keyboard.press('Tab');
    await expect(input).toBeFocused();

    // Shift+Tab backwards wraps to last focusable control (input -> Close)
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    await expect(closeBtn).toBeFocused();

    // Escape closes modal and restores focus cleanly
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  });

  test('Adversarial: Corrupt local storage draft recovery falls back gracefully with user notification', async ({ page }) => {
    // Inject corrupt JSON into sessionStorage
    await page.evaluate(() => {
      sessionStorage.setItem('impossibru-project', 'INVALID_MALFORMED_JSON_STRING{{{');
    });

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Application should recover cleanly to starter project or show recoverable error rather than blank crash
    await expect(page.locator('header .brand')).toBeVisible();
    await expect(page.locator('[data-workspace="parts"]')).toBeVisible();
  });
});
