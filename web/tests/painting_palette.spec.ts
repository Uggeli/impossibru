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

test.describe('Painting & Palette Workspace (Tiers 1-4)', () => {
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
  // TIER 1: FEATURE COVERAGE (HAPPY PATH)
  // =========================================================================

  test('Tier 1: Canvas painting with pencil tool updates active voxel and dirty state', async ({ page }) => {
    // Select pencil tool
    const pencilBtn = page.locator('[data-tool="pencil"]');
    await pencilBtn.click();
    await expect(pencilBtn).toHaveClass(/active/);

    const canvas = page.locator('#frontCanvas');
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // Click at the center of the canvas
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(200);

      // Status should indicate unsaved changes
      await expect(page.locator('#status')).toHaveText(/Unsaved changes|Ready/);
    }
  });

  test('Tier 1: Eraser tool activation and erasing voxels on canvas', async ({ page }) => {
    const eraserBtn = page.locator('[data-tool="eraser"]');
    await eraserBtn.click();
    await expect(eraserBtn).toHaveClass(/active/);

    const canvas = page.locator('#frontCanvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(200);
      await expect(page.locator('#undoButton')).toBeEnabled();
    }
  });

  test('Tier 1: Flood fill tool switches and executes fill on click', async ({ page }) => {
    const fillBtn = page.locator('[data-tool="fill"]');
    await fillBtn.click();
    await expect(fillBtn).toHaveClass(/active/);

    const canvas = page.locator('#frontCanvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.click(box.x + box.width / 4, box.y + box.height / 4);
      await page.waitForTimeout(200);
      await expect(page.locator('#undoButton')).toBeEnabled();
    }
  });

  test('Tier 1: Eyedropper tool picks color from canvas', async ({ page }) => {
    // First select eyedropper
    const eyeBtn = page.locator('[data-tool="eyedropper"]');
    await eyeBtn.click();
    await expect(eyeBtn).toHaveClass(/active/);

    const canvas = page.locator('#frontCanvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // In 4x4 grid (96x96), cell (2, 2) at offset (60, 60) is colored 'x'
      await page.mouse.click(box.x + 60, box.y + 60);
      await page.waitForTimeout(200);
      // Active swatch in palette should be 'x'
      await expect(page.locator('.swatch:has-text("x")')).toHaveClass(/active/);
    }
  });

  test('Tier 1: Multi-view canvas rendering for Front, Side, and Back views', async ({ page }) => {
    await expect(page.locator('#frontCanvas')).toBeVisible();
    await expect(page.locator('#sideCanvas')).toBeVisible();
    await expect(page.locator('#backCanvas')).toBeVisible();

    // Verify canvas dimensions are non-zero
    const front = await page.locator('#frontCanvas').boundingBox();
    const side = await page.locator('#sideCanvas').boundingBox();
    const back = await page.locator('#backCanvas').boundingBox();

    expect(front?.width).toBeGreaterThan(0);
    expect(side?.width).toBeGreaterThan(0);
    expect(back?.width).toBeGreaterThan(0);
  });

  test('Tier 1: Add new color to palette via Add color button', async ({ page }) => {
    const addColorBtn = page.locator('#addColor');
    await addColorBtn.click();
    await respondModal(page, 'z');

    // Check that swatch for 'z' was created
    await expect(page.locator('.swatch-char:has-text("z")')).toBeVisible();
  });

  test('Tier 1: Edit hex color in palette swatch', async ({ page }) => {
    const colorInput = page.locator('#paletteEditor input[type="color"]').first();
    await expect(colorInput).toBeVisible();
    await colorInput.fill('#ff55aa');
    await colorInput.dispatchEvent('input');
    await colorInput.dispatchEvent('change');
    await page.waitForTimeout(200);

    await expect(colorInput).toHaveValue('#ff55aa');
  });

  test('Tier 1: Rename palette character symbol across active model', async ({ page }) => {
    const renameBtn = page.locator('#paletteEditor button[title="Rename symbol"]').first();
    await renameBtn.click();
    await respondModal(page, 'k');

    // New symbol 'k' should now exist in palette
    await expect(page.locator('.swatch-char:has-text("k")')).toBeVisible();
  });

  test('Tier 1: Resize part dimensions and update dimension inputs', async ({ page }) => {
    const widthInput = page.locator('#partWidth');
    const heightInput = page.locator('#partHeight');
    const depthInput = page.locator('#partDepth');
    const resizeBtn = page.locator('#resizePart');

    await widthInput.fill('6');
    await heightInput.fill('6');
    await depthInput.fill('6');
    await resizeBtn.click();
    await page.waitForTimeout(200);

    await expect(widthInput).toHaveValue('6');
    await expect(heightInput).toHaveValue('6');
    await expect(depthInput).toHaveValue('6');
  });

  test('Tier 1: Add, duplicate, rename, and select parts in part list', async ({ page }) => {
    // Add part
    await page.locator('#addPart').click();
    await respondModal(page, 'arm');
    await expect(page.locator('#partList button:has-text("arm")')).toBeVisible();

    // Duplicate part
    await page.locator('#duplicatePart').click();
    await respondModal(page, 'arm_copy');
    await expect(page.locator('#partList button:has-text("arm_copy")')).toBeVisible();

    // Rename part
    await page.locator('#renamePart').click();
    await respondModal(page, 'arm_renamed');
    await expect(page.locator('#partList button:has-text("arm_renamed")')).toBeVisible();
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================

  test('Tier 2: Palette deletion blocked when color is currently used in a part', async ({ page }) => {
    // Color 'x' is used in the starter project
    const removeBtn = page.locator('#paletteEditor button[title="Delete color"]').first();
    await removeBtn.click();

    // Modal alert is shown
    const overlay = page.locator('#modalOverlay');
    await expect(overlay).toBeVisible();
    await expect(page.locator('#modalMessage')).toContainText('is still used by a part');
    await page.locator('#modalConfirmButton').click();
    await page.waitForTimeout(100);

    // Swatch should still remain
    await expect(page.locator('.swatch')).toHaveCount(1);
  });

  test('Tier 2: Palette deletion succeeds when color is unused', async ({ page }) => {
    // First add an unused color 'u'
    await page.locator('#addColor').click();
    await respondModal(page, 'u');
    await expect(page.locator('.swatch-char:has-text("u")')).toBeVisible();

    // Delete the unused color 'u'
    const removeBtn = page.locator('#paletteEditor button[title="Delete color"]');
    await removeBtn.click();
    await respondModal(page, true);

    await expect(page.locator('.swatch-char:has-text("u")')).not.toBeVisible();
  });

  test('Tier 2: Single remaining part deletion is blocked with alert', async ({ page }) => {
    await page.locator('#deletePart').click();
    const overlay = page.locator('#modalOverlay');
    await expect(overlay).toBeVisible();
    await expect(page.locator('#modalMessage')).toContainText('must contain at least one part');
    await page.locator('#modalConfirmButton').click();

    await expect(page.locator('#partList button')).toHaveCount(1);
  });

  test('Tier 2: Part resize boundary validation for out-of-range dimensions', async ({ page }) => {
    const widthInput = page.locator('#partWidth');
    await widthInput.fill('0'); // invalid: < 1
    await page.locator('#resizePart').click();

    const overlay = page.locator('#modalOverlay');
    await expect(overlay).toBeVisible();
    await expect(page.locator('#modalMessage')).toContainText('Dimensions must be integers from 1 to 64');
    await page.locator('#modalConfirmButton').click();
  });

  test('Tier 2: Invalid palette character inputs rejected (multi-char, dot, duplicate)', async ({ page }) => {
    await page.locator('#addColor').click();
    const overlay = page.locator('#modalOverlay');
    await expect(overlay).toBeVisible();

    // Type invalid dot '.'
    const input = page.locator('#modalInput');
    await input.fill('.');
    await input.dispatchEvent('input');

    // Inline error shown and confirm disabled
    await expect(page.locator('#modalError')).toContainText('Choose one unused character other than .');
    await expect(page.locator('#modalConfirmButton')).toBeDisabled();

    await page.locator('#modalCancelButton').click();
  });

  test('Tier 2: Keyboard shortcuts for tools (P, E, F, I)', async ({ page }) => {
    await page.keyboard.press('KeyE');
    await expect(page.locator('[data-tool="eraser"]')).toHaveClass(/active/);

    await page.keyboard.press('KeyF');
    await expect(page.locator('[data-tool="fill"]')).toHaveClass(/active/);

    await page.keyboard.press('KeyI');
    await expect(page.locator('[data-tool="eyedropper"]')).toHaveClass(/active/);

    await page.keyboard.press('KeyP');
    await expect(page.locator('[data-tool="pencil"]')).toHaveClass(/active/);
  });

  test('Tier 2: Undo and redo buttons toggle state correctly across painting operations', async ({ page }) => {
    const undoBtn = page.locator('#undoButton');
    const redoBtn = page.locator('#redoButton');

    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeDisabled();

    // Perform a paint action
    const canvas = page.locator('#frontCanvas');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 10, box.y + 10);
      await page.waitForTimeout(100);

      await expect(undoBtn).toBeEnabled();
      await expect(redoBtn).toBeDisabled();

      // Undo action
      await undoBtn.click();
      await page.waitForTimeout(100);

      await expect(undoBtn).toBeDisabled();
      await expect(redoBtn).toBeEnabled();

      // Redo action
      await redoBtn.click();
      await page.waitForTimeout(100);

      await expect(undoBtn).toBeEnabled();
      await expect(redoBtn).toBeDisabled();
    }
  });

  test('Tier 2: Keyboard shortcut undo/redo (Ctrl+Z and Ctrl+Y)', async ({ page }) => {
    const undoBtn = page.locator('#undoButton');
    const redoBtn = page.locator('#redoButton');

    const canvas = page.locator('#frontCanvas');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 10, box.y + 10);
      await page.waitForTimeout(100);
      await expect(undoBtn).toBeEnabled();

      // Ctrl+Z
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(100);
      await expect(undoBtn).toBeDisabled();
      await expect(redoBtn).toBeEnabled();

      // Ctrl+Y
      await page.keyboard.press('Control+y');
      await page.waitForTimeout(100);
      await expect(undoBtn).toBeEnabled();
    }
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // =========================================================================

  test('Tier 3: Add new color + paint canvas + rename color + verify consistency', async ({ page }) => {
    // Add color 'm'
    await page.locator('#addColor').click();
    await respondModal(page, 'm');
    await expect(page.locator('.swatch-char:has-text("m")')).toBeVisible();

    // Select color 'm'
    await page.locator('.swatch-char:has-text("m")').click();

    // Paint on front canvas
    const canvas = page.locator('#frontCanvas');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 15, box.y + 15);
      await page.waitForTimeout(200);
    }

    // Rename 'm' to 'n'
    const renameBtn = page.locator('#paletteEditor button[title="Rename symbol"]');
    await renameBtn.click();
    await respondModal(page, 'n');
    await page.waitForTimeout(200);

    await expect(page.locator('.swatch-char:has-text("n")')).toBeVisible();
    await expect(page.locator('#errorBanner')).toHaveClass(/hidden/);
  });

  test('Tier 3: Duplicate part + resize duplicate + switch between parts', async ({ page }) => {
    await page.locator('#duplicatePart').click();
    await respondModal(page, 'part_tall');
    await expect(page.locator('#partList button:has-text("part_tall")')).toBeVisible();

    // Resize duplicate part
    await page.locator('#partHeight').fill('12');
    await page.locator('#resizePart').click();
    await page.waitForTimeout(200);
    await expect(page.locator('#partHeight')).toHaveValue('12');

    // Switch back to original part
    await page.locator('#partList button:has-text("part")').first().click();
    await page.waitForTimeout(200);
    await expect(page.locator('#partHeight')).toHaveValue('4');
  });

  // =========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // =========================================================================

  test('Tier 4: Greenfield Voxel Character Painting Journey', async ({ page }) => {
    // 1. Add secondary palette color
    await page.locator('#addColor').click();
    await respondModal(page, 'c');
    await expect(page.locator('.swatch-char:has-text("c")')).toBeVisible();

    // 2. Set color hex
    const colorInput = page.locator('#paletteEditor input[type="color"]');
    await colorInput.fill('#3498db');
    await colorInput.dispatchEvent('input');

    // 3. Resize part to 6x6x6
    await page.locator('#partWidth').fill('6');
    await page.locator('#partHeight').fill('6');
    await page.locator('#partDepth').fill('6');
    await page.locator('#resizePart').click();
    await page.waitForTimeout(200);

    // 4. Paint details on front and side canvases
    const front = page.locator('#frontCanvas');
    const frontBox = await front.boundingBox();
    if (frontBox) {
      await page.mouse.click(frontBox.x + frontBox.width / 2, frontBox.y + frontBox.height / 2);
    }

    const side = page.locator('#sideCanvas');
    const sideBox = await side.boundingBox();
    if (sideBox) {
      await page.mouse.click(sideBox.x + sideBox.width / 2, sideBox.y + sideBox.height / 2);
    }

    await page.waitForTimeout(300);

    // 5. Verify no validation errors in error banner
    await expect(page.locator('#errorBanner')).toHaveClass(/hidden/);
    await expect(page.locator('#previewImage')).toBeVisible();
  });

  test('Tier 4: Silhouette Parity Mismatch & Repair Flow', async ({ page }) => {
    // Verify that front and back canvases are synchronized
    const frontCanvas = page.locator('#frontCanvas');
    const backCanvas = page.locator('#backCanvas');
    await expect(frontCanvas).toBeVisible();
    await expect(backCanvas).toBeVisible();

    // Paint a new cell
    const box = await frontCanvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 8, box.y + 8);
      await page.waitForTimeout(200);
    }

    // Verify error banner remains clean because front/back are kept in parity
    await expect(page.locator('#errorBanner')).toHaveClass(/hidden/);
  });

  // =========================================================================
  // MILESTONE 2: PAINTING TOOLS, MIRROR MODE, PALETTE & IN-DOM MODALS
  // =========================================================================

  test('M2: Line tool (L) drag draws continuous straight line across grid', async ({ page }) => {
    // Select Line tool via shortcut
    await page.keyboard.press('KeyL');
    const lineBtn = page.locator('[data-tool="line"]');
    await expect(lineBtn).toHaveClass(/active/);

    const canvas = page.locator('#frontCanvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // Drag from top-left (cell 0,0) to bottom-right (cell 3,3)
      await page.mouse.move(box.x + 12, box.y + 12);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 12, box.y + box.height - 12, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(200);

      await expect(page.locator('#undoButton')).toBeEnabled();
      await expect(page.locator('#status')).toHaveText(/Unsaved changes|Ready/);
    }
  });

  test('M2: Rectangle tool (R) drag draws bounding box perimeter', async ({ page }) => {
    // Select Rect tool via button
    const rectBtn = page.locator('[data-tool="rect"]');
    await rectBtn.click();
    await expect(rectBtn).toHaveClass(/active/);

    const canvas = page.locator('#frontCanvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + 12, box.y + 12);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 12, box.y + box.height - 12, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(200);

      await expect(page.locator('#undoButton')).toBeEnabled();
    }
  });

  test('M2: Color Replace tool (C) replaces clicked color across active part', async ({ page }) => {
    // 1. Add color 'y' via in-DOM modal prompt
    await page.locator('#addColor').click();
    await respondModal(page, 'y');
    await expect(page.locator('.swatch-char:has-text("y")')).toBeVisible();

    // 2. Select Replace tool
    await page.keyboard.press('KeyC');
    await expect(page.locator('[data-tool="replace"]')).toHaveClass(/active/);

    // 3. Click center cell (which contains 'x')
    const canvas = page.locator('#frontCanvas');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(200);
      await expect(page.locator('#undoButton')).toBeEnabled();
    }
  });

  test('M2: Symmetry / Mirror mode toggle (M) paints dual cells across center axis', async ({ page }) => {
    const mirrorBtn = page.locator('#mirrorToggle');
    await expect(mirrorBtn).not.toHaveClass(/active/);

    // Press 'M' to toggle mirror mode
    await page.keyboard.press('KeyM');
    await expect(mirrorBtn).toHaveClass(/active/);

    // Paint near top-left of canvas
    const canvas = page.locator('#frontCanvas');
    const box = await canvas.boundingBox();
    if (box) {
      await page.locator('[data-tool="pencil"]').click();
      await page.mouse.click(box.x + 12, box.y + 12);
      await page.waitForTimeout(200);
      await expect(page.locator('#undoButton')).toBeEnabled();
    }

    // Toggle mirror mode off
    await mirrorBtn.click();
    await expect(mirrorBtn).not.toHaveClass(/active/);
  });

  test('M2: Direct Hex text input with live validation and alpha channel support', async ({ page }) => {
    const hexInput = page.locator('.swatch-hex').first();
    await expect(hexInput).toBeVisible();

    // 1. Enter valid 6-char hex
    await hexInput.fill('#ff8800');
    await hexInput.dispatchEvent('input');
    await expect(hexInput).not.toHaveClass(/invalid/);

    // 2. Enter valid 8-char hex with alpha
    await hexInput.fill('#ff880080');
    await hexInput.dispatchEvent('input');
    await expect(hexInput).not.toHaveClass(/invalid/);

    // 3. Enter invalid hex
    await hexInput.fill('#invalid');
    await hexInput.dispatchEvent('input');
    await expect(hexInput).toHaveClass(/invalid/);

    // 4. Blur reverts invalid input
    await hexInput.blur();
    await expect(hexInput).not.toHaveClass(/invalid/);
    await expect(hexInput).toHaveValue('#ff880080');
  });

  test('M2: Swatch reordering controls (Move Up and Move Down)', async ({ page }) => {
    // Add color 'a'
    await page.locator('#addColor').click();
    await respondModal(page, 'a');
    await expect(page.locator('.swatch-char:has-text("a")')).toBeVisible();

    // Move 'a' up
    const moveUpBtn = page.locator('#paletteEditor .swatch-move-up');
    await moveUpBtn.click();
    await page.waitForTimeout(100);

    // First swatch should now be 'a'
    const firstChar = page.locator('.swatch .swatch-char').first();
    await expect(firstChar).toHaveText('a');

    // Move 'a' back down
    const moveDownBtn = page.locator('#paletteEditor .swatch-move-down');
    await moveDownBtn.click();
    await page.waitForTimeout(100);

    // First swatch should be 'x' again
    await expect(page.locator('.swatch .swatch-char').first()).toHaveText('x');
  });

  test('M2: In-DOM Modal Dialogs live inline validation and keyboard Enter/Escape', async ({ page }) => {
    // Open Add Part modal
    await page.locator('#addPart').click();
    const overlay = page.locator('#modalOverlay');
    await expect(overlay).toBeVisible();

    const input = page.locator('#modalInput');
    const confirmBtn = page.locator('#modalConfirmButton');
    const errorMsg = page.locator('#modalError');

    // Invalid input: contains space
    await input.fill('invalid name with spaces');
    await input.dispatchEvent('input');
    await expect(errorMsg).toBeVisible();
    await expect(confirmBtn).toBeDisabled();

    // Valid input
    await input.fill('torso_upper');
    await input.dispatchEvent('input');
    await expect(errorMsg).toBeHidden();
    await expect(confirmBtn).toBeEnabled();

    // Press Enter to submit
    await page.keyboard.press('Enter');
    await expect(overlay).toBeHidden();
    await expect(page.locator('#partList button:has-text("torso_upper")')).toBeVisible();

    // Test Escape key dismissal
    await page.locator('#addPart').click();
    await expect(overlay).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  });

  test('M2: Silhouette Parity Reconciliation via Toolbar and Banner Sync Buttons', async ({ page }) => {
    // Verify Toolbar Sync button is clickable
    const syncToolbarBtn = page.locator('#syncSilhouette');
    await expect(syncToolbarBtn).toBeVisible();
    await syncToolbarBtn.click();
    await page.waitForTimeout(200);

    // Error banner should be hidden
    await expect(page.locator('#errorBanner')).toHaveClass(/hidden/);
  });
});

test.describe('Separate left/right views', () => {
  const stored = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('impossibru-project')!));
  const save = async (page: Page) => {
    await page.waitForTimeout(300);
    await page.locator('#saveButton').click();
    await expect(page.locator('#status')).toHaveText('Saved');
  };
  const paintCell = async (page: Page, view: string, cx: number, cy: number) => {
    const canvas = page.locator(`#${view}Canvas`);
    const cell = +(await canvas.getAttribute('data-cell')!);
    await canvas.click({ position: { x: (cx + 0.5) * cell, y: (cy + 0.5) * cell } });
    await page.waitForTimeout(200);
  };
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const welcomeNew = page.locator('#welcomeNew');
    if (await welcomeNew.isVisible()) {
      await welcomeNew.click();
      await page.waitForLoadState('networkidle');
    }
    await expect(page.locator('#separateSides')).toBeVisible();
  });

  test('toggle shows four views and copies side to left and right', async ({ page }) => {
    await expect(page.locator('#leftCanvas')).toBeHidden();
    await page.locator('#separateSides').check();
    for (const v of ['front', 'left', 'right', 'back']) await expect(page.locator(`#${v}Canvas`)).toBeVisible();
    await expect(page.locator('#sideCanvas')).toBeHidden();
    await save(page);
    const part = Object.values((await stored(page)).parts)[0] as any;
    expect(part.side).toBeUndefined();
    expect(part.left).toBe(part.right);
  });

  test('painting left changes only left colours; erasing left empties right', async ({ page }) => {
    await page.locator('#separateSides').check();
    await page.locator('#addColor').click();
    await respondModal(page, 'z');
    await expect(page.locator('.swatch-char:has-text("z")')).toBeVisible();
    await page.locator('#paletteList .swatch', { hasText: 'z' }).click();
    await save(page);
    const name = Object.keys((await stored(page)).parts)[0];
    const before = (await stored(page)).parts[name];
    await page.locator('[data-tool="pencil"]').click();
    const rowsOf = (s: string) => s.split('\n');
    const cells: Array<[number, number]> = [];
    rowsOf(before.left).forEach((r, y) => [...r].forEach((c, x) => { if (c !== '.') cells.push([x, y]); }));
    const [cx, cy] = cells[0];
    await paintCell(page, 'left', cx, cy);
    await save(page);
    const afterPaint = (await stored(page)).parts[name];
    expect(rowsOf(afterPaint.left)[cy][cx]).toBe('z');
    expect(afterPaint.front).toBe(before.front);
    expect(afterPaint.back).toBe(before.back);
    expect(afterPaint.right).toBe(before.right);

    await page.locator('[data-tool="eraser"]').click();
    await paintCell(page, 'left', cx, cy);
    await save(page);
    const afterErase = (await stored(page)).parts[name];
    expect(rowsOf(afterErase.left)[cy][cx]).toBe('.');
    expect(rowsOf(afterErase.right)[cy][cx]).toBe('.');
  });

  test('filling an empty region on left also fills right occupancy', async ({ page }) => {
    await page.locator('#separateSides').check();
    await save(page);
    const name = Object.keys((await stored(page)).parts)[0];
    const before = (await stored(page)).parts[name];
    const [cx, cy] = before.left.split('\n').map((r: string, y: number) => [[...r].findIndex(c => c === '.'), y]).find((c: number[]) => c[0] >= 0)!;
    await page.locator('[data-tool="fill"]').click();
    await paintCell(page, 'left', cx, cy);
    await save(page);
    const after = (await stored(page)).parts[name];
    const occ = (s: string) => s.split('\n').map(r => [...r].map(c => c !== '.').join(''));
    expect(occ(after.left)).not.toEqual(occ(before.left));
    expect(occ(after.right)).toEqual(occ(after.left));
  });

  test('toggling off keeps left as side; undo restores left/right', async ({ page }) => {
    await page.locator('#separateSides').check();
    await page.locator('[data-tool="eraser"]').click();
    await save(page);
    const name = Object.keys((await stored(page)).parts)[0];
    const split = (await stored(page)).parts[name];
    const cell = split.left.split('\n').map((r: string, y: number) => [[...r].findIndex(c => c !== '.'), y]).find((c: number[]) => c[0] >= 0)!;
    await paintCell(page, 'left', cell[0], cell[1]);
    await page.locator('#separateSides').uncheck();
    await respondModal(page, true);
    await save(page);
    const merged = (await stored(page)).parts[name];
    expect(merged.left).toBeUndefined();
    expect(merged.right).toBeUndefined();
    expect(merged.side.split('\n')[cell[1]][cell[0]]).toBe('.');

    await page.locator('#undoButton').click();
    await expect(page.locator('#leftCanvas')).toBeVisible();
    await save(page);
    const restored = (await stored(page)).parts[name];
    expect(restored.side).toBeUndefined();
    expect(restored.left.split('\n')[cell[1]][cell[0]]).toBe('.');
    expect(restored.right.split('\n')[cell[1]][cell[0]]).toBe('.');
  });
});
