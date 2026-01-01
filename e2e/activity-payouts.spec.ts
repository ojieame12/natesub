import { test, expect } from '@playwright/test'
import { e2eLogin, setAuthCookie, deterministicEmail, buildUsername } from './auth.helper'

/**
 * Activity & Payouts E2E Tests
 *
 * Tests the activity feed and payout tracking APIs:
 * - Activity feed pagination
 * - Dashboard metrics (MRR, subscribers, balance)
 * - Balance refresh from provider
 * - Payout history
 *
 * Run with: npx playwright test activity-payouts.spec.ts
 */

const API_URL = 'http://localhost:3001'

// E2E API key for helper endpoints
const E2E_API_KEY = process.env.E2E_API_KEY
const e2eHeaders = () => ({
  'x-e2e-api-key': E2E_API_KEY || '',
  'Content-Type': 'application/json',
})

// ============================================
// HELPER: Setup creator with connected provider
// ============================================

async function setupCreator(
  request: import('@playwright/test').APIRequestContext,
  suffix: string,
  options?: { country?: string; countryCode?: string; currency?: string; provider?: string }
) {
  const ts = Date.now().toString().slice(-8)
  const email = `activity-${suffix}-${ts}@e2e.natepay.co`
  const username = buildUsername('act', suffix, ts)

  const country = options?.country || 'United States'
  const countryCode = options?.countryCode || 'US'
  const currency = options?.currency || 'USD'
  const provider = options?.provider || 'stripe'

  const { token, user } = await e2eLogin(request, email)

  const profileResp = await request.put(`${API_URL}/profile`, {
    data: {
      username,
      displayName: `Activity Test ${suffix}`,
      country,
      countryCode,
      currency,
      purpose: 'support',
      pricingModel: 'single',
      singleAmount: countryCode === 'NG' ? 5000 : 5,
      paymentProvider: provider,
      isPublic: true,
    },
    headers: { 'Authorization': `Bearer ${token}` },
  })

  if (profileResp.status() !== 200) {
    throw new Error(`Profile creation failed: ${await profileResp.text()}`)
  }

  // Connect provider
  if (provider === 'stripe') {
    await request.post(`${API_URL}/stripe/connect`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
  }

  return { token, userId: user.id, email, username }
}

// ============================================
// ACTIVITY FEED TESTS
// ============================================

test.describe('Activity Feed', () => {
  test('returns empty activity for new user', async ({ request }) => {
    const { token } = await setupCreator(request, 'empty')

    const response = await request.get(`${API_URL}/activity`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.activities).toBeDefined()
    expect(Array.isArray(data.activities)).toBe(true)
    // New user should have few or no activities
    expect(data.activities.length).toBeLessThanOrEqual(10)
  })

  test('activity feed respects pagination limit', async ({ request }) => {
    const { token } = await setupCreator(request, 'page')

    // Request with specific limit
    const response = await request.get(`${API_URL}/activity?limit=5`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.activities).toBeDefined()
    expect(data.activities.length).toBeLessThanOrEqual(5)
  })

  test('activity feed supports cursor pagination', async ({ request }) => {
    const { token } = await setupCreator(request, 'cursor')

    // First page
    const page1 = await request.get(`${API_URL}/activity?limit=2`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(page1.status()).toBe(200)
    const data1 = await page1.json()

    // If there's a nextCursor, fetch second page
    if (data1.nextCursor) {
      const page2 = await request.get(`${API_URL}/activity?limit=2&cursor=${data1.nextCursor}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      expect(page2.status()).toBe(200)
      const data2 = await page2.json()
      expect(data2.activities).toBeDefined()
    }
  })

  test('activity feed requires auth', async ({ request }) => {
    const response = await request.get(`${API_URL}/activity`)

    expect(response.status()).toBe(401)
  })
})

// ============================================
// DASHBOARD METRICS TESTS
// ============================================

test.describe('Dashboard Metrics', () => {
  test('returns metrics for new creator', async ({ request }) => {
    const { token } = await setupCreator(request, 'metrics')

    const response = await request.get(`${API_URL}/activity/metrics`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.metrics).toBeDefined()
    expect(data.metrics.subscriberCount).toBe(0)
    expect(data.metrics.mrrCents).toBe(0)
    expect(data.metrics.mrr).toBeDefined()
    expect(data.metrics.currency).toBe('USD')
    expect(data.metrics.balance).toBeDefined()
  })

  test('metrics include balance breakdown', async ({ request }) => {
    const { token } = await setupCreator(request, 'balance')

    const response = await request.get(`${API_URL}/activity/metrics`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    const balance = data.metrics.balance
    expect(balance).toBeDefined()
    expect(typeof balance.available).toBe('number')
    expect(typeof balance.pending).toBe('number')
    expect(balance.currency).toBeTruthy()
  })

  test('metrics returns tier breakdown', async ({ request }) => {
    const { token } = await setupCreator(request, 'tier')

    const response = await request.get(`${API_URL}/activity/metrics`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    // tierBreakdown should be an object (empty for new creator)
    expect(data.metrics.tierBreakdown).toBeDefined()
    expect(typeof data.metrics.tierBreakdown).toBe('object')
  })

  test('metrics include total revenue', async ({ request }) => {
    const { token } = await setupCreator(request, 'rev')

    const response = await request.get(`${API_URL}/activity/metrics`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(typeof data.metrics.totalRevenueCents).toBe('number')
    expect(data.metrics.totalRevenue).toBeDefined()
  })

  test('metrics with seeded subscription shows MRR', async ({ request }) => {
    const { token, username } = await setupCreator(request, 'mrr')

    // Seed a subscription via E2E endpoint
    const seedResp = await request.post(`${API_URL}/e2e/seed-subscription`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `subscriber-mrr-${Date.now()}@e2e.natepay.co`,
        amount: 1000, // $10.00
        currency: 'USD',
        interval: 'month',
      },
      headers: e2eHeaders(),
    })

    // STRICT: Subscription seeding must succeed (E2E endpoint is required)
    expect(seedResp.status(), 'Subscription seeding via /e2e/seed-subscription must succeed').toBe(200)

    // Check metrics now show MRR
    const metricsResp = await request.get(`${API_URL}/activity/metrics`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(metricsResp.status()).toBe(200)
    const data = await metricsResp.json()

    // STRICT: MRR should be > 0 if subscription was seeded
    expect(data.metrics.subscriberCount).toBeGreaterThanOrEqual(1)
    expect(data.metrics.mrrCents).toBeGreaterThanOrEqual(1000)
  })
})

// ============================================
// BALANCE REFRESH TESTS
// ============================================

test.describe('Balance Refresh', () => {
  test('refresh returns balance for connected creator', async ({ request }) => {
    const { token } = await setupCreator(request, 'refresh')

    const response = await request.post(`${API_URL}/activity/balance/refresh`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    // Should succeed or return error if provider not fully connected
    expect([200, 400]).toContain(response.status())

    if (response.status() === 200) {
      const data = await response.json()
      expect(data.balance).toBeDefined()
    }
  })

  test('refresh requires auth', async ({ request }) => {
    const response = await request.post(`${API_URL}/activity/balance/refresh`)

    expect(response.status()).toBe(401)
  })

  test('refresh returns error for user without provider', async ({ request }) => {
    // Create user without connecting provider
    const ts = Date.now().toString().slice(-8)
    const email = `no-provider-${ts}@e2e.natepay.co`

    const { token } = await e2eLogin(request, email)

    // Try refresh without profile
    const response = await request.post(`${API_URL}/activity/balance/refresh`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    // Should return 400 (no provider configured)
    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.error).toBeTruthy()
  })
})

// ============================================
// PAYOUT HISTORY TESTS
// ============================================

test.describe('Payout History', () => {
  test('returns empty payouts for new creator', async ({ request }) => {
    const { token } = await setupCreator(request, 'payout')

    const response = await request.get(`${API_URL}/activity/payouts`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.payouts).toBeDefined()
    expect(Array.isArray(data.payouts)).toBe(true)
    // New creator should have no payouts
    expect(data.payouts.length).toBe(0)
  })

  test('payouts include account health', async ({ request }) => {
    const { token } = await setupCreator(request, 'health')

    const response = await request.get(`${API_URL}/activity/payouts`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    // Should include account/balance info
    expect(data.balance || data.accountHealth).toBeDefined()
  })

  test('payouts requires auth', async ({ request }) => {
    const response = await request.get(`${API_URL}/activity/payouts`)

    expect(response.status()).toBe(401)
  })
})

// ============================================
// ACTIVITY BY ID TESTS
// ============================================

test.describe('Activity by ID', () => {
  test('returns 404 for non-existent activity', async ({ request }) => {
    const { token } = await setupCreator(request, 'notfound')

    const response = await request.get(`${API_URL}/activity/nonexistent-id-12345`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    // Should return 404 or activity not found
    expect([404, 400]).toContain(response.status())
  })
})

// ============================================
// CROSS-CURRENCY TESTS (NG Creator)
// ============================================

test.describe('Cross-Currency Metrics', () => {
  test('NG creator metrics show NGN currency', async ({ request }) => {
    const { token } = await setupCreator(request, 'ng', {
      country: 'Nigeria',
      countryCode: 'NG',
      currency: 'NGN',
      provider: 'stripe', // Cross-border Stripe
    })

    const response = await request.get(`${API_URL}/activity/metrics`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    // Currency should be NGN
    expect(data.metrics.currency).toBe('NGN')
  })

  test('FX rate provided when balance currency differs', async ({ request }) => {
    const { token } = await setupCreator(request, 'fx', {
      country: 'Nigeria',
      countryCode: 'NG',
      currency: 'NGN',
      provider: 'stripe',
    })

    const response = await request.get(`${API_URL}/activity/metrics`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    // fxRate may be null if currencies match, or a number if they differ
    expect(data.metrics.fxRate === null || typeof data.metrics.fxRate === 'number').toBe(true)
  })
})

// ============================================
// UI FLOW TESTS
// ============================================

test.describe('Dashboard UI', () => {
  test('dashboard page loads metrics', async ({ page, request }) => {
    const { token } = await setupCreator(request, 'dashui')
    await setAuthCookie(page, token)

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Dashboard should load (not error)
    const url = page.url()
    const hasDashboard = url.includes('dashboard')
    const hasOnboarding = url.includes('onboarding')

    // May redirect to onboarding if profile incomplete
    expect(hasDashboard || hasOnboarding).toBeTruthy()

    if (hasDashboard) {
      // Check for metrics display
      const content = await page.content()
      const hasMetrics =
        content.includes('subscriber') ||
        content.includes('Subscriber') ||
        content.includes('revenue') ||
        content.includes('Revenue') ||
        content.includes('earning') ||
        content.includes('Earning')

      expect(hasMetrics, 'Dashboard should show metrics').toBeTruthy()
    }
  })

  test('activity page shows feed', async ({ page, request }) => {
    const { token } = await setupCreator(request, 'actui')
    await setAuthCookie(page, token)

    // Try activity page (may be under /dashboard/activity or /activity)
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Activity should be accessible from dashboard or as separate page
    const activityLink = page.locator('a[href*="activity"]')
    if (await activityLink.first().isVisible().catch(() => false)) {
      await activityLink.first().click()
      await page.waitForLoadState('networkidle')

      // Should show activity content
      const content = await page.content()
      const hasActivity =
        content.toLowerCase().includes('activity') ||
        content.toLowerCase().includes('recent') ||
        content.toLowerCase().includes('event')

      expect(hasActivity).toBeTruthy()
    }
  })
})

// ============================================
// SEEDED DATA VALIDATION
// ============================================

test.describe('Seeded Data Validation', () => {
  test('seeded payment appears in metrics', async ({ request }) => {
    const { token, username } = await setupCreator(request, 'seeded')

    // Seed a payment (if endpoint exists)
    const seedResp = await request.post(`${API_URL}/e2e/seed-payment`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `sub-payment-${Date.now()}@e2e.natepay.co`,
        amountCents: 1500,
        currency: 'USD',
        status: 'succeeded',
      },
      headers: e2eHeaders(),
    })

    // STRICT: Payment seeding must succeed (E2E endpoint is required)
    expect(seedResp.status(), 'Payment seeding via /e2e/seed-payment must succeed').toBe(200)

    // Check metrics reflect the payment
    const metricsResp = await request.get(`${API_URL}/activity/metrics`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(metricsResp.status()).toBe(200)
    const data = await metricsResp.json()

    // Revenue reflects netCents (what creator receives after 4.5% fee)
    // 1500 - (1500 * 0.045) = 1433
    expect(data.metrics.totalRevenueCents).toBeGreaterThanOrEqual(1400)
  })

  test('seeded payout appears in history', async ({ request }) => {
    const { token, username } = await setupCreator(request, 'seedpay')

    // Seed a payout (if endpoint exists)
    const seedResp = await request.post(`${API_URL}/e2e/seed-payout`, {
      data: {
        creatorUsername: username,
        amountCents: 5000,
        currency: 'USD',
        status: 'paid',
      },
      headers: e2eHeaders(),
    })

    // STRICT: Payout seeding must succeed (E2E endpoint is required)
    expect(seedResp.status(), 'Payout seeding via /e2e/seed-payout must succeed').toBe(200)

    // Check payout history
    const payoutsResp = await request.get(`${API_URL}/activity/payouts`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(payoutsResp.status()).toBe(200)
    const data = await payoutsResp.json()

    // Should have at least one payout
    expect(data.payouts.length).toBeGreaterThanOrEqual(1)
  })
})
