import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

export default defineConfig({
  ...baseConfig,
  testMatch: [
    // Shard 1 (already working)
    '**/activity-payouts.spec.ts',
    '**/analytics.spec.ts',
    '**/billing.spec.ts',
    
    // New Shard 2 (stable API tests only)
    '**/checkout.spec.ts',
    '**/profile.spec.ts',
    '**/onboarding.spec.ts',
    '**/requests-updates.spec.ts',
    '**/subscription-manage.spec.ts',
    '**/provider-connect.spec.ts',
  ],
  // Only 2 shards for core tests
  shard: undefined,
})
