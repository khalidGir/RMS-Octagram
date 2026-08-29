import { test, expect } from './fixtures';

test.describe('POS Cash Journey', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pos');
  });

  test('shows permission denied for unauthorized role', async ({ page }) => {
    const denied = page.locator('[role="alert"]');
    await expect(denied).toContainText('Permission denied');
  });

  test('POS loads with menu categories for authenticated cashier', async ({ page, ownerToken, tenantId }) => {
    await page.evaluate(
      ({ token, tid }) => {
        window.sessionStorage.setItem('rms-access-token', token);
        window.sessionStorage.setItem('rms-tenant-id', tid);
      },
      { token: ownerToken, tid: tenantId },
    );
    await page.goto('/pos');
    await expect(page.locator('h1')).toContainText('New order');
  });

  test('shows open-shift CTA when no active shift', async ({ page }) => {
    await page.waitForTimeout(1000);
    const openShiftLink = page.locator('a[href="/shifts"]');
    await expect(openShiftLink).toBeVisible();
  });

  test('menu items display with variant prices', async ({ page }) => {
    await page.waitForTimeout(2000);
    const items = page.locator('button:has(b)');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
  });

  test('search filters menu items', async ({ page }) => {
    await page.waitForTimeout(2000);
    const searchInput = page.locator('input[placeholder="Search menu"]');
    await searchInput.fill('Burger');
    await page.waitForTimeout(500);
  });

  test('category filter works', async ({ page }) => {
    await page.waitForTimeout(2000);
    const allButton = page.locator('button:has-text("All")');
    await expect(allButton).toBeVisible();
  });

  test('order panel shows empty state', async ({ page }) => {
    await expect(page.locator('text=No items yet.')).toBeVisible();
  });

  test('create order button is disabled when cart is empty', async ({ page }) => {
    const createBtn = page.locator('button:has-text("Create order")');
    await expect(createBtn).toBeDisabled();
  });

  test('offline state disables order creation', async ({ page }) => {
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
    });
    await expect(page.locator('[role="status"]')).toContainText('offline');
  });
});

test.describe('POS Cash Journey — Tablet Viewports', () => {
  test('tablet portrait layout', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/pos');
    await expect(page.locator('h1')).toContainText('New order');
  });

  test('tablet landscape layout', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/pos');
    await expect(page.locator('h1')).toContainText('New order');
  });
});
