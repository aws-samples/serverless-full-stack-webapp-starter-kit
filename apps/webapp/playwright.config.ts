import { defineConfig, devices } from '@playwright/test';

const requiredEnvironmentVariables = [
  'E2E_BASE_URL',
  'E2E_USER_POOL_ID',
  'E2E_AWS_REGION',
  'E2E_USER_A_EMAIL',
  'E2E_USER_A_PASSWORD',
  'E2E_USER_B_EMAIL',
  'E2E_USER_B_PASSWORD',
] as const;

for (const name of requiredEnvironmentVariables) {
  if (!process.env[name]) {
    throw new Error(`Missing required E2E environment variable: ${name}`);
  }
}

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error('Missing required E2E environment variable: E2E_BASE_URL');
}

export default defineConfig({
  testDir: './e2e/tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results',
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],
  // Every spec is written to be count-independent (unique titles + card-scoped locators),
  // so multiple specs can safely mutate the same shared User A concurrently.
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testDir: './e2e', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
});
