/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    testTimeout: 60000,
    deps: {
      optimizer: {
        ssr: {
          include: ['supertest'],
        },
      },
    },
  },
});
