import { test, expect } from './fixtures';
import type { TokenBundle } from './fixtures';
import * as http from 'http';

const API = process.env.API_URL ?? 'http://localhost:3001/api/v1';

function httpPost(urlPath: string, headers: Record<string, string>, body?: unknown, method?: string): Promise<{ status: number; body: unknown }> {
  const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
  const url = new URL(API + urlPath);
  const httpMethod = method ?? (bodyStr !== undefined ? 'POST' : 'GET');
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: httpMethod,
      headers: {
        ...headers,
        ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr).toString() } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed: unknown = null;
        try { parsed = JSON.parse(data); } catch { /* non-JSON */ }
        resolve({ status: res.statusCode!, body: parsed });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function loginApi(email: string, password: string): Promise<TokenBundle> {
  const res = await httpPost('/auth/login', {}, { email, password });
  if (res.status !== 200) throw new Error(`Login failed: ${res.status}`);
  const body = res.body as { data: { accessToken: string; csrfToken?: string } };
  return { accessToken: body.data.accessToken, csrfToken: body.data.csrfToken ?? '' };
}

async function apiCall(path: string, token: TokenBundle, tenantId: string, options: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token.accessToken}`,
    'x-tenant-id': tenantId,
    'x-csrf-token': token.csrfToken,
  };
  return httpPost(path, headers, options.body, options.method);
}

async function createOrderViaApi(
  managerToken: TokenBundle,
  tenantId: string,
  branchId: string,
  variantId: string,
  modifierOptionIds: string[],
): Promise<{ orderId: string; orderNumber: number }> {
  const res = await apiCall(
    `/branches/${branchId}/orders`,
    managerToken,
    tenantId,
    {
      body: {
        lines: [{ variantId, quantity: 1, modifierOptionIds }],
        orderType: 'TAKEAWAY',
        idempotencyKey: `orders-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    },
  );
  if (res.status !== 201) throw new Error(`Order creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  const order = (res.body as any).data.order;
  return { orderId: order.id, orderNumber: order.orderNumber ?? order.number ?? 0 };
}

test.describe('Orders List Page', () => {
  test('cashier sees orders page with header', async ({ cashierPage }) => {
    await cashierPage.locator('aside nav a[href="/orders"]').first().click();
    await cashierPage.waitForURL((url) => url.pathname === '/orders', { timeout: 15_000 });
    await expect(cashierPage.locator('h1:has-text("Orders")')).toBeVisible({ timeout: 10000 });
  });

  test('orders page shows status filter buttons', async ({ cashierPage }) => {
    await cashierPage.locator('aside nav a[href="/orders"]').first().click();
    await cashierPage.waitForURL((url) => url.pathname === '/orders', { timeout: 15_000 });
    await expect(cashierPage.locator('button:has-text("All")')).toBeVisible({ timeout: 10000 });
    await expect(cashierPage.locator('button:has-text("Pending payment")')).toBeVisible();
    await expect(cashierPage.locator('button:has-text("Confirmed")')).toBeVisible();
  });

  test('orders page shows real orders from API', async ({ cashierPage, seed }) => {
    const managerToken = await loginApi(seed.manager.email, seed.manager.password);
    await createOrderViaApi(managerToken, seed.tenantId, seed.branchId, seed.variantId, seed.modifierOptionIds);

    await cashierPage.locator('aside nav a[href="/orders"]').first().click();
    await cashierPage.waitForURL((url) => url.pathname === '/orders', { timeout: 15_000 });

    // Should see at least one order card with order number
    const orderCards = cashierPage.locator('a[href^="/orders/"]');
    await expect(orderCards.first()).toBeVisible({ timeout: 10000 });
  });

  test('orders page shows empty state when no matching filter', async ({ cashierPage }) => {
    await cashierPage.locator('aside nav a[href="/orders"]').first().click();
    await cashierPage.waitForURL((url) => url.pathname === '/orders', { timeout: 15_000 });
    // Filter to a status that should have no orders
    await cashierPage.locator('button:has-text("Cancelled")').click();
    await expect(cashierPage.getByText('No orders', { exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('order card shows order number and amount', async ({ cashierPage, seed }) => {
    const managerToken = await loginApi(seed.manager.email, seed.manager.password);
    const { orderNumber } = await createOrderViaApi(managerToken, seed.tenantId, seed.branchId, seed.variantId, seed.modifierOptionIds);

    await cashierPage.locator('aside nav a[href="/orders"]').first().click();
    await cashierPage.waitForURL((url) => url.pathname === '/orders', { timeout: 15_000 });

    await expect(cashierPage.locator(`text=#${orderNumber}`).first()).toBeVisible({ timeout: 10000 });
    await expect(cashierPage.locator('text=ETB').first()).toBeVisible();
  });

  test('clicking order card navigates to detail page', async ({ cashierPage, seed }) => {
    const managerToken = await loginApi(seed.manager.email, seed.manager.password);
    const { orderNumber } = await createOrderViaApi(managerToken, seed.tenantId, seed.branchId, seed.variantId, seed.modifierOptionIds);

    await cashierPage.locator('aside nav a[href="/orders"]').first().click();
    await cashierPage.waitForURL((url) => url.pathname === '/orders', { timeout: 15_000 });

    // Click on the order card
    const orderCard = cashierPage.locator(`a[href^="/orders/"]`).filter({ hasText: `#${orderNumber}` });
    await orderCard.first().click();
    // Wait for client-side navigation to complete
    await cashierPage.waitForLoadState('networkidle', { timeout: 15_000 });
    await expect(cashierPage.locator('text=Order items')).toBeVisible({ timeout: 10000 });
  });

  test('New order button links to POS', async ({ cashierPage }) => {
    await cashierPage.locator('aside nav a[href="/orders"]').first().click();
    await cashierPage.waitForURL((url) => url.pathname === '/orders', { timeout: 15_000 });
    const newOrderBtn = cashierPage.locator('a:has-text("New order")');
    await expect(newOrderBtn).toBeVisible();
    await expect(newOrderBtn).toHaveAttribute('href', '/pos');
  });
});

test.describe('Order Detail Page', () => {
  test('shows order detail with items after navigation', async ({ cashierPage, seed }) => {
    const managerToken = await loginApi(seed.manager.email, seed.manager.password);
    const { orderNumber } = await createOrderViaApi(managerToken, seed.tenantId, seed.branchId, seed.variantId, seed.modifierOptionIds);

    await cashierPage.locator('aside nav a[href="/orders"]').first().click();
    await cashierPage.waitForURL((url) => url.pathname === '/orders', { timeout: 15_000 });

    const orderCard = cashierPage.locator(`a[href^="/orders/"]`).filter({ hasText: `#${orderNumber}` });
    await orderCard.first().click();
    await cashierPage.waitForURL((url) => url.pathname.startsWith('/orders/'), { timeout: 15_000 });

    // Detail page should show the order header and items
    await expect(cashierPage.locator('text=Order items')).toBeVisible({ timeout: 10000 });
    await expect(cashierPage.locator('text=ORDER STATUS')).toBeVisible();
  });

  test('shows order status on detail page', async ({ cashierPage, seed }) => {
    const managerToken = await loginApi(seed.manager.email, seed.manager.password);
    const { orderNumber } = await createOrderViaApi(managerToken, seed.tenantId, seed.branchId, seed.variantId, seed.modifierOptionIds);

    await cashierPage.locator('aside nav a[href="/orders"]').first().click();
    await cashierPage.waitForURL((url) => url.pathname === '/orders', { timeout: 15_000 });

    const orderCard = cashierPage.locator(`a[href^="/orders/"]`).filter({ hasText: `#${orderNumber}` });
    await orderCard.first().click();
    await cashierPage.waitForURL((url) => url.pathname.startsWith('/orders/'), { timeout: 15_000 });

    // Should show a status (CONFIRMED after outbox processes, or PENDING_PAYMENT before)
    const statusText = cashierPage.locator('text=/CONFIRMED|PENDING|IN PROGRESS/');
    await expect(statusText.first()).toBeVisible({ timeout: 10000 });
  });

  test('back link returns to orders list', async ({ cashierPage, seed }) => {
    const managerToken = await loginApi(seed.manager.email, seed.manager.password);
    const { orderNumber } = await createOrderViaApi(managerToken, seed.tenantId, seed.branchId, seed.variantId, seed.modifierOptionIds);

    await cashierPage.locator('aside nav a[href="/orders"]').first().click();
    await cashierPage.waitForURL((url) => url.pathname === '/orders', { timeout: 15_000 });

    const orderCard = cashierPage.locator(`a[href^="/orders/"]`).filter({ hasText: `#${orderNumber}` });
    await orderCard.first().click();
    await cashierPage.waitForURL((url) => url.pathname.startsWith('/orders/'), { timeout: 15_000 });

    const backLink = cashierPage.locator('a:has-text("All orders")');
    await expect(backLink).toBeVisible();
    await backLink.click();
    await cashierPage.waitForURL((url) => url.pathname === '/orders', { timeout: 15_000 });
  });

  test('shows total amount on detail page', async ({ cashierPage, seed }) => {
    const managerToken = await loginApi(seed.manager.email, seed.manager.password);
    const { orderNumber } = await createOrderViaApi(managerToken, seed.tenantId, seed.branchId, seed.variantId, seed.modifierOptionIds);

    await cashierPage.locator('aside nav a[href="/orders"]').first().click();
    await cashierPage.waitForURL((url) => url.pathname === '/orders', { timeout: 15_000 });

    const orderCard = cashierPage.locator(`a[href^="/orders/"]`).filter({ hasText: `#${orderNumber}` });
    await orderCard.first().click();
    await cashierPage.waitForURL((url) => url.pathname.startsWith('/orders/'), { timeout: 15_000 });

    // Total section should show ETB amount
    await expect(cashierPage.locator('text=Total').first()).toBeVisible({ timeout: 10000 });
    await expect(cashierPage.locator('text=ETB').first()).toBeVisible();
  });
});
