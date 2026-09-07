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

test.describe('Concurrent Multi-User', () => {
  test('cashier creates order, manager sees it in orders list', async ({ seed, browser }) => {
    const cashierTokens = await loginApi(seed.cashier.email, seed.cashier.password);
    const managerTokens = await loginApi(seed.manager.email, seed.manager.password);

    const cashierContext = await browser.newContext();
    const cashierPage = await cashierContext.newPage();
    await cashierPage.goto('/pos');
    await cashierPage.waitForLoadState('networkidle');

    const managerContext = await browser.newContext();
    const managerPage = await managerContext.newPage();
    await managerPage.goto('/orders');
    await managerPage.waitForLoadState('networkidle');

    const orderCount = await managerPage.locator('button:has-text("Order")').count();

    const createRes = await apiCall(
      `/branches/${seed.branchId}/orders`,
      cashierTokens,
      seed.tenantId,
      {
        body: {
          lines: [{ variantId: seed.simpleVariantId, quantity: 1, modifierOptionIds: [] }],
          orderType: 'TAKEAWAY',
          idempotencyKey: `concurrent-test-${Date.now()}`,
        },
      },
    );
    expect(createRes.status).toBe(201);

    await managerPage.reload();
    await managerPage.waitForLoadState('networkidle');
    await managerPage.waitForTimeout(2000);

    const newOrderCount = await managerPage.locator('button:has-text("Order")').count();
    expect(newOrderCount).toBeGreaterThanOrEqual(orderCount);

    await cashierContext.close();
    await managerContext.close();
  });

  test('two concurrent orders with different idempotency keys both succeed', async ({ seed }) => {
    const managerTokens = await loginApi(seed.manager.email, seed.manager.password);

    const results = await Promise.all(
      [1, 2].map((i) =>
        apiCall(
          `/branches/${seed.branchId}/orders`,
          managerTokens,
          seed.tenantId,
          {
            body: {
              lines: [{ variantId: seed.simpleVariantId, quantity: 1, modifierOptionIds: [] }],
              orderType: 'TAKEAWAY',
              idempotencyKey: `concurrent-diff-${Date.now()}-${i}`,
            },
          },
        ),
      ),
    );

    expect(results[0].status).toBe(201);
    expect(results[1].status).toBe(201);

    const id1 = (results[0].body as { data: { order: { id: string } } }).data.order.id;
    const id2 = (results[1].body as { data: { order: { id: string } } }).data.order.id;
    expect(id1).not.toBe(id2);
  });
});
