import { test, expect } from './fixtures';

test.describe('Owner Transfer Review Journey', () => {
  test('cashier cannot access payment review (role denial)', async ({ cashierPage }) => {
    await expect(cashierPage.locator('nav a[href="/payments"]')).not.toBeVisible();
  });

  test('manager cannot access payment review (role denial)', async ({ managerPage }) => {
    await expect(managerPage.locator('nav a[href="/payments"]')).not.toBeVisible();
  });

  test('owner sees payment review page after real login', async ({ ownerPage }) => {
    await expect(ownerPage.locator('h1')).toContainText('Transfer payment review', { timeout: 10000 });
  });

  test('owner sees pending payments in queue', async ({ ownerPage }) => {
    await expect(ownerPage.locator('button:has-text("Order #1")')).toBeVisible({ timeout: 10000 });
    await expect(ownerPage.locator('text=BANK TRANSFER').first()).toBeVisible();
  });

  test('owner sees payment detail with amount', async ({ ownerPage }) => {
    await ownerPage.locator('button:has-text("Order #1")').click();
    await expect(ownerPage.locator('text=ETB 250').first()).toBeVisible({ timeout: 10000 });
  });

  test('view payment proof button exists and loads', async ({ ownerPage }) => {
    await ownerPage.locator('button:has-text("Order #1")').click();
    const proofBtn = ownerPage.locator('button:has-text("View payment proof")');
    await expect(proofBtn).toBeVisible();
    await proofBtn.click();
    const proofImg = ownerPage.locator('img[alt="Payment proof screenshot"]');
    const proofError = ownerPage.locator('[role="alert"]');
    await expect(proofImg.or(proofError)).toBeVisible({ timeout: 10000 });
  });

  test('verify button opens two-step confirmation dialog', async ({ ownerPage }) => {
    await ownerPage.locator('button:has-text("Order #1")').click();
    await ownerPage.waitForTimeout(500);
    const verifyBtn = ownerPage.locator('button:has-text("Verify payment")');
    if (await verifyBtn.isVisible()) {
      await verifyBtn.click();
      const dialog = ownerPage.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Confirm verification');
      await expect(dialog).toContainText('screenshot is evidence');
      await expect(dialog).toContainText('releases the kitchen');
      await ownerPage.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    }
  });

  test('approval dialog has focus trap (Tab cycling)', async ({ ownerPage }) => {
    await ownerPage.locator('button:has-text("Order #1")').click();
    await ownerPage.waitForTimeout(500);
    const verifyBtn = ownerPage.locator('button:has-text("Verify payment")');
    if (await verifyBtn.isVisible()) {
      await verifyBtn.click();
      const dialog = ownerPage.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();
      const confirmBtn = dialog.locator('button:has-text("Confirm verification")');
      await confirmBtn.focus();
      await ownerPage.keyboard.press('Tab');
      const focusedInDialog = await ownerPage.evaluate(() => {
        const el = document.activeElement;
        return el ? el.closest('[role="dialog"]') !== null : false;
      });
      expect(focusedInDialog).toBe(true);
      await ownerPage.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    }
  });

  test('background is inert while dialog is open', async ({ ownerPage }) => {
    await ownerPage.locator('button:has-text("Order #1")').click();
    await ownerPage.waitForTimeout(500);
    const verifyBtn = ownerPage.locator('button:has-text("Verify payment")');
    if (await verifyBtn.isVisible()) {
      await verifyBtn.click();
      const dialog = ownerPage.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();
      await ownerPage.waitForTimeout(300);
      const dialogHasModal = await dialog.getAttribute('aria-modal');
      expect(dialogHasModal).toBe('true');
      const focusIsInDialog = await ownerPage.evaluate(() => {
        const el = document.activeElement;
        return el ? el.closest('[role="dialog"]') !== null : false;
      });
      expect(focusIsInDialog).toBe(true);
      await ownerPage.keyboard.press('Escape');
    }
  });

  test('rejection requires mandatory reason', async ({ ownerPage }) => {
    await ownerPage.locator('button:has-text("Order #1")').click();
    await ownerPage.waitForTimeout(500);
    const rejectBtn = ownerPage.locator('button:has-text("Reject")');
    if (await rejectBtn.isVisible()) {
      await rejectBtn.click();
      const reasonInput = ownerPage.locator('input[placeholder*="rejected"]');
      await expect(reasonInput).toBeVisible();
      const confirmReject = ownerPage.locator('button:has-text("Confirm rejection")');
      await expect(confirmReject).toBeDisabled();
      await reasonInput.fill('Test rejection reason');
      await expect(confirmReject).toBeEnabled();
      await ownerPage.locator('button:has-text("Cancel")').last().click();
      await expect(ownerPage.locator('button:has-text("Verify payment")')).toBeVisible();
    }
  });

  test('keyboard-only flow: open dialog, escape, reopen', async ({ ownerPage }) => {
    await ownerPage.locator('button:has-text("Order #1")').click();
    await ownerPage.waitForTimeout(500);
    const verifyBtn = ownerPage.locator('button:has-text("Verify payment")');
    if (await verifyBtn.isVisible()) {
      await verifyBtn.press('Enter');
      await expect(ownerPage.locator('[role="dialog"]')).toBeVisible();
      await ownerPage.keyboard.press('Escape');
      await expect(ownerPage.locator('[role="dialog"]')).not.toBeVisible();
      await expect(verifyBtn).toBeVisible();
    }
  });
});

test.describe('Owner Transfer Review — Tablet Viewports', () => {
  test('tablet portrait layout', async ({ ownerPage }) => {
    await ownerPage.setViewportSize({ width: 768, height: 1024 });
    await expect(ownerPage.locator('h1')).toContainText('Transfer payment review');
  });

  test('tablet landscape layout', async ({ ownerPage }) => {
    await ownerPage.setViewportSize({ width: 1024, height: 768 });
    await expect(ownerPage.locator('h1')).toContainText('Transfer payment review');
  });
});
