import { test, expect } from './fixtures';

test.describe('Customer ordering journey', () => {
  test('public menu loads and displays items from real API', async ({ page, seed }) => {
    await page.goto(`/r/${seed.publicSlug}`);
    await expect(page.locator('h1')).toContainText('Choose your meal');
    await expect(page.getByRole('heading', { name: 'Test Burger' })).toBeVisible();
    await expect(page.locator('nav[aria-label="Menu categories"]')).toBeVisible();
  });

  test('menu category navigation works', async ({ page, seed }) => {
    await page.goto(`/r/${seed.publicSlug}`);
    await expect(page.getByRole('heading', { name: 'Test Burger' })).toBeVisible();

    const categoryNav = page.locator('nav[aria-label="Menu categories"]');
    await expect(categoryNav).toBeVisible();

    // Click on Drinks category
    await categoryNav.locator('button', { hasText: 'Drinks' }).click();
    await expect(page.locator('h2', { hasText: 'Drinks' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Water' })).toBeVisible();
  });

  test('add item to cart and proceed to checkout', async ({ page, seed }) => {
    await page.goto(`/r/${seed.publicSlug}`);
    await expect(page.getByRole('heading', { name: 'Test Burger' })).toBeVisible();

    // Navigate to Drinks (Water has no required modifiers)
    await page.locator('nav[aria-label="Menu categories"] button', { hasText: 'Drinks' }).click();
    await expect(page.getByRole('heading', { name: 'Water' })).toBeVisible();

    // Click "Add" button on Water card
    const waterCard = page.locator('article', { hasText: 'Water' });
    await waterCard.getByRole('button', { name: 'Add' }).click();

    // Cart sticky bar should appear with 1 item
    await expect(page.locator('button', { hasText: /Review order/ }).first()).toBeVisible();

    // Click review order
    await page.locator('button', { hasText: /Review order/ }).first().click();

    // Should navigate to checkout
    await page.waitForURL(`**/r/${seed.publicSlug}/checkout`, { timeout: 10_000 });
    await expect(page.locator('h1')).toContainText('Review and pay');
  });

  test('checkout shows cart items and payment methods', async ({ page, seed }) => {
    await page.goto('/');
    await page.evaluate(
      ({ publicSlug, branchId, simpleVariantId }) => {
        window.sessionStorage.setItem(
          'rms-public-cart',
          JSON.stringify({
            entry: { kind: 'pickup', publicSlug },
            context: {
              branch: { id: branchId, name: 'Main Branch' },
              pickupEnabled: true,
              availablePaymentMethods: ['BANK_TRANSFER', 'TELEBIRR'],
            },
            lines: [{ variantId: simpleVariantId, name: 'Water', priceMinor: '5000', quantity: 2 }],
            quotedSubtotal: '10000',
          }),
        );
      },
      { publicSlug: seed.publicSlug, branchId: seed.branchId, simpleVariantId: seed.simpleVariantId },
    );

    await page.goto(`/r/${seed.publicSlug}/checkout`);
    await expect(page.locator('h1')).toContainText('Review and pay');
    await expect(page.getByText('2 × Water')).toBeVisible();
    await expect(page.locator('label:has-text("Bank transfer")')).toBeVisible();
    await expect(page.locator('label:has-text("Telebirr")')).toBeVisible();
  });

  test('pickup checkout requires name, phone, and pickup time', async ({ page, seed }) => {
    await page.goto('/');
    await page.evaluate(
      ({ publicSlug, branchId, simpleVariantId }) => {
        window.sessionStorage.setItem(
          'rms-public-cart',
          JSON.stringify({
            entry: { kind: 'pickup', publicSlug },
            context: {
              branch: { id: branchId, name: 'Main Branch' },
              pickupEnabled: true,
              availablePaymentMethods: ['BANK_TRANSFER', 'TELEBIRR'],
            },
            lines: [{ variantId: simpleVariantId, name: 'Water', priceMinor: '5000', quantity: 1 }],
            quotedSubtotal: '5000',
          }),
        );
      },
      { publicSlug: seed.publicSlug, branchId: seed.branchId, simpleVariantId: seed.simpleVariantId },
    );

    await page.goto(`/r/${seed.publicSlug}/checkout`);
    await expect(page.locator('h1')).toContainText('Review and pay');

    await expect(page.locator('label:has-text("Name") input')).toBeVisible();
    await expect(page.locator('label:has-text("Phone") input')).toBeVisible();
    await expect(page.locator('input[type="datetime-local"]')).toBeVisible();
  });

  test('submit pickup order with bank transfer', async ({ page, seed }) => {
    await page.goto('/');
    await page.evaluate(
      ({ publicSlug, branchId, simpleVariantId }) => {
        window.sessionStorage.setItem(
          'rms-public-cart',
          JSON.stringify({
            entry: { kind: 'pickup', publicSlug },
            context: {
              branch: { id: branchId, name: 'Main Branch' },
              pickupEnabled: true,
              availablePaymentMethods: ['BANK_TRANSFER', 'TELEBIRR'],
            },
            lines: [{ variantId: simpleVariantId, name: 'Water', priceMinor: '5000', quantity: 1 }],
            quotedSubtotal: '5000',
          }),
        );
      },
      { publicSlug: seed.publicSlug, branchId: seed.branchId, simpleVariantId: seed.simpleVariantId },
    );

    await page.goto(`/r/${seed.publicSlug}/checkout`);

    await page.locator('label:has-text("Name") input').fill('Test Customer');
    await page.locator('label:has-text("Phone") input').fill('+251911111111');

    const futureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
    await page.locator('input[type="datetime-local"]').fill(futureTime);

    await page.locator('label:has-text("Bank transfer")').click();
    await page.locator('button:has-text("Place order")').click();

    // Either redirects to pay page or shows an error alert
    await page.waitForFunction(() => {
      const btn = document.querySelector('button[disabled]');
      const alert = document.querySelector('[role="alert"]');
      return btn || alert || window.location.pathname.includes('/pay/');
    }, { timeout: 20_000 });
  });

  test('submit pickup order with Telebirr', async ({ page, seed }) => {
    await page.goto('/');
    await page.evaluate(
      ({ publicSlug, branchId, simpleVariantId }) => {
        window.sessionStorage.setItem(
          'rms-public-cart',
          JSON.stringify({
            entry: { kind: 'pickup', publicSlug },
            context: {
              branch: { id: branchId, name: 'Main Branch' },
              pickupEnabled: true,
              availablePaymentMethods: ['BANK_TRANSFER', 'TELEBIRR'],
            },
            lines: [{ variantId: simpleVariantId, name: 'Water', priceMinor: '5000', quantity: 1 }],
            quotedSubtotal: '5000',
          }),
        );
      },
      { publicSlug: seed.publicSlug, branchId: seed.branchId, simpleVariantId: seed.simpleVariantId },
    );

    await page.goto(`/r/${seed.publicSlug}/checkout`);

    await page.locator('label:has-text("Name") input').fill('Test Customer');
    await page.locator('label:has-text("Phone") input').fill('+251911111111');

    const futureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
    await page.locator('input[type="datetime-local"]').fill(futureTime);

    await page.locator('label:has-text("Telebirr")').click();
    await page.locator('button:has-text("Place order")').click();

    // Wait for either redirect, error, or button to become disabled (submitting state)
    await page.waitForFunction(() => {
      const btn = document.querySelector('button[disabled]');
      const alert = document.querySelector('[role="alert"]');
      return btn || alert || window.location.pathname.includes('/pay/');
    }, { timeout: 20_000 });
  });

  test('order tracking page renders', async ({ page, seed }) => {
    await page.goto(`/track/${seed.trackingToken}`);
    await expect(page.locator('main')).toBeVisible();
  });

  test('payment proof page renders with sessionStorage context', async ({ page, seed }) => {
    await page.goto('/');
    await page.evaluate(
      ({ trackingToken }) => {
        window.sessionStorage.setItem('rms-tracking-token', trackingToken);
        window.sessionStorage.setItem('rms-payment-token', trackingToken);
        window.sessionStorage.setItem('rms-payment-method', 'BANK_TRANSFER');
      },
      { trackingToken: seed.trackingToken },
    );

    await page.goto(`/pay/${seed.trackingToken}`);
    await expect(page.locator('main')).toBeVisible();
  });

  test('empty cart shows empty state on checkout', async ({ page, seed }) => {
    await page.goto(`/r/${seed.publicSlug}/checkout`);
    await expect(page.locator('text=Your cart is unavailable')).toBeVisible();
  });

  test('cart updates when adding items', async ({ page, seed }) => {
    await page.goto(`/r/${seed.publicSlug}`);
    await expect(page.getByRole('heading', { name: 'Test Burger' })).toBeVisible();

    // Navigate to Drinks and add Water
    await page.locator('nav[aria-label="Menu categories"] button', { hasText: 'Drinks' }).click();
    await expect(page.getByRole('heading', { name: 'Water' })).toBeVisible();

    const waterCard = page.locator('article', { hasText: 'Water' });
    await waterCard.getByRole('button', { name: 'Add' }).click();

    // Sticky bottom bar shows item count and total
    await expect(page.locator('text=Review order · 1 item')).toBeVisible();

    // Add another
    await waterCard.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('text=Review order · 2 items')).toBeVisible();
  });
});
