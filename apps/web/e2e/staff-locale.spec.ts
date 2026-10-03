import { test, expect } from './fixtures';
import { localeNames } from '../src/locales/types';
import { common as enCommon } from '../src/locales/en/common';
import { navigation as enNavigation } from '../src/locales/en/navigation';
import { navigation as amNavigation } from '../src/locales/am/navigation';
import { navigation as arNavigation } from '../src/locales/ar/navigation';

test.describe('Localization — staff account menu', () => {
  test('switching to Amharic from the account menu applies to the dashboard shell and persists across reload', async ({ managerPage: page }) => {
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('link', { name: enNavigation.navOverview }).first()).toBeVisible();

    await page.getByRole('button', { name: enNavigation.myAccount }).click();
    await page.getByRole('combobox', { name: enCommon.language }).click();
    await page.getByRole('option', { name: localeNames.am, exact: true }).click();
    await page.keyboard.press('Escape');

    await expect(page.locator('html')).toHaveAttribute('lang', 'am');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('link', { name: amNavigation.navOverview }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: amNavigation.myAccount })).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    await expect(page.locator('html')).toHaveAttribute('lang', 'am', { timeout: 15_000 });
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('link', { name: amNavigation.navOverview }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: amNavigation.myAccount })).toBeVisible();
  });

  test('switching to Arabic from the account menu sets dir=rtl on the staff dashboard', async ({ managerPage: page }) => {
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.getByRole('button', { name: enNavigation.myAccount }).click();
    await page.getByRole('combobox', { name: enCommon.language }).click();
    await page.getByRole('option', { name: localeNames.ar, exact: true }).click();
    await page.keyboard.press('Escape');

    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('link', { name: arNavigation.navOverview }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: arNavigation.myAccount })).toBeVisible();
    await expect(page.getByRole('button', { name: enNavigation.myAccount })).not.toBeVisible();
  });
});
