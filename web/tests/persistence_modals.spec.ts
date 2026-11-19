import { test, expect, Page } from '@playwright/test';

async function respondModal(page: Page, value: string | boolean | null = true) {
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

test.describe('Persistence, Export & Modal Dialogs (Tiers 1-4)', () => {
  // =========================================================================
  // TIER 1: FEATURE COVERAGE (HAPPY PATH)
  // =========================================================================

  test('Tier 1: Welcome modal displays all onboarding options', async ({ page }) => {
    // Clear storage to show welcome modal
    await page.addInitScript(() => {
      sessionStorage.clear();
      localStorage.clear();
    });
    await page.goto('/');

    const welcome = page.locator('#welcome');
    await expect(welcome).toBeVisible();
    await expect(page.locator('#welcomeNew')).toBeVisible();
    await expect(page.locator('#welcomeOpen')).toBeVisible();
    await expect(page.locator('#welcomeRecover')).toBeHidden();
    await expect(page.locator('#welcomeExample')).toBeVisible();
  });

  test('Tier 1: Creating new project via welcome button initializes starter project', async ({ page }) => {
    await page.goto('/');
    const welcomeNew = page.locator('#welcomeNew');
    if (await welcomeNew.isVisible()) {
      await welcomeNew.click();
      await page.waitForLoadState('networkidle');
    }

    await expect(page.locator('button[data-workspace="parts"]')).toBeVisible();
    await expect(page.locator('#filePath')).toHaveText('Browser project');
    await expect(page.locator('#status')).toHaveText('Ready');
    await expect(page.locator('#partList button:has-text("part")')).toBeVisible();
  });

  test('Tier 1: Loading example project loads humanoid character', async ({ page }) => {
    await page.goto('/');
    const welcomeExample = page.locator('#welcomeExample');
    if (await welcomeExample.isVisible()) {
      await welcomeExample.click();
      await page.waitForLoadState('networkidle');
    }

    await expect(page.locator('button[data-workspace="parts"]')).toBeVisible();
    await expect(page.locator('#previewImage')).toBeVisible();
  });

  test('Tier 1: Header New project button prompts for filename and resets project', async ({ page }) => {
    await page.goto('/');
    const welcomeNew = page.locator('#welcomeNew');
    if (await welcomeNew.isVisible()) {
      await welcomeNew.click();
      await page.waitForLoadState('networkidle');
    }

    await page.locator('#newProjectButton').click();
    await respondModal(page, 'hero.yaml');
    await page.waitForTimeout(300);

    await expect(page.locator('#filePath')).toHaveText('hero.yaml');
    await expect(page.locator('#status')).toHaveText(/Created|Ready/);
  });

  test('Tier 1: Save button workflow marks project as Saved', async ({ page }) => {
    await page.goto('/');
    const welcomeNew = page.locator('#welcomeNew');
    if (await welcomeNew.isVisible()) {
      await welcomeNew.click();
      await page.waitForLoadState('networkidle');
    }

    // Paint a cell to dirty the state
    const canvas = page.locator('#frontCanvas');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 10, box.y + 10);
      await page.waitForTimeout(300);
    }

    const saveBtn = page.locator('#saveButton');
    await expect(saveBtn).toBeEnabled();

    await saveBtn.click();
    await page.waitForTimeout(300);

    await expect(page.locator('#status')).toHaveText('Saved');
    await expect(saveBtn).toBeDisabled();
  });

  test('Tier 1: Add export direction adds new angle chip in export settings', async ({ page }) => {
    await page.goto('/');
    const welcomeNew = page.locator('#welcomeNew');
    if (await welcomeNew.isVisible()) {
      await welcomeNew.click();
      await page.waitForLoadState('networkidle');
    }

    await page.locator('#exportZipButton').click();
    await page.locator('#exportAngle').fill('60');
    await page.locator('#addExportDirection').click();
    await page.waitForTimeout(200);

    await expect(page.locator('#exportDirections .direction-chip:has-text("60°")')).toBeVisible();
  });

  test('Tier 1: Remove export direction removes chip from list', async ({ page }) => {
    await page.goto('/');
    const welcomeNew = page.locator('#welcomeNew');
    if (await welcomeNew.isVisible()) {
      await welcomeNew.click();
      await page.waitForLoadState('networkidle');
    }

    await page.locator('#exportZipButton').click();
    const exportDirections = page.locator('#exportDirections');
    await exportDirections.scrollIntoViewIfNeeded();

    const firstChip = page.locator('#exportDirections .direction-chip').first();
    await expect(firstChip).toBeAttached();

    const removeBtn = firstChip.locator('button[title="Remove direction"]');
    await removeBtn.click();
    await page.waitForTimeout(200);

    // Initial count was 8, should now be 7
    await expect(page.locator('#exportDirections .direction-chip')).toHaveCount(7);
  });

  test('Tier 1: Export ZIP button triggers export compression workflow', async ({ page }) => {
    await page.goto('/');
    const welcomeNew = page.locator('#welcomeNew');
    if (await welcomeNew.isVisible()) {
      await welcomeNew.click();
      await page.waitForLoadState('networkidle');
    }

    const exportBtn = page.locator('#exportZipButton');
    await exportBtn.click();
    await page.locator('#confirmExport').click();
    await page.waitForTimeout(500);

    await expect(page.locator('#status')).toHaveText(/Export ready|Exporting/);
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================

  test('Tier 2: Invalid project filename extension rejected with alert', async ({ page }) => {
    await page.goto('/');
    const welcomeNew = page.locator('#welcomeNew');
    if (await welcomeNew.isVisible()) {
      await welcomeNew.click();
      await page.waitForLoadState('networkidle');
    }

    await page.locator('#newProjectButton').click();
    const overlay = page.locator('#modalOverlay');
    await expect(overlay).toBeVisible();

    const input = page.locator('#modalInput');
    await input.fill('invalid_file.txt');
    await input.dispatchEvent('input');

    await expect(page.locator('#modalError')).toContainText('Use a .yaml or .yml filename');
    await expect(page.locator('#modalConfirmButton')).toBeDisabled();
    await page.locator('#modalCancelButton').click();
  });

  test('Tier 2: Non-numeric export direction input rejected with alert', async ({ page }) => {
    await page.goto('/');
    const welcomeNew = page.locator('#welcomeNew');
    if (await welcomeNew.isVisible()) {
      await welcomeNew.click();
      await page.waitForLoadState('networkidle');
    }

    await page.locator('#exportZipButton').click();
    await page.locator('#exportAngle').fill('');
    await page.locator('#addExportDirection').click();
    await expect(page.locator('#exportError')).toContainText('Enter a direction');
    await page.locator('#cancelExport').click();
  });

  test('Tier 2: Duplicate export direction rejected with alert', async ({ page }) => {
    await page.goto('/');
    const welcomeNew = page.locator('#welcomeNew');
    if (await welcomeNew.isVisible()) {
      await welcomeNew.click();
      await page.waitForLoadState('networkidle');
    }

    await page.locator('#exportZipButton').click();
    await page.locator('#exportAngle').fill('0');
    await page.locator('#addExportDirection').click();
    await expect(page.locator('#exportError')).toContainText('already selected');
    await page.locator('#cancelExport').click();
  });

  test('Tier 2: Preventing removal of the last remaining export direction', async ({ page }) => {
    await page.goto('/');
    const welcomeNew = page.locator('#welcomeNew');
    if (await welcomeNew.isVisible()) {
      await welcomeNew.click();
      await page.waitForLoadState('networkidle');
    }

    await page.locator('#exportZipButton').click();
    // Remove chips until 1 is left
    while ((await page.locator('#exportDirections .direction-chip').count()) > 1) {
      await page.locator('#exportDirections .direction-chip').first().locator('button[title="Remove direction"]').click();
      await page.waitForTimeout(50);
    }

    // Try removing the last one
    await page.locator('#exportDirections .direction-chip').first().locator('button[title="Remove direction"]').click();
    await expect(page.locator('#exportError')).toContainText('Select at least one export direction');

    await expect(page.locator('#exportDirections .direction-chip')).toHaveCount(1);
  });

  test('Tier 2: Malformed YAML in storage produces user-friendly error banner without crashing', async ({ page }) => {
    // Inject corrupt YAML into sessionStorage
    await page.addInitScript(() => {
      sessionStorage.setItem('impossibru-yaml', 'parts:\n  part:\n    front: invalid');
    });

    await page.goto('/');
    await page.waitForTimeout(400);

    // Error banner should display validation failure
    await expect(page.locator('#errorBanner')).toBeVisible();
    await expect(page.locator('#errorBanner')).not.toHaveClass(/hidden/);
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // =========================================================================

  test('Tier 3: Project roundtrip: modify palette + save draft + reload + verify state', async ({ page }) => {
    await page.goto('/');
    const welcomeNew = page.locator('#welcomeNew');
    if (await welcomeNew.isVisible()) {
      await welcomeNew.click();
      await page.waitForLoadState('networkidle');
    }

    // 1. Add color 'q'
    await page.locator('#addColor').click();
    await respondModal(page, 'q');
    await expect(page.locator('.swatch-char:has-text("q")')).toBeVisible();

    // 2. Save project so dirty state clears
    await page.locator('#saveButton').click();
    await page.waitForTimeout(300);

    // 3. Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // 4. Verify color 'q' was restored
    await expect(page.locator('.swatch-char:has-text("q")')).toBeVisible();
  });

  // =========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // =========================================================================

  test('Tier 4: Error Resilience & Recovery Workflow', async ({ page }) => {
    await page.goto('/');
    const welcomeNew = page.locator('#welcomeNew');
    if (await welcomeNew.isVisible()) {
      await welcomeNew.click();
      await page.waitForLoadState('networkidle');
    }

    // Verify initial clean state
    await expect(page.locator('#errorBanner')).toHaveClass(/hidden/);

    // Make an edit
    const canvas = page.locator('#frontCanvas');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 10, box.y + 10);
      await page.waitForTimeout(200);
    }

    // Verify still valid
    await expect(page.locator('#errorBanner')).toHaveClass(/hidden/);
    await expect(page.locator('#previewImage')).toBeVisible();
  });
});
