import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src/tests/e2e',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { trace: 'retain-on-failure' },
});
