import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { localeNames, type LocaleCode } from '../src/locales/types';
import { common as enCommon } from '../src/locales/en/common';
import { common as amCommon } from '../src/locales/am/common';
import { authentication as amAuthentication } from '../src/locales/am/authentication';
import { common as arCommon } from '../src/locales/ar/common';
import { ordering as amOrdering } from '../src/locales/am/ordering';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

function criticalViolations(results: Awaited<ReturnType<AxeBuilder['analyze']>>) {
  return results.violations.filter((v) => v.impact === 'critical');
}

async function pickLocale(page: Page, code: LocaleCode) {
  await page.getByRole('combobox', { name: enCommon.language }).click();
  await page.getByRole('option', { name: localeNames[code], exact: true }).click();
}

test.describe('Localization — locale switching', () => {
  test('Amharic applies immediately and persists across reload', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    await pickLocale(page, 'am');

    await expect(page.locator('html')).toHaveAttribute('lang', 'am');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('combobox', { name: amCommon.language })).toBeVisible();
    await expect(page.getByRole('button', { name: amAuthentication.signIn })).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'am', { timeout: 15_000 });
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('combobox', { name: amCommon.language })).toBeVisible();
  });

  test('Arabic sets dir=rtl and persists across reload', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    await pickLocale(page, 'ar');

    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('combobox', { name: arCommon.language })).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar', { timeout: 15_000 });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('combobox', { name: arCommon.language })).toBeVisible();
  });

  test('locale choice survives signing in', async ({ page, seed }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    await pickLocale(page, 'am');
    await expect(page.locator('html')).toHaveAttribute('lang', 'am');

    await page.locator('input[type="tel"]').fill(seed.owner.phone);
    await page.locator('input[type="password"]').fill(seed.owner.password);
    await page.getByRole('button', { name: amAuthentication.signIn }).click();

    await page.waitForURL((url) => url.pathname === '/dashboard', { timeout: 20_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'am');
    await expect(page.locator('aside nav').first()).toBeVisible();
  });

  test('locale and cart persist from menu to checkout without a page reload', async ({ page, seed }) => {
    await page.goto(`/r/${seed.publicSlug}`);
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    await expect(page.locator('h1')).toContainText('Choose your meal', { timeout: 15_000 });

    await pickLocale(page, 'am');
    await expect(page.locator('html')).toHaveAttribute('lang', 'am');
    await expect(page.locator('h1')).toContainText(amOrdering.chooseMeal);

    await page.locator(`nav[aria-label="${amOrdering.menuCategories}"] button`, { hasText: 'Drinks' }).click();
    await expect(page.getByRole('heading', { name: 'Water' })).toBeVisible();

    const waterCard = page.locator('article', { hasText: 'Water' });
    await waterCard.getByRole('button', { name: amOrdering.add, exact: true }).click();
    await expect(page.locator('div.fixed.inset-x-0.bottom-0 button')).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { __localizationMarker?: string }).__localizationMarker = 'alive';
    });
    await page.locator('div.fixed.inset-x-0.bottom-0 button').click();
    await page.waitForURL(`**/r/${seed.publicSlug}/checkout`, { timeout: 10_000 });

    const marker = await page.evaluate(
      () => (window as unknown as { __localizationMarker?: string }).__localizationMarker,
    );
    expect(marker).toBe('alive');

    await expect(page.locator('html')).toHaveAttribute('lang', 'am');
    await expect(page.locator('h1')).toContainText(amOrdering.reviewAndPay);

    const cartLineCount = await page.evaluate(() => {
      const raw = window.sessionStorage.getItem('rms-public-cart');
      return raw ? (JSON.parse(raw) as { lines: unknown[] }).lines.length : 0;
    });
    expect(cartLineCount).toBe(1);
    await expect(page.getByText(/Water/)).toBeVisible();
  });
});

test.describe('Localization — accessibility', () => {
  test('Arabic login page has no critical violations', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    await pickLocale(page, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(criticalViolations(results)).toEqual([]);
  });

  test('Amharic public menu has no critical violations', async ({ page, seed }) => {
    await page.goto(`/r/${seed.publicSlug}`);
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    await expect(page.locator('h1')).toContainText('Choose your meal', { timeout: 15_000 });

    await pickLocale(page, 'am');
    await expect(page.locator('h1')).toContainText(amOrdering.chooseMeal);

    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(criticalViolations(results)).toEqual([]);
  });

  test('open language picker has no critical violations', async ({ page, seed }) => {
    await page.goto(`/r/${seed.publicSlug}`);
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    await expect(page.locator('h1')).toContainText('Choose your meal', { timeout: 15_000 });

    await page.getByRole('combobox', { name: enCommon.language }).click();
    await expect(page.getByRole('listbox')).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(criticalViolations(results)).toEqual([]);
  });
});
