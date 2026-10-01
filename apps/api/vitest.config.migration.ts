/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

const MIGRATION_TEST_DATABASE_URL =
  process.env.MIGRATION_TEST_DATABASE_URL ??
  'postgresql://rms:rms_dev@localhost:5432/rms_test_migration';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/migration/**/*.e2e-spec.ts'],
    testTimeout: 60000,
    hookTimeout: 180000,
    fileParallelism: false,
    globalSetup: ['test/migration/global-setup.ts'],
    env: {
      TEST_DATABASE_URL: MIGRATION_TEST_DATABASE_URL,
    },
    deps: {
      optimizer: {
        ssr: {
          include: ['supertest'],
        },
      },
    },
  },
});
