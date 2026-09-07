import { defineConfig, devices } from '@playwright/test';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: require.resolve('./e2e/global-setup'),
  globalTeardown: require.resolve('./e2e/global-teardown'),
  use: {
    baseURL: FRONTEND_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'en-ET',
    timezoneId: 'Africa/Addis_Ababa',
    navigationTimeout: 30_000,
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'desktop-firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'desktop-webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'tablet-portrait',
      use: { ...devices['iPad (gen 7)'] },
    },
    {
      name: 'tablet-landscape',
      use: { ...devices['iPad (gen 7)'], viewport: { width: 1024, height: 768 } },
    },
    {
      name: 'large-phone',
      use: { viewport: { width: 430, height: 932 }, isMobile: true },
    },
    {
      name: 'laptop',
      use: { viewport: { width: 1366, height: 768 } },
    },
    {
      name: 'wide-display',
      use: { viewport: { width: 1920, height: 1080 } },
    },
  ],
  webServer: [
    {
      command: 'cd ../../apps/api && node dist/main.js',
      url: `${API_URL}/api/v1/auth/me`,
      reuseExistingServer: true,
      timeout: 30_000,
      env: {
        TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
        DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
        JWT_ACCESS_SECRET: 'test-access-secret',
        JWT_REFRESH_SECRET: 'test-refresh-secret',
        COOKIE_SAMESITE: 'none',
        S3_PROOF_BUCKET: 'test-bucket',
      },
    },
    {
      command: 'pnpm dev',
      url: FRONTEND_URL,
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        NEXT_PUBLIC_API_URL: `${API_URL}/api/v1`,
      },
    },
  ],
});
