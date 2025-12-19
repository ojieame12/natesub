import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import dotenv from 'dotenv';

// Read from default .env or .env.local
dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * Playwright E2E Configuration
 * ============================
 *
 * This config automatically starts both backend and frontend servers.
 * Backend runs in PAYMENTS_MODE=stub so E2E tests don't need real Stripe/Paystack.
 *
 * Run tests:
 *   npx playwright test              # All browsers
 *   npx playwright test --project=chromium  # Chrome only (faster)
 *   npx playwright test --ui         # Interactive UI mode
 *
 * First time setup:
 *   npx playwright install           # Install browsers
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  timeout: 60 * 1000, // 60s per test
  expect: {
    timeout: 10 * 1000, // 10s for assertions
  },
  use: {
    baseURL: process.env.APP_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment for full browser coverage (slower)
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
  ],
  // Start both backend and frontend before tests
  webServer: [
    {
      // Backend API server with stubbed payments
      command: 'cd backend && PAYMENTS_MODE=stub NODE_ENV=test npm start',
      url: 'http://localhost:3001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Frontend dev server
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
  ],
});
