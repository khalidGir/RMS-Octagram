import { test, expect } from './fixtures';

test.describe('Phone-first login form', () => {
  test('uses a tel input and exposes no email field', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    const phoneInput = page.locator('input[type="tel"]');
    await expect(phoneInput).toBeVisible();
    await expect(phoneInput).toHaveAttribute('autocomplete', 'tel');
    await expect(phoneInput).toHaveAttribute('inputmode', 'tel');
    await expect(phoneInput).toHaveAttribute('placeholder', '0911 234 567');

    await expect(page.locator('input[type="password"]')).toHaveAttribute('autocomplete', 'current-password');
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
    await expect(page.getByText(/email/i)).toHaveCount(0);
  });

  test('shows platform branding, not the old brand name', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    await expect(page.getByText('RestaurantMS').first()).toBeVisible();
    await expect(page.getByText('Buna House')).toHaveCount(0);
  });

  test('rejects an invalid phone client-side with an inline message', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="tel"]').fill('12345');
    await page.locator('input[type="password"]').fill('whatever');
    await page.getByRole('button', { name: /sign in to rms/i }).click();
    await expect(page.getByText(/enter a valid ethiopian mobile number/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('signs in with keyboard only', async ({ page, seed }) => {
    await page.goto('/login');
    const phoneInput = page.locator('input[type="tel"]');
    await phoneInput.focus();
    await phoneInput.fill(seed.owner.phone);
    await page.keyboard.press('Tab');
    await page.keyboard.type(seed.owner.password);
    await page.keyboard.press('Enter');
    await page.waitForURL((url) => url.pathname === '/dashboard', { timeout: 15_000 });
    await expect(page.locator('aside nav')).toBeVisible();
  });

  test('seeded owner signs in through the real UI', async ({ page, seed }) => {
    await page.goto('/login');
    await page.locator('input[type="tel"]').fill(seed.owner.phone);
    await page.locator('input[type="password"]').fill(seed.owner.password);
    await page.getByRole('button', { name: /sign in to rms/i }).click();
    await page.waitForURL((url) => url.pathname === '/dashboard', { timeout: 15_000 });
    await expect(page.locator('aside nav')).toBeVisible();
  });
});

test.describe('Phone-first team invitation', () => {
  test('invite dialog collects a phone number and shows no email field', async ({ managerPage }) => {
    await managerPage.goto('/team');
    await managerPage.waitForURL((url) => url.pathname === '/team', { timeout: 15_000 });
    await managerPage.getByRole('button', { name: /invite member/i }).click({ timeout: 15_000 });

    const dialog = managerPage.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const phoneInput = dialog.locator('input[type="tel"]');
    await expect(phoneInput).toBeVisible();
    await expect(phoneInput).toHaveAttribute('placeholder', '0911 234 567');
    await expect(dialog.locator('input[type="email"]')).toHaveCount(0);
    await expect(dialog.getByText(/email/i)).toHaveCount(0);
  });

  test('invite form validates the phone before sending', async ({ managerPage }) => {
    await managerPage.goto('/team');
    await managerPage.waitForURL((url) => url.pathname === '/team', { timeout: 15_000 });
    await managerPage.getByRole('button', { name: /invite member/i }).click({ timeout: 15_000 });

    const dialog = managerPage.getByRole('dialog');
    await dialog.locator('input[type="tel"]').fill('123');
    await dialog.getByRole('button', { name: /send invitation/i }).click();
    await expect(dialog.getByText(/enter a valid ethiopian mobile number/i)).toBeVisible();
    // Dialog stays open — nothing was sent
    await expect(dialog).toBeVisible();
  });
});
