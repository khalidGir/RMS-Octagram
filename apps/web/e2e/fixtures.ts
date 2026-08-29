import { test as base, expect } from '@playwright/test';

const API_BASE = process.env.API_URL ?? 'http://localhost:3001/api/v1';
const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://rms:rms_dev@localhost:5432/rms_test?schema=public';

interface TestFixtures {
  apiBase: string;
  testDbUrl: string;
  ownerToken: string;
  cashierToken: string;
  tenantId: string;
  branchId: string;
}

export const test = base.extend<TestFixtures>({
  apiBase: async ({}, use) => {
    await use(API_BASE);
  },
  testDbUrl: async ({}, use) => {
    await use(TEST_DB_URL);
  },
  ownerToken: async ({}, use) => {
    await use(process.env.TEST_OWNER_TOKEN ?? '');
  },
  cashierToken: async ({}, use) => {
    await use(process.env.TEST_CASHIER_TOKEN ?? '');
  },
  tenantId: async ({}, use) => {
    await use(process.env.TEST_TENANT_ID ?? '');
  },
  branchId: async ({}, use) => {
    await use(process.env.TEST_BRANCH_ID ?? '');
  },
});

export { expect };

export async function loginAs(page: import('@playwright/test').Page, email: string, password: string): Promise<string> {
  const response = await page.request.post(`${API_BASE}/auth/login`, {
    data: { email, password },
  });
  const body = await response.json();
  return body.data.accessToken;
}

export async function setAuthContext(
  page: import('@playwright/test').Page,
  token: string,
  tenantId: string,
): Promise<void> {
  await page.evaluate(
    ({ token, tenantId }) => {
      window.sessionStorage.setItem('rms-access-token', token);
      window.sessionStorage.setItem('rms-tenant-id', tenantId);
    },
    { token, tenantId },
  );
}
