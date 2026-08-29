import { test as base, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import type { SeedData } from './global-setup';

const SEED_FILE = path.join(__dirname, '.playwright-seed.json');

function loadSeed(): SeedData {
  if (!fs.existsSync(SEED_FILE)) throw new Error('Seed file not found. Run global-setup first.');
  return JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8'));
}

interface TestFixtures {
  seed: SeedData;
  ownerPage: import('@playwright/test').Page;
  managerPage: import('@playwright/test').Page;
  cashierPage: import('@playwright/test').Page;
}

async function loginViaUI(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
  waitForAuthMe = true,
): Promise<void> {
  await page.goto('/login');
  await page.waitForSelector('input[type="email"]', { timeout: 10_000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  if (waitForAuthMe) {
    await page.waitForResponse((r) => r.url().includes('/auth/me') && r.status() === 200, { timeout: 15_000 });
  }
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
  ownerPage: async ({ browser, seed }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginViaUI(page, seed.owner.email, seed.owner.password);
    await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 });
    await page.locator('nav a[href="/payments"]').click();
    await page.waitForURL((url) => url.pathname === '/payments', { timeout: 15_000 });
    await use(page);
    await context.close();
  },
  managerPage: async ({ browser, seed }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginViaUI(page, seed.manager.email, seed.manager.password);
    await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 });
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
});

export { expect, clientNavigate };
