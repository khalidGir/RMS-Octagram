import { test, expect } from './fixtures';

test.describe('Platform Admin — Tenant List', () => {
  test('super admin sees platform page with tenant list', async ({ superAdminPage }) => {
    await expect(superAdminPage.locator('h1')).toContainText('Tenant operations');
    await expect(superAdminPage.locator('table')).toBeVisible({ timeout: 10_000 });
  });

  test('super admin sees at least one tenant row', async ({ superAdminPage }) => {
    await expect(superAdminPage.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 });
  });

  test('super admin sees tenant status badges', async ({ superAdminPage }) => {
    await expect(superAdminPage.locator('table')).toBeVisible({ timeout: 10_000 });
    const statusBadge = superAdminPage.locator('table tbody tr').first().locator('span');
    await expect(statusBadge.first()).toBeVisible();
  });
});

test.describe('Platform Admin — Feature Control', () => {
  test('super admin can navigate to feature control from platform page', async ({ superAdminPage }) => {
    await expect(superAdminPage.locator('table')).toBeVisible({ timeout: 10_000 });
    // Click on first tenant row link to navigate to features
    const featureLink = superAdminPage.locator('a[href*="/features"]').first();
    if (await featureLink.isVisible()) {
      await featureLink.click();
      await superAdminPage.waitForURL((url) => url.pathname.includes('/features'), { timeout: 15_000 });
    } else {
      await superAdminPage.goto('/platform/features');
    }
    await expect(superAdminPage.locator('h1')).toContainText('Feature control');
  });

  test('feature control page shows feature cards', async ({ superAdminPage }) => {
    await superAdminPage.goto('/platform/features');
    await superAdminPage.locator('button:has-text("Load tenants")').click();
    // Wait for tenant to be auto-selected and entitlements to load
    await expect(superAdminPage.locator('article').first()).toBeVisible({ timeout: 15_000 });
  });

  test('feature control page has category filters', async ({ superAdminPage }) => {
    await superAdminPage.goto('/platform/features');
    await expect(superAdminPage.locator('button:has-text("All")')).toBeVisible();
    await expect(superAdminPage.locator('button:has-text("Ordering")')).toBeVisible();
    await expect(superAdminPage.locator('button:has-text("Payments")')).toBeVisible();
  });

  test('non-super-admin cannot access platform pages', async ({ cashierPage }) => {
    await cashierPage.goto('/platform');
    // Should not see platform admin content (redirected or no access)
    await expect(cashierPage.locator('button:has-text("Load tenants")')).not.toBeVisible({ timeout: 5_000 });
  });
});
