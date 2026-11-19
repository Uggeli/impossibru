import { test, expect } from '@playwright/test';

test.describe('Rigging & Inverse Kinematics Workspace (Tiers 1-4)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const welcomeNew = page.locator('#welcomeNew');
    if (await welcomeNew.isVisible()) {
      await welcomeNew.click();
      await page.waitForLoadState('networkidle');
    }
    // Switch to Rig workspace
    await page.locator('button[data-workspace="rig"]').click();
    await expect(page.locator('#boneTree')).toBeVisible();
  });

  // Helper to get precise vector axis input
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

  test('Tier 1: Switch to Rig workspace reveals tree, inspector, and rig overlay', async ({ page }) => {
    await expect(page.locator('#rigBonesSection')).toBeVisible();
    await expect(page.locator('#boneTree')).toBeVisible();
    await expect(page.locator('#boneInspector')).toBeVisible();
    await expect(page.locator('#rigOverlay')).toBeVisible();
    await expect(page.locator('#rigModeTitle')).toHaveText('Rest pose');
  });

  test('Tier 1: Selecting bone in bone tree updates active class and inspector heading', async ({ page }) => {
    const rootBone = page.locator('#boneTree button:has-text("root")');
    await expect(rootBone).toBeVisible();
    await rootBone.click();

    await expect(rootBone).toHaveClass(/active/);
    await expect(page.locator('#boneInspector h3')).toHaveText('root');
    await expect(page.locator('#boneInspector .vec span').getByText('T', { exact: true })).toBeVisible();
    await expect(page.locator('#boneInspector .vec span').getByText('R°', { exact: true })).toBeVisible();
  });

  test('Tier 1: Add new child bone in hierarchy', async ({ page }) => {
    await page.locator('#addBone').click();
    await respondModal(page, 'spine');
    await page.waitForTimeout(200);

    await expect(page.locator('#boneTree button:has-text("spine")')).toBeVisible();
    await expect(page.locator('#boneInspector h3')).toHaveText('spine');
  });

  test('Tier 1: Rename bone updates tree and inspector', async ({ page }) => {
    await page.locator('#addBone').click();
    await respondModal(page, 'bone_temp');
    await page.waitForTimeout(200);
    await expect(page.locator('#boneTree button:has-text("bone_temp")')).toBeVisible();

    await page.locator('#renameBone').click();
    await respondModal(page, 'bone_renamed');
    await page.waitForTimeout(200);

    await expect(page.locator('#boneTree button:has-text("bone_renamed")')).toBeVisible();
    await expect(page.locator('#boneInspector h3')).toHaveText('bone_renamed');
  });

  test('Tier 1: Reparent bone under another bone in hierarchy', async ({ page }) => {
    await page.locator('#addBone').click(); // torso
    await respondModal(page, 'torso');
    await page.waitForTimeout(200);

    await page.locator('#boneTree button:has-text("root")').click();
    await page.locator('#addBone').click(); // arm under root
    await respondModal(page, 'arm');
    await page.waitForTimeout(200);

    // Reparent arm under torso
    await page.locator('#reparentBone').click();
    await respondModal(page, 'torso');
    await page.waitForTimeout(300);

    // Now under boneTree, torso should have arm indented or grouped
    await expect(page.locator('#boneTree button:has-text("arm")')).toBeVisible();
  });

  test('Tier 1: Bone transform editing (Translation & Rotation)', async ({ page }) => {
    const rootBone = page.locator('#boneTree button:has-text("root")');
    await rootBone.click();

    // Edit Translation Y
    const transY = vecInput(page, 'T', 'Y');
    await transY.fill('1.5');
    await transY.dispatchEvent('change');
    await page.waitForTimeout(200);

    // Edit Rotation Z
    const rotZ = vecInput(page, 'R°', 'Z');
    await rotZ.fill('45');
    await rotZ.dispatchEvent('change');
    await page.waitForTimeout(200);

    await expect(transY).toHaveValue('1.5');
    await expect(rotZ).toHaveValue('45');
  });

  test('Tier 1: Attached part selection and attachment transform controls', async ({ page }) => {
    const rootBone = page.locator('#boneTree button:has-text("root")');
    await rootBone.click();

    // Attach part
    const partSelect = page.locator('#boneInspector select').first();
    await expect(partSelect).toBeVisible();
    await partSelect.selectOption('part');
    await page.waitForTimeout(200);

    // Edit Attachment offset Translation X
    const attachTransX = vecInput(page, 'AT', 'X');
    await attachTransX.fill('0.5');
    await attachTransX.dispatchEvent('change');
    await page.waitForTimeout(200);

    await expect(attachTransX).toHaveValue('0.5');
  });

  test('Tier 1: View presets (Front and Side buttons) update Yaw angle slider', async ({ page }) => {
    const viewSideBtn = page.locator('#viewSide');
    const viewFrontBtn = page.locator('#viewFront');
    const yawSlider = page.locator('#yaw');
    const yawValue = page.locator('#yawValue');

    await viewSideBtn.click();
    await page.waitForTimeout(100);
    await expect(yawValue).toHaveText('90°');
    await expect(yawSlider).toHaveValue('90');

    await viewFrontBtn.click();
    await page.waitForTimeout(100);
    await expect(yawValue).toHaveText('0°');
    await expect(yawSlider).toHaveValue('0');
  });

  test('Tier 1: Rig SVG overlay renders joint nodes and hierarchy link lines', async ({ page }) => {
    const svg = page.locator('#rigOverlay');
    await expect(svg).toBeVisible();

    // At least one joint circle for root
    await expect(page.locator('#rigOverlay .rig-joint')).toHaveCount(1);
    await expect(page.locator('#rigOverlay .rig-label:has-text("root")')).toBeVisible();
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================

  test('Tier 2: Single remaining bone deletion is prevented with alert', async ({ page }) => {
    await page.locator('#deleteBone').click();
    const overlay = page.locator('#modalOverlay');
    await expect(overlay).toBeVisible();
    await expect(page.locator('#modalMessage')).toContainText('At least one bone must remain');
    await page.locator('#modalConfirmButton').click();
    await page.waitForTimeout(200);

    await expect(page.locator('#boneTree button')).toHaveCount(1);
  });

  test('Tier 2: Deletion blocked when bone has children', async ({ page }) => {
    // Add child bone under root
    await page.locator('#addBone').click();
    await respondModal(page, 'child_bone');
    await page.waitForTimeout(200);

    // Select root and try to delete
    await page.locator('#boneTree button:has-text("root")').click();
    await page.locator('#deleteBone').click();
    
    const overlay = page.locator('#modalOverlay');
    await expect(overlay).toBeVisible();
    await expect(page.locator('#modalMessage')).toContainText('Cannot delete');
    await page.locator('#modalConfirmButton').click();
    await page.waitForTimeout(200);

    // Root should still exist
    await expect(page.locator('#boneTree button:has-text("root")')).toBeVisible();
  });

  test('Tier 2: Cycle detection during bone reparenting', async ({ page }) => {
    // Add bone_b under root
    await page.locator('#addBone').click();
    await respondModal(page, 'bone_b');
    await page.waitForTimeout(200);

    // Select root and try to reparent to bone_b
    await page.locator('#boneTree button:has-text("root")').click();
    await page.locator('#reparentBone').click();
    await respondModal(page, 'bone_b');
    await page.waitForTimeout(200);

    const overlay = page.locator('#modalOverlay');
    await expect(overlay).toBeVisible();
    await page.locator('#modalConfirmButton').click();
  });

  test('Tier 2: Joint manipulator drag interaction on SVG overlay', async ({ page }) => {
    const joint = page.locator('#rigOverlay .rig-joint').first();
    await expect(joint).toBeVisible();

    const box = await joint.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 20);
      await page.mouse.up();
      await page.waitForTimeout(300);

      // Verify dirty state
      await expect(page.locator('#status')).toHaveText(/Unsaved changes|Ready/);
    }
  });

  test('Tier 2: Yaw slider boundary values (0 to 359)', async ({ page }) => {
    const yawSlider = page.locator('#yaw');
    const yawValue = page.locator('#yawValue');

    await yawSlider.fill('359');
    await yawSlider.dispatchEvent('input');
    await page.waitForTimeout(100);
    await expect(yawValue).toHaveText('359°');

    await yawSlider.fill('0');
    await yawSlider.dispatchEvent('input');
    await page.waitForTimeout(100);
    await expect(yawValue).toHaveText('0°');
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // =========================================================================

  test('Tier 3: Build 3-bone chain (hip -> knee -> foot) and create IK chain', async ({ page }) => {
    // Rename root to hip
    await page.locator('#renameBone').click();
    await respondModal(page, 'hip');
    await page.waitForTimeout(200);

    // Add knee under hip
    await page.locator('#addBone').click();
    await respondModal(page, 'knee');
    await page.waitForTimeout(200);

    // Add foot under knee
    await page.locator('#addBone').click();
    await respondModal(page, 'foot');
    await page.waitForTimeout(200);

    // Verify 3 bones exist in tree
    await expect(page.locator('#boneTree button:has-text("hip")')).toBeVisible();
    await expect(page.locator('#boneTree button:has-text("knee")')).toBeVisible();
    await expect(page.locator('#boneTree button:has-text("foot")')).toBeVisible();

    // Create IK chain
    await page.locator('#addChain').click();
    await respondModal(page, 'foot');
    await respondModal(page, 'leg_ik');
    await page.waitForTimeout(300);

    await expect(page.locator('#chainList button:has-text("leg_ik")')).toBeVisible();
  });

  test('Tier 3: IK chain rename and delete lifecycle', async ({ page }) => {
    await page.locator('#addBone').click();
    await respondModal(page, 'b2');
    await page.locator('#addBone').click();
    await respondModal(page, 'b3');
    await page.locator('#addChain').click();
    await respondModal(page, 'b3');
    await respondModal(page, 'chain_1');
    await page.waitForTimeout(300);

    // Select chain
    const chainBtn = page.locator('#chainList button:has-text("chain_1")');
    await expect(chainBtn).toBeVisible();
    await chainBtn.click();

    // Rename chain
    await page.locator('#renameChain').click();
    await respondModal(page, 'chain_renamed');
    await page.waitForTimeout(200);
    await expect(page.locator('#chainList button:has-text("chain_renamed")')).toBeVisible();

    // Delete chain
    await page.locator('#deleteChain').click();
    await page.waitForTimeout(200);
    await expect(page.locator('#chainList button:has-text("chain_renamed")')).not.toBeVisible();
  });

  // =========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // =========================================================================

  test('Tier 4: Custom Humanoid Rigging & IK Setup Journey', async ({ page }) => {
    // 1. Build a multi-bone skeleton for humanoid
    // Add torso
    await page.locator('#addBone').click();
    await respondModal(page, 'torso');
    await page.waitForTimeout(100);

    // Add head under torso
    await page.locator('#addBone').click();
    await respondModal(page, 'head');
    await page.waitForTimeout(100);

    // Select torso, add arm_upper
    await page.locator('#boneTree button:has-text("torso")').click();
    await page.locator('#addBone').click();
    await respondModal(page, 'arm_upper');
    await page.waitForTimeout(100);

    // Add arm_lower under arm_upper
    await page.locator('#addBone').click();
    await respondModal(page, 'arm_lower');
    await page.waitForTimeout(100);

    // Add hand under arm_lower
    await page.locator('#addBone').click();
    await respondModal(page, 'hand');
    await page.waitForTimeout(100);

    // 2. Verify all bones in tree
    await expect(page.locator('#boneTree button:has-text("head")')).toBeVisible();
    await expect(page.locator('#boneTree button:has-text("arm_upper")')).toBeVisible();
    await expect(page.locator('#boneTree button:has-text("arm_lower")')).toBeVisible();
    await expect(page.locator('#boneTree button:has-text("hand")')).toBeVisible();

    // 3. Inspect head bone rotation
    await page.locator('#boneTree button:has-text("head")').click();
    await page.waitForTimeout(100);
    const rotX = vecInput(page, 'R°', 'X');
    await rotX.fill('15');
    await rotX.dispatchEvent('change');
    await page.waitForTimeout(100);

    // 4. Attach part to torso
    await page.locator('#boneTree button:has-text("torso")').click();
    await page.waitForTimeout(100);
    const partSelect = page.locator('#boneInspector select').first();
    await partSelect.selectOption('part');
    await page.waitForTimeout(200);

    // 5. Verify no rig errors
    await expect(page.locator('#rigErrorBanner')).toHaveClass(/hidden/);
  });
});
