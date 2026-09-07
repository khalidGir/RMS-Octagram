import { test, expect } from './fixtures';
import { clientNavigate } from './fixtures';

const SNAPSHOT_DIR = 'e2e/snapshots';

test.describe('Visual Regression — Landing & Login', () => {
  test('landing page hero matches baseline', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot(`${SNAPSHOT_DIR}/landing-hero.png`, {
      fullPage: false,
      mask: [page.locator('[data-animate]')],
      maxDiffPixelRatio: 0.02,
    });
  });

  test('landing page full page matches baseline', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot(`${SNAPSHOT_DIR}/landing-full.png`, {
      fullPage: true,
      mask: [page.locator('[data-animate]')],
      maxDiffPixelRatio: 0.02,
    });
  });

  test('login page matches baseline', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot(`${SNAPSHOT_DIR}/login.png`, {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Visual Regression — Dashboard', () => {
  test('dashboard overview matches baseline', async ({ managerPage }) => {
    await expect(managerPage).toHaveScreenshot(`${SNAPSHOT_DIR}/dashboard.png`, {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Visual Regression — POS', () => {
  test('POS empty state matches baseline', async ({ cashierPage }) => {
    await expect(cashierPage).toHaveScreenshot(`${SNAPSHOT_DIR}/pos-empty.png`, {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Visual Regression — Orders', () => {
  test('orders list matches baseline', async ({ cashierPage }) => {
    await clientNavigate(cashierPage, '/orders');
    await cashierPage.waitForLoadState('networkidle');
    await expect(cashierPage).toHaveScreenshot(`${SNAPSHOT_DIR}/orders-list.png`, {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Visual Regression — KDS', () => {
  test('KDS empty state matches baseline', async ({ kitchenStaffPage }) => {
    await kitchenStaffPage.locator('h1, h2, h3, [role="heading"]').first().waitFor({ timeout: 10_000 });
    await kitchenStaffPage.waitForTimeout(500);
    await expect(kitchenStaffPage).toHaveScreenshot(`${SNAPSHOT_DIR}/kds-empty.png`, {
      fullPage: false,
      maxDiffPixelRatio: 0.15,
    });
  });
});

test.describe('Visual Regression — Payment Review', () => {
  test('payment review page matches baseline', async ({ ownerPage }) => {
    await expect(ownerPage).toHaveScreenshot(`${SNAPSHOT_DIR}/payment-review.png`, {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Visual Regression — Settings', () => {
  test('settings page matches baseline', async ({ managerPage }) => {
    await clientNavigate(managerPage, '/settings');
    await managerPage.waitForLoadState('networkidle');
    await expect(managerPage).toHaveScreenshot(`${SNAPSHOT_DIR}/settings.png`, {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Visual Regression — Menu Management', () => {
  test('menu management page matches baseline', async ({ managerPage }) => {
    await clientNavigate(managerPage, '/menu');
    await managerPage.waitForLoadState('networkidle');
    await expect(managerPage).toHaveScreenshot(`${SNAPSHOT_DIR}/menu-management.png`, {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Visual Regression — Team Management', () => {
  test('team management page matches baseline', async ({ managerPage }) => {
    await clientNavigate(managerPage, '/team');
    await managerPage.waitForLoadState('networkidle');
    await expect(managerPage).toHaveScreenshot(`${SNAPSHOT_DIR}/team-management.png`, {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Visual Regression — Tablet Viewports', () => {
  test('POS tablet portrait matches baseline', async ({ cashierPage }) => {
    await cashierPage.setViewportSize({ width: 768, height: 1024 });
    await expect(cashierPage).toHaveScreenshot(`${SNAPSHOT_DIR}/pos-tablet-portrait.png`, {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('KDS tablet landscape matches baseline', async ({ kitchenStaffPage }) => {
    await kitchenStaffPage.setViewportSize({ width: 1024, height: 768 });
    await kitchenStaffPage.locator('h1, h2, h3, [role="heading"]').first().waitFor({ timeout: 10_000 });
    await kitchenStaffPage.waitForTimeout(500);
    await expect(kitchenStaffPage).toHaveScreenshot(`${SNAPSHOT_DIR}/kds-tablet-landscape.png`, {
      fullPage: false,
      maxDiffPixelRatio: 0.15,
    });
  });
});
