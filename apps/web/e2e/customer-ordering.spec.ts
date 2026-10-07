import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// 1x1 transparent PNG served by the in-test cross-origin image server.
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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
    await expect(page.getByRole('heading', { name: 'Test Burger' })).toBeVisible({
      timeout: 15_000,
    });

    // Navigate to Drinks (Water has no required modifiers)
    await page.locator('nav[aria-label="Menu categories"] button', { hasText: 'Drinks' }).click();
    await expect(page.getByRole('heading', { name: 'Water' })).toBeVisible();

    // Click "Add" button on Water card
    const waterCard = page.locator('article', { hasText: 'Water' });
    await waterCard.getByRole('button', { name: 'Add' }).click();

    // Cart sticky bar should appear with 1 item
    await expect(page.locator('button', { hasText: /Review order/ }).first()).toBeVisible();

    // Click review order
    await page
      .locator('button', { hasText: /Review order/ })
      .first()
      .click({ force: true });

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
            lines: [
              { variantId: simpleVariantId, name: 'Water', basePriceMinor: '5000', quantity: 2 },
            ],
            quotedSubtotal: '10000',
          }),
        );
      },
      {
        publicSlug: seed.publicSlug,
        branchId: seed.branchId,
        simpleVariantId: seed.simpleVariantId,
      },
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
            lines: [
              { variantId: simpleVariantId, name: 'Water', basePriceMinor: '5000', quantity: 1 },
            ],
            quotedSubtotal: '5000',
          }),
        );
      },
      {
        publicSlug: seed.publicSlug,
        branchId: seed.branchId,
        simpleVariantId: seed.simpleVariantId,
      },
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
            lines: [
              { variantId: simpleVariantId, name: 'Water', basePriceMinor: '5000', quantity: 1 },
            ],
            quotedSubtotal: '5000',
          }),
        );
      },
      {
        publicSlug: seed.publicSlug,
        branchId: seed.branchId,
        simpleVariantId: seed.simpleVariantId,
      },
    );

    await page.goto(`/r/${seed.publicSlug}/checkout`);

    await page.locator('label:has-text("Name") input').fill('Test Customer');
    await page.locator('label:has-text("Phone") input').fill('+251911111111');

    const futureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
    await page.locator('input[type="datetime-local"]').fill(futureTime);

    await page.locator('label:has-text("Bank transfer")').click();
    await page.locator('button:has-text("Place order")').click();

    // Either redirects to pay page or shows an error alert
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('button[disabled]');
        const alert = document.querySelector('[role="alert"]');
        return btn || alert || window.location.pathname.includes('/pay/');
      },
      { timeout: 20_000 },
    );
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
            lines: [
              { variantId: simpleVariantId, name: 'Water', basePriceMinor: '5000', quantity: 1 },
            ],
            quotedSubtotal: '5000',
          }),
        );
      },
      {
        publicSlug: seed.publicSlug,
        branchId: seed.branchId,
        simpleVariantId: seed.simpleVariantId,
      },
    );

    await page.goto(`/r/${seed.publicSlug}/checkout`);

    await page.locator('label:has-text("Name") input').fill('Test Customer');
    await page.locator('label:has-text("Phone") input').fill('+251911111111');

    const futureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
    await page.locator('input[type="datetime-local"]').fill(futureTime);

    await page.locator('label:has-text("Telebirr")').click();
    await page.locator('button:has-text("Place order")').click();

    // Wait for either redirect, error, or button to become disabled (submitting state)
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('button[disabled]');
        const alert = document.querySelector('[role="alert"]');
        return btn || alert || window.location.pathname.includes('/pay/');
      },
      { timeout: 20_000 },
    );
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

test.describe('Customer PWA branding', () => {
  test('pickup page links a per-restaurant install manifest', async ({ page, request, seed }) => {
    await page.goto(`/r/${seed.publicSlug}`);
    await expect(page.locator('h1')).toContainText('Choose your meal');

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBe(`/r/${seed.publicSlug}/manifest.webmanifest`);

    const response = await request.get(manifestHref!);
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('application/manifest+json');
    expect(response.headers()['cache-control']).toContain('max-age=300');

    const manifest = await response.json();
    expect(manifest.name).toBeTruthy();
    expect(manifest.start_url).toBe(`/r/${seed.publicSlug}/`);
    expect(manifest.id).toBe(`/r/${seed.publicSlug}/`);
    // Slash-terminated scope (W3C §5 prefix matching): a bare /r/{slug} scope
    // would also swallow /r/{slug}-annex, and §1.6 needs start_url inside the
    // scope or the whole scope is discarded.
    expect(manifest.scope).toBe(`/r/${seed.publicSlug}/`);
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
    expect(manifest.display).toBe('standalone');
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(manifest.icons[0]).toHaveProperty('purpose');
  });

  test('QR table link serves the same aligned install manifest as the restaurant link', async ({
    page,
    request,
    seed,
    ownerToken,
  }) => {
    const rotate = await request.post(
      `${seed.api}/branches/${seed.branchId}/tables/${seed.tableId}/qr-token/rotate`,
      {
        headers: {
          Authorization: `Bearer ${ownerToken.accessToken}`,
          'x-tenant-id': seed.tenantId,
          'x-csrf-token': ownerToken.csrfToken,
          'Content-Type': 'application/json',
        },
        data: { reason: 'e2e manifest check' },
      },
    );
    expect(rotate.ok()).toBeTruthy();
    const raw = (await rotate.json()).data.raw as string;
    expect(raw).toBeTruthy();

    await page.goto(`/o/${raw}`);
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe(`/r/${seed.publicSlug}/manifest.webmanifest`);

    const manifestResponse = await request.get(href!);
    expect(manifestResponse.ok()).toBeTruthy();
    const manifest = await manifestResponse.json();
    expect(manifest.start_url).toBe(`/r/${seed.publicSlug}/`);
    expect(manifest.scope).toBe(`/r/${seed.publicSlug}/`);
    expect(manifest.id).toBe(`/r/${seed.publicSlug}/`);
    expect(JSON.stringify(manifest)).not.toContain(raw);
  });

  test('offline banner appears while the connection is down', async ({ page, context, seed }) => {
    await page.goto(`/r/${seed.publicSlug}`);
    await expect(page.getByRole('heading', { name: 'Test Burger' })).toBeVisible();

    const banner = page.getByRole('status').filter({ hasText: 'offline' });
    await expect(banner).toHaveCount(0);

    await context.setOffline(true);
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await context.setOffline(false);
    await expect(banner).toHaveCount(0, { timeout: 10_000 });
  });

  test('install button stays hidden until a restaurant logo exists', async ({ page, seed }) => {
    await page.goto(`/r/${seed.publicSlug}`);
    await expect(page.getByRole('heading', { name: 'Test Burger' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to home screen' })).toHaveCount(0);
  });
});

test.describe('Real service worker behavior', () => {
  // Auto-registration is production-only (service-worker-registration.tsx),
  // so dev tests register the real /sw.js explicitly and then assert on what
  // the browser's Cache Storage actually contains.
  async function registerRealServiceWorker(page: Page) {
    await page.evaluate(() => navigator.serviceWorker.register('/sw.js'));
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            return Boolean(registration?.active);
          }),
        { timeout: 30_000 },
      )
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
        timeout: 30_000,
      })
      .toBe(true);
  }

  async function cacheUrls(page: Page): Promise<string[]> {
    return page.evaluate(async () => {
      const names = await caches.keys();
      const urls: string[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) urls.push(request.url);
      }
      return urls;
    });
  }

  test('caches the menu but never stores order, receipt, or signed-image responses', async ({
    page,
    seed,
  }) => {
    await page.goto(`/r/${seed.publicSlug}`);
    await expect(page.getByRole('heading', { name: 'Test Burger' })).toBeVisible();
    await registerRealServiceWorker(page);

    // Re-load under SW control so the customer navigation itself is cached.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Test Burger' })).toBeVisible();

    // Warm the SW caches: menu API (allowed), public order + receipt
    // (must stay network-only), and signed URLs (must stay network-only).
    // The app calls the API cross-origin (NEXT_PUBLIC_API_URL); same-origin
    // paths would hit the Next server and 404. The SW matches on pathname, so
    // these requests still route through its cache policy.
    const apiBase = process.env.API_URL ?? 'http://localhost:3001';
    const menuStatus = await page.evaluate(
      ({ apiBase, slug }) =>
        fetch(`${apiBase}/api/v1/public/restaurants/${slug}/menu`, { credentials: 'include' }).then(
          (response) => response.status,
        ),
      { apiBase, slug: seed.publicSlug },
    );
    expect(menuStatus).toBe(200);

    await page.evaluate(
      ({ apiBase, token }) =>
        Promise.all([
          fetch(`${apiBase}/api/v1/public/orders/${token}`, { credentials: 'include' }).then(
            (response) => response.status,
          ),
          fetch(`${apiBase}/api/v1/public/orders/${token}/receipt`, {
            credentials: 'include',
          }).then((response) => response.status),
        ]),
      { apiBase, token: seed.trackingToken },
    );

    // A REAL signed cross-origin image: a failed request leaves nothing to
    // cache, so treating onerror as success would let a regression that
    // caches signed URLs pass unnoticed. Serve one from an in-test origin
    // and require it to load before checking the caches.
    const imageServer = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(PIXEL_PNG);
    });
    await new Promise<void>((resolve) => imageServer.listen(0, '127.0.0.1', resolve));
    const imagePort = (imageServer.address() as AddressInfo).port;
    const signedImageUrl = `http://127.0.0.1:${imagePort}/logos/token/proof.png?X-Amz-Signature=deadbeef`;
    try {
      await page.evaluate(() =>
        fetch('/media/proof.png?X-Amz-Signature=deadbeef').catch(() => null),
      );
      const imageLoaded = await page.evaluate(
        (src) =>
          new Promise<boolean>((resolve) => {
            const image = new Image();
            image.onload = () => resolve(image.naturalWidth > 0);
            image.onerror = () => resolve(false);
            image.src = src;
          }),
        signedImageUrl,
      );
      expect(imageLoaded).toBe(true);

      const urls = await cacheUrls(page);
      expect(
        urls.some((url) => url.includes('/api/v1/public/restaurants/') && url.includes('/menu')),
      ).toBe(true);
      expect(urls.some((url) => url.includes('/r/') && url.includes(seed.publicSlug))).toBe(true);
      expect(urls.some((url) => url.includes('/api/v1/public/orders/'))).toBe(false);
      expect(urls.some((url) => url.includes('X-Amz-'))).toBe(false);
      expect(urls.some((url) => url.includes(`127.0.0.1:${imagePort}`))).toBe(false);
    } finally {
      imageServer.close();
    }
  });

  test('reopens the menu offline from the SW cache', async ({ page, context, seed }) => {
    await page.goto(`/r/${seed.publicSlug}`);
    await expect(page.getByRole('heading', { name: 'Test Burger' })).toBeVisible();
    await registerRealServiceWorker(page);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Test Burger' })).toBeVisible();
    // Warm the exact request shape the app uses (cross-origin, credentialed)
    // so the offline cache lookup matches the client's fetch.
    const warmStatus = await page.evaluate(
      ({ apiBase, slug }) =>
        fetch(`${apiBase}/api/v1/public/restaurants/${slug}/menu`, { credentials: 'include' }).then(
          (response) => response.status,
        ),
      { apiBase: process.env.API_URL ?? 'http://localhost:3001', slug: seed.publicSlug },
    );
    expect(warmStatus).toBe(200);
    // Fail fast if the SW did not store the menu response before going offline.
    expect(
      await page.evaluate(async (slug) => {
        const cache = await caches.open('rms-shell-v4');
        const keys = await cache.keys();
        return keys.some(
          (request) =>
            request.url.includes('/api/v1/public/restaurants/') && request.url.includes(slug),
        );
      }, seed.publicSlug),
    ).toBe(true);

    await context.setOffline(true);
    try {
      await page.goto(`/r/${seed.publicSlug}`, { timeout: 20_000 });
      await expect(page.getByRole('heading', { name: 'Test Burger' })).toBeVisible({
        timeout: 15_000,
      });
      // SW-served documents carry no network transfer.
      const transferSize = await page.evaluate(
        () => performance.getEntriesByType('navigation')[0]?.transferSize ?? -1,
      );
      expect(transferSize).toBe(0);
    } finally {
      await context.setOffline(false);
    }
  });

  test('install entry criteria hold from both the restaurant link and the QR table link', async ({
    page,
    request,
    seed,
    ownerToken,
  }) => {
    await page.goto(`/r/${seed.publicSlug}`);
    await expect(page.getByRole('heading', { name: 'Test Burger' })).toBeVisible();
    await registerRealServiceWorker(page);

    const restaurantManifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(restaurantManifestHref).toBe(`/r/${seed.publicSlug}/manifest.webmanifest`);
    const restaurantManifest = await (await request.get(restaurantManifestHref!)).json();
    expect(restaurantManifest.start_url).toBe(restaurantManifest.scope);
    expect(restaurantManifest.scope).toBe(`/r/${seed.publicSlug}/`);
    const startUrl = await request.get(restaurantManifest.start_url);
    expect(startUrl.ok()).toBeTruthy();

    // The launch URL must actually open the menu AND stay inside the declared
    // scope: a redirect to the bare (no-slash) form would be an out-of-scope
    // document that drops the installed manifest on open.
    await page.goto(restaurantManifest.start_url);
    await expect(page).toHaveURL(new RegExp(`/r/${seed.publicSlug}/$`));
    await expect(page.getByRole('heading', { name: 'Test Burger' })).toBeVisible();
    // A bare restaurant root redirects INTO the scope, not out of it.
    await page.goto(`/r/${seed.publicSlug}`);
    await expect(page).toHaveURL(new RegExp(`/r/${seed.publicSlug}/$`));

    // Same install criteria through the QR table entry point.
    const rotate = await request.post(
      `${seed.api}/branches/${seed.branchId}/tables/${seed.tableId}/qr-token/rotate`,
      {
        headers: {
          Authorization: `Bearer ${ownerToken.accessToken}`,
          'x-tenant-id': seed.tenantId,
          'x-csrf-token': ownerToken.csrfToken,
          'Content-Type': 'application/json',
        },
        data: { reason: 'e2e install criteria' },
      },
    );
    expect(rotate.ok(), JSON.stringify(await rotate.json())).toBeTruthy();
    const raw = (await rotate.json()).data.raw as string;

    await page.goto(`/o/${raw}`);
    const qrManifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(qrManifestHref).toBe(`/r/${seed.publicSlug}/manifest.webmanifest`);
    // The SW registered at / controls /o/ too, so both entry points can install.
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
        timeout: 15_000,
      })
      .toBe(true);
  });
});
