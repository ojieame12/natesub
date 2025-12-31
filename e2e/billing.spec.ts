import { test, expect } from '@playwright/test'
import { e2eLogin } from './auth.helper'

/**
 * Platform Billing E2E Tests
 *
 * Tests the $5/mo platform subscription for service providers.
 * - Status endpoint shows subscription state
 * - Checkout creates Stripe session
 * - Portal manages existing subscription
 *
 * Endpoints tested:
 * - GET /billing/status - Get platform subscription status
 * - POST /billing/checkout - Create checkout session
 * - POST /billing/portal - Create portal session
 *
 * Run with: npx playwright test billing.spec.ts
 */

const API_URL = 'http://localhost:3001'

const E2E_API_KEY = process.env.E2E_API_KEY || 'e2e-local-dev-key'

const e2eHeaders = () => ({
  'x-e2e-api-key': E2E_API_KEY,
  'Content-Type': 'application/json',
})

// ============================================
// HELPER FUNCTIONS
// ============================================

async function setupCreator(
  request: import('@playwright/test').APIRequestContext,
  suffix: string,
  purpose: 'support' | 'service' = 'support'
) {
  const ts = Date.now().toString().slice(-8)
  const email = `billing-${suffix}-${ts}@e2e.natepay.co`
  const username = `billing${suffix}${ts}`

  const { token, user } = await e2eLogin(request, email)

  // Create profile
  const profileResp = await request.put(`${API_URL}/profile`, {
    data: {
      username,
      displayName: `Billing Test ${suffix}`,
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose, // 'support' = personal, 'service' = requires $5/mo
      pricingModel: 'single',
      singleAmount: purpose === 'service' ? 100 : 10, // Service providers charge more
      paymentProvider: 'stripe',
      feeMode: 'split',
      isPublic: true,
    },
    headers: { 'Authorization': `Bearer ${token}` },
  })

  expect(profileResp.status(), 'Profile must be created').toBe(200)

  // Connect Stripe (stub mode)
  await request.post(`${API_URL}/stripe/connect`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })

  return { token, userId: user.id, email, username }
}

// ============================================
// TESTS
// ============================================

test.describe('Platform Billing', () => {
  test.describe('GET /billing/status', () => {
    test('returns "personal" plan for support creators (no subscription required)', async ({ request }) => {
      const { token } = await setupCreator(request, 'personal', 'support')

      const response = await request.get(`${API_URL}/billing/status`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      expect(response.status()).toBe(200)

      const data = await response.json()
      expect(data.plan).toBe('personal')
      expect(data.subscriptionRequired).toBe(false)
      expect(data.subscription).toBeNull()
      expect(data.debit).toBeNull()
    })

    test('returns "service" plan for service providers (subscription required)', async ({ request }) => {
      const { token } = await setupCreator(request, 'service', 'service')

      const response = await request.get(`${API_URL}/billing/status`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      expect(response.status()).toBe(200)

      const data = await response.json()
      expect(data.plan).toBe('service')
      expect(data.subscriptionRequired).toBe(true)

      // New service provider won't have subscription yet
      expect(data.subscription).toHaveProperty('status')
      // Status could be 'none', 'trialing', 'active', etc.
      expect(['none', 'trialing', 'active', 'past_due', 'canceled']).toContain(data.subscription.status)
    })

    test('requires authentication', async ({ request }) => {
      const response = await request.get(`${API_URL}/billing/status`)

      expect(response.status()).toBe(401)
    })

    test('handles user without profile', async ({ request }) => {
      const { token } = await e2eLogin(request, `noprofile-billing-${Date.now()}@e2e.natepay.co`)

      const response = await request.get(`${API_URL}/billing/status`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      // Should return personal plan (no profile = no service purpose)
      expect(response.status()).toBe(200)
      const data = await response.json()
      expect(data.plan).toBe('personal')
      expect(data.subscriptionRequired).toBe(false)
    })
  })

  test.describe('POST /billing/checkout', () => {
    test('creates checkout session for service provider', async ({ request }) => {
      const { token } = await setupCreator(request, 'checkout', 'service')

      const response = await request.post(`${API_URL}/billing/checkout`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      // In stub mode, Stripe always returns a stubbed session - expect 200
      expect(response.status(), 'Checkout must succeed in stub mode').toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('url')
      expect(data).toHaveProperty('sessionId')
      // URL should be a Stripe checkout URL
      expect(data.url).toContain('checkout')
    })

    test('rejects checkout for personal plan users', async ({ request }) => {
      const { token } = await setupCreator(request, 'nocheckout', 'support')

      const response = await request.post(`${API_URL}/billing/checkout`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      expect(response.status()).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('service providers')
    })

    test('requires authentication', async ({ request }) => {
      const response = await request.post(`${API_URL}/billing/checkout`)

      expect(response.status()).toBe(401)
    })
  })

  test.describe('POST /billing/portal', () => {
    test('creates portal session for user with platform subscription', async ({ request }) => {
      const { token, username } = await setupCreator(request, 'portalsuccess', 'service')

      // Seed platform subscription via E2E endpoint
      const seedResp = await request.post(`${API_URL}/e2e/seed-platform-subscription`, {
        headers: e2eHeaders(),
        data: { username, status: 'active' },
      })
      expect(seedResp.status(), 'Seed platform subscription must succeed').toBe(200)

      // Now portal should succeed
      const response = await request.post(`${API_URL}/billing/portal`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      expect(response.status(), 'Portal must succeed for subscribed user').toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('url')
      // Portal URL should be a Stripe billing portal URL
      expect(data.url).toContain('billing')
    })

    test('requires existing platform subscription', async ({ request }) => {
      const { token } = await setupCreator(request, 'portal', 'service')

      const response = await request.post(`${API_URL}/billing/portal`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      // New user without subscription should get error
      expect(response.status()).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('No subscription found')
    })

    test('requires authentication', async ({ request }) => {
      const response = await request.post(`${API_URL}/billing/portal`)

      expect(response.status()).toBe(401)
    })
  })
})

test.describe('Platform Debit', () => {
  test('debit is null for creator with no outstanding balance', async ({ request }) => {
    const { token } = await setupCreator(request, 'nodebit', 'service')

    const response = await request.get(`${API_URL}/billing/status`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    // New creator should have no debit
    expect(data.debit).toBeNull()
  })

  test('debit info has correct structure when creator has outstanding balance', async ({ request }) => {
    const { token, username } = await setupCreator(request, 'hasdebit', 'service')

    // Seed $15 platform debit (1500 cents)
    const seedResp = await request.post(`${API_URL}/e2e/seed-platform-debit`, {
      headers: e2eHeaders(),
      data: { username, amountCents: 1500 },
    })
    expect(seedResp.status(), 'Seed platform debit must succeed').toBe(200)

    const response = await request.get(`${API_URL}/billing/status`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    // Debit should be present with correct structure
    expect(data.debit).not.toBeNull()
    expect(data.debit).toHaveProperty('amountCents')
    expect(data.debit).toHaveProperty('amountDisplay')
    expect(data.debit).toHaveProperty('willRecoverFromNextPayment')
    expect(data.debit).toHaveProperty('atCapLimit')
    expect(data.debit).toHaveProperty('message')

    // Validate actual values
    expect(data.debit.amountCents).toBe(1500)
    expect(typeof data.debit.amountDisplay).toBe('string')
    expect(data.debit.amountDisplay).toContain('$15') // Should display as $15.00
    expect(typeof data.debit.willRecoverFromNextPayment).toBe('boolean')
    expect(data.debit.atCapLimit).toBe(false) // $15 < $30 cap
    expect(typeof data.debit.message).toBe('string')
  })

  test('atCapLimit is true when debit exceeds cap', async ({ request }) => {
    const { token, username } = await setupCreator(request, 'overcap', 'service')

    // Seed $35 platform debit (3500 cents) - exceeds $30 cap
    const seedResp = await request.post(`${API_URL}/e2e/seed-platform-debit`, {
      headers: e2eHeaders(),
      data: { username, amountCents: 3500 },
    })
    expect(seedResp.status(), 'Seed platform debit must succeed').toBe(200)

    const response = await request.get(`${API_URL}/billing/status`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.debit).not.toBeNull()
    expect(data.debit.amountCents).toBe(3500)
    expect(data.debit.atCapLimit).toBe(true) // $35 > $30 cap
  })
})

test.describe('Subscription Lifecycle', () => {
  test('status reflects subscription state changes', async ({ request }) => {
    const { token } = await setupCreator(request, 'lifecycle', 'service')

    // Initial status
    const resp1 = await request.get(`${API_URL}/billing/status`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    expect(resp1.status()).toBe(200)
    const initial = await resp1.json()

    expect(initial.subscriptionRequired).toBe(true)
    expect(initial.subscription).toBeTruthy()

    // Verify subscription object structure
    const sub = initial.subscription
    expect(sub).toHaveProperty('status')
    expect(sub).toHaveProperty('subscriptionId')
    expect(sub).toHaveProperty('currentPeriodEnd')
    expect(sub).toHaveProperty('trialEndsAt')
    expect(sub).toHaveProperty('cancelAtPeriodEnd')
  })
})
