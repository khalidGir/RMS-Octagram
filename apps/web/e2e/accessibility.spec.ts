import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';

function getViolations(results: Awaited<ReturnType<AxeBuilder['analyze']>>, impact: 'critical' | 'serious') {
  return results.violations.filter((v) => v.impact === impact);
}

test.describe('Accessibility — Public Pages', () => {
  test('login page has no critical violations', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(getViolations(results, 'critical')).toEqual([]);
  });

  test('landing page has no critical violations', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(getViolations(results, 'critical')).toEqual([]);
  });

  test('public menu page has no critical violations', async ({ page, seed }) => {
    await page.goto(`/r/${seed.publicSlug}`);
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(getViolations(results, 'critical')).toEqual([]);
  });
});

test.describe('Accessibility — Staff Pages', () => {
  test('POS page has no critical violations', async ({ cashierPage }) => {
    await expect(cashierPage.locator('h1')).toContainText('New order', { timeout: 15_000 });
    const results = await new AxeBuilder({ page: cashierPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(getViolations(results, 'critical')).toEqual([]);
  });

  test('orders list page has no critical violations', async ({ cashierPage }) => {
    await cashierPage.locator('aside nav a[href="/orders"]').first().click();
    await cashierPage.waitForURL((url) => url.pathname === '/orders', { timeout: 15_000 });
    await expect(cashierPage.locator('h1')).toContainText('Orders', { timeout: 10_000 });
    const results = await new AxeBuilder({ page: cashierPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(getViolations(results, 'critical')).toEqual([]);
  });

  test('dashboard page has no critical violations', async ({ managerPage }) => {
    await managerPage.locator('main').first().waitFor({ state: 'visible', timeout: 15_000 });
    const results = await new AxeBuilder({ page: managerPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(getViolations(results, 'critical')).toEqual([]);
  });

  test('KDS page has no critical violations', async ({ kitchenStaffPage }) => {
    await kitchenStaffPage.locator('h1, h2, h3, [role="heading"]').first().waitFor({ timeout: 10_000 });
    const results = await new AxeBuilder({ page: kitchenStaffPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(getViolations(results, 'critical')).toEqual([]);
  });

  test('settings page has no critical violations', async ({ managerPage }) => {
    await managerPage.goto('/settings');
    await managerPage.waitForURL((url) => url.pathname === '/settings', { timeout: 15_000 });
    await expect(managerPage.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 });
    const results = await new AxeBuilder({ page: managerPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(getViolations(results, 'critical')).toEqual([]);
  });

  test('team management page has no critical violations', async ({ managerPage }) => {
    await managerPage.goto('/team');
    await managerPage.waitForURL((url) => url.pathname === '/team', { timeout: 15_000 });
    await expect(managerPage.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 });
    const results = await new AxeBuilder({ page: managerPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(getViolations(results, 'critical')).toEqual([]);
  });

  test('inventory page has no critical violations', async ({ managerPage }) => {
    await managerPage.goto('/inventory');
    await managerPage.waitForURL((url) => url.pathname === '/inventory', { timeout: 15_000 });
    await expect(managerPage.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 });
    const results = await new AxeBuilder({ page: managerPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(getViolations(results, 'critical')).toEqual([]);
  });

  test('reports page has no critical violations', async ({ managerPage }) => {
    await managerPage.goto('/reports');
    await managerPage.waitForURL((url) => url.pathname === '/reports', { timeout: 15_000 });
    await managerPage.locator('main').first().waitFor({ state: 'visible', timeout: 10_000 });
    const results = await new AxeBuilder({ page: managerPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(getViolations(results, 'critical')).toEqual([]);
  });
});
