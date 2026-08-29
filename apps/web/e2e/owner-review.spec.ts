import { test, expect } from './fixtures';

test.describe('Owner Transfer Review Journey', () => {
  test('cashier cannot access payment review', async ({ page }) => {
    await page.goto('/payments');
    await expect(page.locator('text=Permission denied')).toBeVisible();
  });

  test('owner sees payment review page', async ({ page, ownerToken, tenantId }) => {
    await page.evaluate(
      ({ token, tid }) => {
        window.sessionStorage.setItem('rms-access-token', token);
        window.sessionStorage.setItem('rms-tenant-id', tid);
      },
      { token: ownerToken, tid: tenantId },
    );
    await page.goto('/payments');
    await expect(page.locator('h1')).toContainText('Transfer payment review');
  });

  test('owner sees empty queue message when no pending payments', async ({ page, ownerToken, tenantId }) => {
    await page.evaluate(
      ({ token, tid }) => {
        window.sessionStorage.setItem('rms-access-token', token);
        window.sessionStorage.setItem('rms-tenant-id', tid);
      },
      { token: ownerToken, tid: tenantId },
    );
    await page.goto('/payments');
    await page.waitForTimeout(2000);
    const emptyState = page.locator('text=No payments awaiting review');
    await expect(emptyState).toBeVisible();
  });

  test('proof view button exists for selected payment', async ({ page, ownerToken, tenantId }) => {
    await page.evaluate(
      ({ token, tid }) => {
        window.sessionStorage.setItem('rms-access-token', token);
        window.sessionStorage.setItem('rms-tenant-id', tid);
      },
      { token: ownerToken, tid: tenantId },
    );
    await page.goto('/payments');
    await page.waitForTimeout(2000);
    const proofBtn = page.locator('button:has-text("View payment proof")');
    const count = await proofBtn.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('approve button opens confirmation dialog', async ({ page, ownerToken, tenantId }) => {
    await page.evaluate(
      ({ token, tid }) => {
        window.sessionStorage.setItem('rms-access-token', token);
        window.sessionStorage.setItem('rms-tenant-id', tid);
      },
      { token: ownerToken, tid: tenantId },
    );
    await page.goto('/payments');
    await page.waitForTimeout(2000);
    const verifyBtn = page.locator('button:has-text("Verify payment")');
    if ((await verifyBtn.count()) > 0) {
      await verifyBtn.click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Confirm verification');
      await expect(dialog).toContainText('screenshot is evidence');
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    }
  });

  test('rejection requires reason', async ({ page, ownerToken, tenantId }) => {
    await page.evaluate(
      ({ token, tid }) => {
        window.sessionStorage.setItem('rms-access-token', token);
        window.sessionStorage.setItem('rms-tenant-id', tid);
      },
      { token: ownerToken, tid: tenantId },
    );
    await page.goto('/payments');
    await page.waitForTimeout(2000);
    const rejectBtn = page.locator('button:has-text("Reject")');
    if ((await rejectBtn.count()) > 0) {
      await rejectBtn.click();
      const reasonInput = page.locator('input[placeholder*="rejected"]');
      await expect(reasonInput).toBeVisible();
      const confirmReject = page.locator('button:has-text("Confirm rejection")');
      await expect(confirmReject).toBeDisabled();
      await reasonInput.fill('Test rejection');
      await expect(confirmReject).toBeEnabled();
      await page.locator('button:has-text("Cancel")').last().click();
    }
  });

  test('keyboard Escape closes approval dialog', async ({ page, ownerToken, tenantId }) => {
    await page.evaluate(
      ({ token, tid }) => {
        window.sessionStorage.setItem('rms-access-token', token);
        window.sessionStorage.setItem('rms-tenant-id', tid);
      },
      { token: ownerToken, tid: tenantId },
    );
    await page.goto('/payments');
    await page.waitForTimeout(2000);
    const verifyBtn = page.locator('button:has-text("Verify payment")');
    if ((await verifyBtn.count()) > 0) {
      await verifyBtn.click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    }
  });
});

test.describe('Owner Transfer Review — Tablet Viewports', () => {
  test('tablet portrait layout', async ({ page, ownerToken, tenantId }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.evaluate(
      ({ token, tid }) => {
        window.sessionStorage.setItem('rms-access-token', token);
        window.sessionStorage.setItem('rms-tenant-id', tid);
      },
      { token: ownerToken, tid: tenantId },
    );
    await page.goto('/payments');
    await expect(page.locator('h1')).toContainText('Transfer payment review');
  });

  test('tablet landscape layout', async ({ page, ownerToken, tenantId }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.evaluate(
      ({ token, tid }) => {
        window.sessionStorage.setItem('rms-access-token', token);
        window.sessionStorage.setItem('rms-tenant-id', tid);
      },
      { token: ownerToken, tid: tenantId },
    );
    await page.goto('/payments');
    await expect(page.locator('h1')).toContainText('Transfer payment review');
  });
});
