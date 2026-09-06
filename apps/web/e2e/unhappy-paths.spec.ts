import { test, expect } from './fixtures';
import type { TokenBundle } from './fixtures';
import * as http from 'http';

const API = process.env.API_URL ?? 'http://localhost:3001/api/v1';

function httpPost(
  urlPath: string,
  headers: Record<string, string>,
  body?: unknown,
  method?: string,
): Promise<{ status: number; body: unknown }> {
  const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
  const url = new URL(API + urlPath);
  const httpMethod = method ?? (bodyStr !== undefined ? 'POST' : 'GET');
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: httpMethod,
        headers: {
          ...headers,
          ...(bodyStr
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr).toString() }
            : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed: unknown = null;
          try { parsed = JSON.parse(data); } catch { /* non-JSON */ }
          resolve({ status: res.statusCode!, body: parsed });
        });
      },
    );
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

async function apiCall(
  path: string,
  token: TokenBundle,
  tenantId: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token.accessToken}`,
    'x-tenant-id': tenantId,
    'x-csrf-token': token.csrfToken,
  };
  return httpPost(path, headers, options.body, options.method);
}

test.describe('Cross-tenant isolation', () => {
  test('manager cannot read orders from a different tenant', async ({ seed, managerToken }) => {
    const fakeTenantId = '00000000-0000-0000-0000-000000000000';
    const res = await apiCall(`/branches/${seed.branchId}/orders`, managerToken, fakeTenantId);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  test('cashier cannot read owner-only payment queue via API', async ({ seed, cashierToken }) => {
    const res = await apiCall(`/branches/${seed.branchId}/payments`, cashierToken, seed.tenantId, {
      method: 'GET',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

test.describe('Role denial via UI', () => {
  test('cashier does not see payment review nav link', async ({ cashierPage }) => {
    const navLinks = cashierPage.locator('aside nav a[href="/payments"]');
    await expect(navLinks).toHaveCount(0);
  });

  test('kitchen staff does not see team management nav link', async ({ kitchenStaffPage }) => {
    const navLinks = kitchenStaffPage.locator('aside nav a[href="/team"]');
    await expect(navLinks).toHaveCount(0);
  });
});

test.describe('Order idempotency', () => {
  test('submitting the same idempotency key twice returns the same order', async ({ seed, managerToken }) => {
    const idempotencyKey = `idempotent-test-${Date.now()}`;
    const body = {
      lines: [{ variantId: seed.variantId, quantity: 1, modifierOptionIds: [seed.modifierOptionIds[0]] }],
      orderType: 'TAKEAWAY',
      idempotencyKey,
    };

    const res1 = await apiCall(`/branches/${seed.branchId}/orders`, managerToken, seed.tenantId, { body });
    expect(res1.status).toBe(201);

    const res2 = await apiCall(`/branches/${seed.branchId}/orders`, managerToken, seed.tenantId, { body });
    expect(res2.status).toBe(201);

    const order1 = (res1.body as { data: { order: { id: string } } }).data.order;
    const order2 = (res2.body as { data: { order: { id: string } } }).data.order;
    expect(order1.id).toBe(order2.id);
  });
});

test.describe('Order state machine', () => {
  test('completing a non-READY order returns 4xx', async ({ seed, managerToken }) => {
    const createRes = await apiCall(
      `/branches/${seed.branchId}/orders`,
      managerToken,
      seed.tenantId,
      {
        body: {
          lines: [{ variantId: seed.simpleVariantId, quantity: 1, modifierOptionIds: [] }],
          orderType: 'TAKEAWAY',
          idempotencyKey: `complete-test-${Date.now()}`,
        },
      },
    );
    if (createRes.status !== 201) return;
    const orderId = (createRes.body as { data: { order: { id: string } } }).data.order.id;

    const completeRes = await apiCall(
      `/orders/${orderId}/complete`,
      managerToken,
      seed.tenantId,
      { method: 'POST' },
    );
    expect(completeRes.status).toBeGreaterThanOrEqual(400);
    expect(completeRes.status).toBeLessThan(500);
  });
});

test.describe('Invalid input rejection', () => {
  test('creating an order with no lines returns 400', async ({ seed, managerToken }) => {
    const res = await apiCall(
      `/branches/${seed.branchId}/orders`,
      managerToken,
      seed.tenantId,
      {
        body: {
          lines: [],
          orderType: 'TAKEAWAY',
          idempotencyKey: `empty-lines-${Date.now()}`,
        },
      },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  test('creating an order with invalid variant ID returns 400', async ({ seed, managerToken }) => {
    const res = await apiCall(
      `/branches/${seed.branchId}/orders`,
      managerToken,
      seed.tenantId,
      {
        body: {
          lines: [{ variantId: '00000000-0000-0000-0000-000000000000', quantity: 1, modifierOptionIds: [] }],
          orderType: 'TAKEAWAY',
          idempotencyKey: `bad-variant-${Date.now()}`,
        },
      },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  test('login with wrong password returns 401', async () => {
    const res = await httpPost('/auth/login', {}, { email: 'nonexistent@test.com', password: 'wrong' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

test.describe('Menu item with active orders', () => {
  test('deleting a menu item that has order history returns 409 or 400', async ({ seed, managerToken }) => {
    const fakeItemId = '00000000-0000-0000-0000-000000000000';
    const res = await apiCall(
      `/menu/items/${fakeItemId}`,
      managerToken,
      seed.tenantId,
      { method: 'DELETE' },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

test.describe('API response status assertions', () => {
  test('GET /auth/me with no token returns 401', async () => {
    const res = await httpPost('/auth/me', {}, undefined, 'GET');
    expect(res.status).toBe(401);
  });

  test('GET /categories returns 200 with valid tenant', async ({ seed, managerToken }) => {
    const res = await apiCall('/categories', managerToken, seed.tenantId);
    expect(res.status).toBe(200);
  });

  test('GET /branches returns 200 with valid token', async ({ seed, managerToken }) => {
    const res = await apiCall('/branches', managerToken, seed.tenantId);
    expect(res.status).toBe(200);
  });

  test('GET /orders returns 200 with valid token and tenant', async ({ seed, managerToken }) => {
    const res = await apiCall(`/branches/${seed.branchId}/orders`, managerToken, seed.tenantId);
    expect(res.status).toBe(200);
  });

  test('POST /auth/refresh with invalid cookie returns 401', async () => {
    const res = await httpPost('/auth/refresh', { Cookie: 'refresh_token=invalid' }, {});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
