import { test, expect } from '@playwright/test';

test('test-drive autorigging, spring physics, and procedural animation controls', async ({ page }, testInfo) => {
  page.on('dialog', dialog => dialog.accept('test_character.yaml'));
  page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  // 1. Click 'Try example' on welcome card if visible
  const welcomeExample = page.locator('#welcomeExample');
  if (await welcomeExample.isVisible()) {
    await welcomeExample.click();
    await page.waitForLoadState('networkidle');
  }

  await expect(page.getByRole('button', { name: 'Parts' })).toBeVisible();

  // Wait until preview image is rendered
  await page.waitForSelector('#previewImage[data-rendered="true"]', { timeout: 10000 });
  await page.waitForTimeout(300);

  await page.screenshot({ path: testInfo.outputPath('01_parts_workspace.png') });

  // 2. Switch to Rig workspace
  await page.locator('button[data-workspace="rig"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#autoRigButton')).toBeVisible();

  // 3. Trigger Autorig
  await page.locator('#autoRigButton').click();
  
  await page.waitForSelector('#rigImage[data-rendered="true"]', { timeout: 10000 });
  await page.waitForTimeout(300);

  await page.screenshot({ path: testInfo.outputPath('02_autorigged_workspace.png') });

  // 4. Select a bone in the tree to inspect spring physics & constraints
  const boneItem = page.locator('#boneTree .bone-name').first();
  if (await boneItem.isVisible()) {
    await boneItem.click();
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: testInfo.outputPath('03_bone_spring_inspector.png') });

  // 5. Switch to Animate workspace
  await page.locator('button[data-workspace="animate"]').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('04_procedural_anim_controls.png') });
});
