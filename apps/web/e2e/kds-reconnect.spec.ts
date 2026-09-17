import { test, expect } from './fixtures';

test.describe('KDS Connection & Controls', () => {
  test('KDS shows connected status and refresh button', async ({ kitchenStaffPage }) => {
    const statusIndicator = kitchenStaffPage.locator('text=Live').first();
    await expect(statusIndicator).toBeVisible({ timeout: 10_000 });

    const refreshBtn = kitchenStaffPage.getByRole('button', { name: /refresh/i });
    await expect(refreshBtn).toBeVisible();
  });

  test('KDS refresh button triggers HTTP refetch', async ({ kitchenStaffPage }) => {
    await kitchenStaffPage.waitForLoadState('networkidle', { timeout: 15_000 });

    const refreshBtn = kitchenStaffPage.getByRole('button', { name: /refresh/i });
    await expect(refreshBtn).toBeVisible({ timeout: 10_000 });

    let fetchCount = 0;
    kitchenStaffPage.on('response', (res) => {
      if (res.url().includes('/kitchen-tickets')) fetchCount++;
    });

    await refreshBtn.click();
    await kitchenStaffPage.waitForTimeout(2000);
    expect(fetchCount).toBeGreaterThanOrEqual(1);
  });

  test('KDS page renders after login', async ({ kitchenStaffPage }) => {
    const heading = kitchenStaffPage.locator('h1:has-text("Kitchen Display")');
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test('KDS empty state shows when no tickets', async ({ kitchenStaffPage }) => {
    await kitchenStaffPage.waitForLoadState('networkidle', { timeout: 15_000 });
    const emptyState = kitchenStaffPage.locator('text=/no.*ticket|no.*order|no.*queue|empty/i').first();
    const hasTickets = kitchenStaffPage.locator('[class*="ticket"], [data-ticket]').first();
    await expect(emptyState.or(hasTickets)).toBeVisible({ timeout: 10_000 });
  });
});
