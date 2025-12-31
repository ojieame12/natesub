import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read from default .env or .env.local
dotenv.config({ path: resolve(__dirname, '.env') });

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
 *
 * SERVER STARTUP & RELIABILITY NOTES:
 * -----------------------------------
 * - Backend uses /health/live for startup check (no DB dependency)
 * - This avoids Neon serverless cold-start delays during test setup
 * - Tests that need DB will naturally warm it on first API call
 * - If tests fail due to DB timeouts, try running again (cold-start issue)
 * - For more reliable E2E, consider using a local Postgres instead of Neon
 *
 * KNOWN LIMITATIONS:
 * - Heavy route stubbing in fixtures.ts means tests validate UI, not full E2E
 * - See e2e/fixtures.ts and e2e/auth.helper.ts for the UI Smoke vs Integration split
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Serial execution to avoid Neon connection pool exhaustion
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to prevent Neon transaction timeouts
  reporter: process.env.CI ? 'github' : 'html',
  timeout: 60 * 1000, // 60s per test
  expect: {
    timeout: 10 * 1000, // 10s for assertions
  },
  // Clean up all E2E test data after suite completes
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    // Always prefer local dev server for E2E unless explicitly overridden.
    // NOTE: APP_URL is a backend/runtime setting and may point at production.
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  // Projects: chromium always, webkit/mobile-safari only in CI
  // This allows local dev without installing all browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // WebKit/Safari - CI only (requires: npx playwright install webkit)
    ...(process.env.CI ? [{
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    }] : []),
    // Mobile Safari - CI only (requires: npx playwright install webkit)
    ...(process.env.CI ? [{
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
    }] : []),
    // Firefox - CI only (requires: npx playwright install firefox)
    ...(process.env.CI ? [{
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    }] : []),
  ],
  // Start both backend and frontend before tests
  webServer: [
    {
      // Backend API server with stubbed payments
      // Load .env for secrets, env config ensures PAYMENTS_MODE=stub
      command: 'cd backend && npx dotenv -e ../.env -- npm start',
      // Use /health/live (no DB check) for faster startup
      // This avoids Neon cold-start blocking test startup
      url: 'http://localhost:3001/health/live',
      reuseExistingServer: false, // Always start fresh for E2E tests
      timeout: 120 * 1000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PAYMENTS_MODE: 'stub',
        NODE_ENV: 'test',
        E2E_MODE: 'true', // Enable E2E testing endpoints
        E2E_API_KEY: 'e2e-local-dev-key', // Required for /e2e/* endpoints
        JOBS_API_KEY: 'test-jobs-api-key', // Required for /jobs/* endpoints
        HOST: '127.0.0.1',
        APP_URL: 'http://localhost:5173',
        API_URL: 'http://localhost:3001',
      },
    },
    {
      // Frontend dev server with local API URL override
      // Use env command to ensure VITE_API_URL is set before npm runs
      command: '/usr/bin/env VITE_API_URL=http://localhost:3001 npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: false, // Always start fresh for E2E tests
      timeout: 120 * 1000,
    },
  ],
});
