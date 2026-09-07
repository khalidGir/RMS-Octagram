import { test as base, expect } from '@playwright/test';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import type { SeedData } from './global-setup';

const SEED_FILE = path.join(__dirname, '.playwright-seed.json');
const API = process.env.API_URL ?? 'http://localhost:3001/api/v1';

function loadSeed(): SeedData {
  if (!fs.existsSync(SEED_FILE)) throw new Error('Seed file not found. Run global-setup first.');
  return JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8'));
}

export interface TokenBundle {
  accessToken: string;
  csrfToken: string;
}

interface TestFixtures {
  seed: SeedData;
  ownerPage: import('@playwright/test').Page;
  managerPage: import('@playwright/test').Page;
  cashierPage: import('@playwright/test').Page;
  kitchenStaffPage: import('@playwright/test').Page;
  managerToken: TokenBundle;
  ownerToken: TokenBundle;
  cashierToken: TokenBundle;
}

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

async function apiLogin(email: string, password: string): Promise<TokenBundle> {
  const res = await httpPost('/auth/login', {}, { email, password });
  if (res.status !== 200) throw new Error(`Login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const body = res.body as { data: { accessToken: string; csrfToken?: string } };
  return { accessToken: body.data.accessToken, csrfToken: body.data.csrfToken ?? '' };
}

async function apiRefresh(refreshToken: string): Promise<TokenBundle> {
  const res = await httpPost('/auth/refresh', { Cookie: `refresh_token=${refreshToken}` }, {});
  if (res.status !== 200) throw new Error(`Refresh failed: ${res.status} ${JSON.stringify(res.body)}`);
  const body = res.body as { data: { accessToken: string; csrfToken?: string } };
  return { accessToken: body.data.accessToken, csrfToken: body.data.csrfToken ?? '' };
}

async function setupAuthRoute(page: import('@playwright/test').Page, tokens: TokenBundle) {
  await page.route('**/auth/refresh', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { accessToken: tokens.accessToken, csrfToken: tokens.csrfToken } }),
    });
  });
  await page.route('**/auth/me', async (route) => {
    const meRes = await httpPost('/auth/me', { Authorization: `Bearer ${tokens.accessToken}` });
    await route.fulfill({
      status: meRes.status,
      contentType: 'application/json',
      body: JSON.stringify(meRes.body),
    });
  });
}

async function getProfile(token: string): Promise<{ landing: string; role: string; tenantId: string; branchId: string }> {
  const meRes = await httpPost('/auth/me', { Authorization: `Bearer ${token}` });
  if (meRes.status !== 200) throw new Error(`Auth/me failed: ${meRes.status} ${JSON.stringify(meRes.body)}`);
  const profile = (meRes.body as { data: { platformRole: string | null; memberships: Array<{ role: string; tenant: { id: string }; branchAssignments: Array<{ branch: { id: string; isActive: boolean } }> }> } }).data;
  let landing = '/dashboard';
  if (profile.platformRole === 'SUPER_ADMIN') landing = '/platform';
  else {
    const role = profile.memberships[0]?.role;
    if (role === 'KITCHEN_STAFF') landing = '/kitchen';
    else if (role === 'WAITER') landing = '/waiter';
    else if (role === 'CASHIER') landing = '/pos';
  }
  const membership = profile.memberships[0];
  const activeBranch = membership?.branchAssignments.find((a) => a.branch.isActive)?.branch;
  return {
    landing,
    role: membership?.role ?? 'OWNER',
    tenantId: membership?.tenant.id ?? '',
    branchId: activeBranch?.id ?? '',
  };
}

async function loginViaUI(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
): Promise<void> {
  const tokens = await apiLogin(email, password);
  const profile = await getProfile(tokens.accessToken);

  await setupAuthRoute(page, tokens);

  await page.goto(profile.landing, { timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  await page.locator('aside nav').first().waitFor({ state: 'visible', timeout: 30_000 });
}

async function loginAndCaptureToken(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
): Promise<TokenBundle> {
  const tokens = await apiLogin(email, password);
  const profile = await getProfile(tokens.accessToken);

  await setupAuthRoute(page, tokens);

  await page.goto(profile.landing, { timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  await page.locator('aside nav').first().waitFor({ state: 'visible', timeout: 30_000 });

  return tokens;
}

async function clientNavigate(page: import('@playwright/test').Page, href: string): Promise<void> {
  await page.evaluate((url) => {
    const a = document.createElement('a');
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, href);
  await page.waitForURL(`**${href}`, { timeout: 15_000 });
}

export const test = base.extend<TestFixtures>({
  seed: async ({}, use) => {
    await use(loadSeed());
  },
  managerToken: async ({ browser, seed }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const tokens = await loginAndCaptureToken(page, seed.manager.email, seed.manager.password);
    await use(tokens);
    await context.close();
  },
  ownerToken: async ({ browser, seed }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const tokens = await loginAndCaptureToken(page, seed.owner.email, seed.owner.password);
    await use(tokens);
    await context.close();
  },
  cashierToken: async ({ browser, seed }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const tokens = await loginAndCaptureToken(page, seed.cashier.email, seed.cashier.password);
    await use(tokens);
    await context.close();
  },
  ownerPage: async ({ browser, seed }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginViaUI(page, seed.owner.email, seed.owner.password);
    await page.waitForURL((url) => url.pathname === '/dashboard', { timeout: 15_000 });
    await page.locator('aside nav a[href="/payments"]').first().click();
    await page.waitForURL((url) => url.pathname === '/payments', { timeout: 15_000 });
    await use(page);
    await context.close();
  },
  managerPage: async ({ browser, seed }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginViaUI(page, seed.manager.email, seed.manager.password);
    await page.waitForURL((url) => url.pathname === '/dashboard', { timeout: 15_000 });
    await use(page);
    await context.close();
  },
  cashierPage: async ({ browser, seed }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginViaUI(page, seed.cashier.email, seed.cashier.password);
    await page.waitForURL('**/pos', { timeout: 15_000 });
    await use(page);
    await context.close();
  },
  kitchenStaffPage: async ({ browser, seed }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginViaUI(page, seed.kitchenStaff.email, seed.kitchenStaff.password);
    await page.waitForURL((url) => url.pathname.includes('/kitchen'), { timeout: 15_000 });
    await use(page);
    await context.close();
  },
});

export { expect, clientNavigate };
