import { test, expect, clientNavigate } from './fixtures';

test.describe('Menu Management', () => {
  test('Manager can view menu page', async ({ managerPage }) => {
    await clientNavigate(managerPage, '/menu');
    await expect(managerPage.getByRole('heading', { name: /menu management/i })).toBeVisible();
  });

  test('Manager can see add button and categories section', async ({ managerPage }) => {
    await clientNavigate(managerPage, '/menu');
    await expect(managerPage.getByRole('button', { name: /add menu item/i })).toBeVisible();
    await expect(managerPage.getByText(/categories/i).first()).toBeVisible();
  });
});

test.describe('Tables Management', () => {
  test('Manager can view tables page', async ({ managerPage }) => {
    await clientNavigate(managerPage, '/tables');
    await expect(managerPage.getByRole('heading', { name: /tables/i })).toBeVisible();
  });

  test('Manager can see tables tabs', async ({ managerPage }) => {
    await clientNavigate(managerPage, '/tables');
    await managerPage.waitForLoadState('networkidle');
    await expect(managerPage.getByRole('tab', { name: /tables/i }).first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Team Management', () => {
  test('Manager can view team page', async ({ managerPage }) => {
    await clientNavigate(managerPage, '/team');
    await expect(managerPage.getByRole('heading', { name: /team/i })).toBeVisible();
  });

  test('Manager can see team tabs', async ({ managerPage }) => {
    await clientNavigate(managerPage, '/team');
    await managerPage.waitForLoadState('networkidle');
    await expect(managerPage.getByRole('tab', { name: /team/i }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('Manager can open invite dialog', async ({ managerPage }) => {
    await clientNavigate(managerPage, '/team');
    await managerPage.waitForLoadState('networkidle');
    await managerPage.getByRole('button', { name: /invite member/i }).click({ timeout: 15_000 });
    await expect(managerPage.getByRole('dialog')).toBeVisible();
    await expect(managerPage.getByText(/email address/i)).toBeVisible();
  });
});

test.describe('Settings Management', () => {
  test('Manager can view settings page', async ({ managerPage }) => {
    await clientNavigate(managerPage, '/settings');
    await expect(managerPage.getByRole('heading', { name: /branding/i })).toBeVisible();
  });

  test('Manager can see restaurant identity section', async ({ managerPage }) => {
    await clientNavigate(managerPage, '/settings');
    await managerPage.waitForLoadState('networkidle');
    await expect(managerPage.getByText('Restaurant identity')).toBeVisible({ timeout: 15_000 });
  });

  test('Manager can see feature flags section', async ({ managerPage }) => {
    await clientNavigate(managerPage, '/settings');
    await managerPage.waitForLoadState('networkidle');
    await expect(managerPage.getByText('Feature flags')).toBeVisible({ timeout: 15_000 });
  });
});
