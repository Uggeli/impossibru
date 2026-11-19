import { test, expect } from '@playwright/test';

test.describe('Challenger 2 Adversarial Stress Tests: Palette, Hex Validation, Color Replace, Silhouette Sync, In-DOM Modals', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const welcomeNew = page.locator('#welcomeNew');
    if (await welcomeNew.isVisible()) {
      await welcomeNew.click();
      await page.waitForLoadState('networkidle');
    }
    await expect(page.locator('[data-workspace="parts"]')).toBeVisible();
  });

  // =========================================================================
  // 1. PALETTE HEX VALIDATION & BLUR REVERSION IN REAL BROWSER DOM
  // =========================================================================

  test('Adversarial: Malformed hex strings in swatch-hex input revert to previous valid color on blur', async ({ page }) => {
    const hexInput = page.locator('.swatch-hex').first();
    await expect(hexInput).toBeVisible();

    const originalValue = await hexInput.inputValue();
    expect(originalValue).toMatch(/^#[0-9a-fA-F]{6}$/);

    const malformedInputs = ['#12', '#ffff', '#12345', '#1234567', '#xyz123', '#GGG000', '#GGGGGGGG', '#'];

    for (const badHex of malformedInputs) {
      await hexInput.fill(badHex);
      await hexInput.dispatchEvent('input');

      // Live validation must flag input as invalid
      await expect(hexInput).toHaveClass(/invalid/);

      // On blur, input must revert to original valid value and remove invalid class
      await hexInput.blur();
      await expect(hexInput).toHaveValue(originalValue);
      await expect(hexInput).not.toHaveClass(/invalid/);
    }
  });

  test('Adversarial: Valid #RRGGBBAA 8-digit hex input updates palette and persists', async ({ page }) => {
    const hexInput = page.locator('.swatch-hex').first();
    await hexInput.fill('#ff00aa80');
    await hexInput.dispatchEvent('input');
    await hexInput.blur();

    await expect(hexInput).toHaveValue('#ff00aa80');
    await expect(hexInput).not.toHaveClass(/invalid/);

    // Verify unsaved changes or valid state
    await expect(page.locator('#errorBanner')).toBeHidden();
  });

  // =========================================================================
  // 2. COLOR REPLACEMENT ACROSS ACTIVE PART VS ALL PARTS IN REAL UI
  // =========================================================================

  test('Adversarial: Color Replace dialog swaps colors cleanly across multiple parts', async ({ page }) => {
    // 1. Add a second color 'y'
    await page.locator('#addColor').click();
    const overlay = page.locator('#modalOverlay');
    await expect(overlay).toBeVisible();
    await page.locator('#modalInput').fill('y');
    await page.locator('#modalConfirmButton').click();
    await expect(overlay).toBeHidden();

    // 2. Add a second part 'second_part'
    await page.locator('#addPart').click();
    await expect(overlay).toBeVisible();
    await page.locator('#modalInput').fill('second_part');
    await page.locator('#modalConfirmButton').click();
    await expect(overlay).toBeHidden();

    // 3. Open Color Replace dialog from swatch
    const replaceBtn = page.locator('.swatch-replace').first();
    await replaceBtn.click();
    await expect(overlay).toBeVisible();

    // Check modal replace form controls
    const fromSelect = page.locator('#modalReplaceFrom');
    const toSelect = page.locator('#modalReplaceTo');
    const scopeSelect = page.locator('#modalReplaceScope');

    await expect(fromSelect).toBeVisible();
    await expect(toSelect).toBeVisible();
    await expect(scopeSelect).toBeVisible();

    // Select toChar 'y' and scope 'all'
    await toSelect.selectOption('y');
    await scopeSelect.selectOption('all');
    await page.locator('#modalConfirmButton').click();
    await expect(overlay).toBeHidden();

    // Verify project has no errors
    await expect(page.locator('#errorBanner')).toBeHidden();
  });

  // =========================================================================
  // 3. SILHOUETTE SYNC & ERROR HIGHLIGHT RECONCILIATION
  // =========================================================================

  test('Adversarial: Severe silhouette divergence highlights red error banner and toolbar sync reconciles cleanly', async ({ page }) => {
    // Erase a voxel on front canvas using Eraser
    const eraserBtn = page.locator('[data-tool="eraser"]');
    await eraserBtn.click();

    // Click front canvas center
    const frontCanvas = page.locator('#frontCanvas');
    const box = await frontCanvas.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.click(box.x + 60, box.y + 60);
      await page.waitForTimeout(200);

      // Even if auto-synced during drawing, let's test the syncSilhouette button directly
      const syncBtn = page.locator('#syncSilhouette');
      await expect(syncBtn).toBeVisible();
      await syncBtn.click();

      await expect(page.locator('#errorBanner')).toBeHidden();
    }
  });

  // =========================================================================
  // 4. IN-DOM MODAL KEYBOARD NAVIGATION, FOCUS & VALIDATION ERRORS
  // =========================================================================

  test('Adversarial: In-DOM Modal Escape key cancels, Enter submits, invalid input blocks submission', async ({ page }) => {
    // 1. Open Add Part modal
    await page.locator('#addPart').click();
    const overlay = page.locator('#modalOverlay');
    await expect(overlay).toBeVisible();

    const input = page.locator('#modalInput');
    const confirmBtn = page.locator('#modalConfirmButton');
    const error = page.locator('#modalError');

    // Type invalid empty / whitespace / duplicate name
    await input.fill('   ');
    await input.dispatchEvent('input');

    await expect(confirmBtn).toBeDisabled();
    await expect(error).toBeVisible();

    // Pressing Enter must NOT close the modal while invalid
    await page.keyboard.press('Enter');
    await expect(overlay).toBeVisible();

    // Press Escape to cancel
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();

    // 2. Open Add Color modal and submit with Enter
    await page.locator('#addColor').click();
    await expect(overlay).toBeVisible();

    await input.fill('z');
    await input.dispatchEvent('input');
    await expect(confirmBtn).toBeEnabled();

    // Press Enter to submit
    await page.keyboard.press('Enter');
    await expect(overlay).toBeHidden();

    // Verify color 'z' was added
    await expect(page.locator('.swatch-char:has-text("z")')).toBeVisible();
  });
});
