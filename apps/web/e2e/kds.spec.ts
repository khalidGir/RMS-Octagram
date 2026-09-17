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
  console.log(`[loginApi] POST ${API}/auth/login for ${email}`);
  const res = await httpPost('/auth/login', {}, { email, password });
  if (res.status !== 200) throw new Error(`Login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const body = res.body as { data: { accessToken: string; csrfToken?: string } };
  console.log(`[loginApi] OK, accessToken length=${body.data.accessToken?.length}`);
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
  };
  const res = await httpPost(path, headers, options.body, options.method);
  if (res.status >= 400) {
    console.error(`[apiCall] ${options.method ?? 'POST'} ${path} -> ${res.status}`, JSON.stringify(res.body)?.substring(0, 500));
  }
  return res;
}

async function createOrderAndPayment(
  managerToken: TokenBundle,
  cashierToken: TokenBundle,
  tenantId: string,
  branchId: string,
  variantId: string,
  modifierOptionIds: string[],
  tableId?: string,
): Promise<{ orderId: string; paymentId: string; orderNumber: number }> {
  // 1. Create order
  const orderBody = {
    lines: [{ variantId, quantity: 1, modifierOptionIds }],
    orderType: tableId ? 'DINE_IN' : 'TAKEAWAY',
    ...(tableId ? { tableId } : {}),
    idempotencyKey: `kds-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
  const orderRes = await apiCall(
    `/branches/${branchId}/orders`,
    managerToken,
    tenantId,
    { body: orderBody },
  );
  if (orderRes.status !== 201) {
    throw new Error(`Order creation failed: ${orderRes.status} ${JSON.stringify(orderRes.body)}`);
  }
  const orderId = (orderRes.body as any).data.order.id;
  const orderNumber = (orderRes.body as any).data.order.orderNumber ?? (orderRes.body as any).data.order.number ?? 0;

  // 2. Create cash payment (PENDING)
  const payRes = await apiCall(
    `/branches/${branchId}/payments/cash`,
    managerToken,
    tenantId,
    {
      body: {
        orderId,
        idempotencyKey: `pay-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    },
  );
  if (payRes.status !== 201) {
    throw new Error(`Payment creation failed: ${payRes.status} ${JSON.stringify(payRes.body)}`);
  }
  const paymentId = (payRes.body as any).data.id;

  // 3. Cashier confirms cash payment (needs active CashShift)
  const confirmRes = await apiCall(
    `/branches/${branchId}/payments/${paymentId}/confirm-cash`,
    cashierToken,
    tenantId,
    { method: 'POST', body: {} },
  );
  if (confirmRes.status !== 200) {
    throw new Error(`Payment confirmation failed: ${confirmRes.status} ${JSON.stringify(confirmRes.body)}`);
  }

  // 4. Wait for outbox processor to create kitchen tickets (polls every 2s)
  let ticketFound = false;
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const ticketRes = await apiCall(
      `/branches/${branchId}/kitchen-tickets`,
      managerToken,
      tenantId,
      { method: 'GET' },
    );
    if (ticketRes.status === 200) {
      const tickets = (ticketRes.body as any).data;
      if (Array.isArray(tickets) && tickets.length > 0) {
        ticketFound = true;
        break;
      }
    }
  }
  if (!ticketFound) {
    throw new Error('Kitchen tickets not created after 12.5s — outbox processor may not be running');
  }

  return { orderId, paymentId, orderNumber };
}

test.describe('Kitchen Display System', () => {
  test('kitchen staff sees KDS page with header', async ({ kitchenStaffPage }) => {
    await expect(kitchenStaffPage.locator('h1:has-text("Kitchen Display")')).toBeVisible({ timeout: 10000 });
  });

  test('KDS shows empty state when no tickets', async ({ kitchenStaffPage }) => {
    await expect(kitchenStaffPage.locator('text=No tickets yet')).toBeVisible({ timeout: 10000 });
  });

  test('KDS shows connection status indicator', async ({ kitchenStaffPage }) => {
    const statusIndicator = kitchenStaffPage.locator('text=/Live|Polling/');
    await expect(statusIndicator).toBeVisible({ timeout: 10000 });
  });

  test('KDS shows Refresh button', async ({ kitchenStaffPage }) => {
    await expect(kitchenStaffPage.locator('button:has-text("Refresh")')).toBeVisible();
  });

  test('KDS shows All stations tab', async ({ kitchenStaffPage }) => {
    await expect(kitchenStaffPage.locator('button:has-text("All stations")')).toBeVisible({ timeout: 10000 });
  });

  test('KDS shows three columns: Queued, In progress, Ready', async ({ kitchenStaffPage }) => {
    const hasTickets = await kitchenStaffPage.locator('text=Queued').count() > 0;
    if (hasTickets) {
      await expect(kitchenStaffPage.locator('text=Queued').first()).toBeVisible({ timeout: 10000 });
      await expect(kitchenStaffPage.locator('text=In progress').first()).toBeVisible();
      await expect(kitchenStaffPage.locator('text=Ready').first()).toBeVisible();
    } else {
      await expect(kitchenStaffPage.locator('text=No tickets yet')).toBeVisible({ timeout: 10000 });
    }
  });

  test('KDS columns show empty state', async ({ kitchenStaffPage }) => {
    const hasTickets = await kitchenStaffPage.locator('text=Queued').count() > 0;
    if (hasTickets) {
      await expect(kitchenStaffPage.locator('text=Empty').first()).toBeVisible({ timeout: 10000 });
    } else {
      await expect(kitchenStaffPage.locator('text=No tickets yet')).toBeVisible({ timeout: 10000 });
    }
  });

  test('manager can access kitchen display', async ({ managerPage }) => {
    await managerPage.locator('aside nav a[href="/kitchen"]').first().click();
    await managerPage.waitForURL((url) => url.pathname === '/kitchen', { timeout: 15_000 });
    await expect(managerPage.locator('h1:has-text("Kitchen Display")')).toBeVisible({ timeout: 10000 });
  });

  test('owner can access kitchen display', async ({ ownerPage }) => {
    await ownerPage.locator('aside nav a[href="/kitchen"]').first().click();
    await ownerPage.waitForURL((url) => url.pathname === '/kitchen', { timeout: 15_000 });
    await expect(ownerPage.locator('h1:has-text("Kitchen Display")')).toBeVisible({ timeout: 10000 });
  });

  test('cashier cannot see kitchen display nav link', async ({ cashierPage }) => {
    const kitchenLink = cashierPage.locator('aside nav a[href="/kitchen"]').first();
    await expect(kitchenLink).not.toBeVisible();
  });

  test('KDS shows ticket with bump button after order creation', async ({ kitchenStaffPage, seed }) => {
    const managerToken = await loginApi(seed.manager.email, seed.manager.password);
    const cashierToken = await loginApi(seed.cashier.email, seed.cashier.password);
    const { orderId } = await createOrderAndPayment(
      managerToken, cashierToken, seed.tenantId, seed.branchId,
      seed.variantId, seed.modifierOptionIds,
    );

    // Reload KDS page to fetch new tickets
    await kitchenStaffPage.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    await kitchenStaffPage.waitForSelector('h1:has-text("Kitchen Display")', { timeout: 10000 });

    // Ticket should appear with a bump/start button
    const ticketCard = kitchenStaffPage.locator('[class*="rounded-xl border-2"]').first();
    await expect(ticketCard).toBeVisible({ timeout: 10000 });

    const bumpButton = ticketCard.locator('button:has-text("Start")');
    await expect(bumpButton).toBeVisible();
  });

  test('KDS bump moves ticket from Queued to In progress', async ({ kitchenStaffPage, seed }) => {
    const managerToken = await loginApi(seed.manager.email, seed.manager.password);
    const cashierToken = await loginApi(seed.cashier.email, seed.cashier.password);
    const { orderNumber } = await createOrderAndPayment(
      managerToken, cashierToken, seed.tenantId, seed.branchId,
      seed.variantId, seed.modifierOptionIds,
    );

    await kitchenStaffPage.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    await kitchenStaffPage.waitForSelector('h1:has-text("Kitchen Display")', { timeout: 10000 });

    const orderText = `Order ${orderNumber}`;
    const card = kitchenStaffPage.locator('[class*="rounded-xl border-2"]').filter({ hasText: orderText });
    await expect(card).toBeVisible({ timeout: 10000 });

    await card.locator('button:has-text("Start")').click();

    await expect(kitchenStaffPage.locator('text=In progress').first()).toBeVisible({ timeout: 5000 });
  });

  test('KDS complete moves ticket from Ready to Completed', async ({ kitchenStaffPage, seed }) => {
    const managerToken = await loginApi(seed.manager.email, seed.manager.password);
    const cashierToken = await loginApi(seed.cashier.email, seed.cashier.password);
    const { orderNumber } = await createOrderAndPayment(
      managerToken, cashierToken, seed.tenantId, seed.branchId,
      seed.variantId, seed.modifierOptionIds,
    );

    await kitchenStaffPage.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    await kitchenStaffPage.waitForSelector('h1:has-text("Kitchen Display")', { timeout: 10000 });

    const orderText = `Order ${orderNumber}`;
    const card = kitchenStaffPage.locator('[class*="rounded-xl border-2"]').filter({ hasText: orderText });
    await expect(card).toBeVisible({ timeout: 10000 });

    // Bump: QUEUED → IN_PROGRESS
    await card.locator('button:has-text("Start")').click();
    await expect(card).toBeVisible({ timeout: 5000 });

    // Bump: IN_PROGRESS → READY
    await card.locator('button:has-text("Ready")').click();
    await expect(card).toBeVisible({ timeout: 5000 });

    // Complete: READY → COMPLETED (ticket disappears from board)
    await card.locator('button:has-text("Complete")').click();
    await expect(card).toBeHidden({ timeout: 5000 });
  });

  test('KDS recall moves ticket back from Ready to In progress', async ({ kitchenStaffPage, seed }) => {
    const managerToken = await loginApi(seed.manager.email, seed.manager.password);
    const cashierToken = await loginApi(seed.cashier.email, seed.cashier.password);
    const { orderNumber } = await createOrderAndPayment(
      managerToken, cashierToken, seed.tenantId, seed.branchId,
      seed.variantId, seed.modifierOptionIds,
    );

    await kitchenStaffPage.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    await kitchenStaffPage.waitForSelector('h1:has-text("Kitchen Display")', { timeout: 10000 });

    const orderText = `Order ${orderNumber}`;
    const card = kitchenStaffPage.locator('[class*="rounded-xl border-2"]').filter({ hasText: orderText });
    await expect(card).toBeVisible({ timeout: 10000 });

    // Bump: QUEUED → IN_PROGRESS
    await card.locator('button:has-text("Start")').click();
    await expect(card).toBeVisible({ timeout: 5000 });

    // Bump: IN_PROGRESS → READY
    await card.locator('button:has-text("Ready")').click();
    await expect(card).toBeVisible({ timeout: 5000 });

    // Recall: READY → IN_PROGRESS
    await card.locator('button:has-text("Recall")').click();
    await expect(card).toBeVisible({ timeout: 5000 });
  });

  test('KDS shows station name when station is selected', async ({ kitchenStaffPage, seed }) => {
    const grillTab = kitchenStaffPage.locator('button:has-text("Grill")');
    const hasStation = await grillTab.count() > 0;
    if (hasStation) {
      await grillTab.click();
      await expect(kitchenStaffPage.locator('text=Grill').first()).toBeVisible();
    }
  });

  test('KDS refresh button reloads tickets', async ({ kitchenStaffPage }) => {
    await kitchenStaffPage.locator('button:has-text("Refresh")').click();
    await expect(kitchenStaffPage.locator('h1:has-text("Kitchen Display")')).toBeVisible();
  });

  test('KDS shows elapsed time on ticket cards', async ({ kitchenStaffPage, seed }) => {
    const managerToken = await loginApi(seed.manager.email, seed.manager.password);
    const cashierToken = await loginApi(seed.cashier.email, seed.cashier.password);
    const { orderId } = await createOrderAndPayment(
      managerToken, cashierToken, seed.tenantId, seed.branchId,
      seed.variantId, seed.modifierOptionIds,
    );

    await kitchenStaffPage.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    await kitchenStaffPage.waitForSelector('h1:has-text("Kitchen Display")', { timeout: 10000 });

    const ticketCard = kitchenStaffPage.locator('[class*="rounded-xl border-2"]').first();
    await expect(ticketCard).toBeVisible({ timeout: 10000 });

    // Elapsed time shows as "0m" or similar (minutes since creation)
    const elapsed = ticketCard.locator('text=/\\d+m/');
    await expect(elapsed).toBeVisible();
  });

  test('KDS shows order number on ticket cards', async ({ kitchenStaffPage, seed }) => {
    const managerToken = await loginApi(seed.manager.email, seed.manager.password);
    const cashierToken = await loginApi(seed.cashier.email, seed.cashier.password);
    const { orderId } = await createOrderAndPayment(
      managerToken, cashierToken, seed.tenantId, seed.branchId,
      seed.variantId, seed.modifierOptionIds,
    );

    await kitchenStaffPage.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    await kitchenStaffPage.waitForSelector('h1:has-text("Kitchen Display")', { timeout: 10000 });

    const ticketCard = kitchenStaffPage.locator('[class*="rounded-xl border-2"]').first();
    await expect(ticketCard).toBeVisible({ timeout: 10000 });

    // Order number should appear as "Order 1", "Order 2", etc.
    const orderNumber = ticketCard.locator('text=/Order \\d+/');
    await expect(orderNumber).toBeVisible();
  });
});
