/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    testTimeout: 60000,
    hookTimeout: 30000,
    fileParallelism: false,
    deps: {
      optimizer: {
        ssr: {
          include: ['supertest'],
        },
      },
    },
  },
});
