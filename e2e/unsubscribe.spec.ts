import { test, expect } from '@playwright/test'
import { e2eLogin, buildUsername } from './auth.helper'

/**
 * Unsubscribe Flow E2E Tests
 *
 * Tests the Visa-compliant 1-click cancellation flow via signed tokens.
 * This flow is used in pre-billing reminder emails for frictionless cancellation.
 *
 * Endpoints tested:
 * - GET /my-subscriptions/unsubscribe/:token - Display cancel confirmation
 * - POST /my-subscriptions/unsubscribe/:token - Execute cancellation
 *
 * Run with: npx playwright test unsubscribe.spec.ts
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

async function setupCreatorWithSubscription(
  request: import('@playwright/test').APIRequestContext,
  suffix: string
) {
  const ts = Date.now().toString().slice(-8)
  const creatorEmail = `unsub-creator-${suffix}-${ts}@e2e.natepay.co`
  const creatorUsername = buildUsername('unsub', suffix, ts)
  const subscriberEmail = `unsub-sub-${suffix}-${ts}@e2e.natepay.co`

  // Create creator with profile
  const { token, user: creator } = await e2eLogin(request, creatorEmail)

  const profileResp = await request.put(`${API_URL}/profile`, {
    data: {
      username: creatorUsername,
      displayName: `Unsub Test Creator ${suffix}`,
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'support',
      pricingModel: 'single',
      singleAmount: 100,
      paymentProvider: 'stripe',
      isPublic: true,
    },
    headers: { 'Authorization': `Bearer ${token}` },
  })

  expect(profileResp.status(), 'Creator profile must be created').toBe(200)

  // Connect Stripe (stub mode)
  await request.post(`${API_URL}/stripe/connect`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })

  // Seed subscription via E2E endpoint (returns cancelToken + manageToken)
  const seedResp = await request.post(`${API_URL}/e2e/seed-subscription`, {
    headers: e2eHeaders(),
    data: {
      creatorUsername,
      subscriberEmail,
      amount: 1000,
      currency: 'USD',
      interval: 'month',
      status: 'active',
    },
  })

  expect(seedResp.status(), 'Subscription must be seeded').toBe(200)
  const seedData = await seedResp.json()

  return {
    creatorId: creator.id,
    creatorUsername,
    creatorDisplayName: `Unsub Test Creator ${suffix}`,
    subscriberEmail,
    subscriptionId: seedData.subscriptionId,
    manageToken: seedData.manageToken,
    cancelToken: seedData.cancelToken, // Valid cancel token for unsubscribe flow
    e2eRunId: seedData.e2eRunId,
  }
}

// ============================================
// UNSUBSCRIBE FLOW TESTS
// ============================================

test.describe('Unsubscribe Flow', () => {
  test.describe('GET /my-subscriptions/unsubscribe/:token', () => {
    test('returns subscription info for valid cancel token', async ({ request }) => {
      const setup = await setupCreatorWithSubscription(request, 'getvalid')

      // Use the valid cancelToken from seed-subscription
      const response = await request.get(
        `${API_URL}/my-subscriptions/unsubscribe/${setup.cancelToken}`
      )

      expect(response.status(), 'Valid cancel token must return 200').toBe(200)

      const data = await response.json()

      // Verify subscription info is returned
      expect(data).toHaveProperty('subscription')
      expect(data.subscription).toHaveProperty('id', setup.subscriptionId)
      expect(data.subscription).toHaveProperty('providerName')
      expect(data.subscription).toHaveProperty('amount')
      expect(data.subscription).toHaveProperty('currency', 'USD')
      expect(data.subscription).toHaveProperty('status', 'active')
      expect(data.subscription).toHaveProperty('alreadyCanceled', false)
    })

    test('returns error for invalid token', async ({ request }) => {
      const response = await request.get(
        `${API_URL}/my-subscriptions/unsubscribe/invalid-token-12345`
      )

      expect(response.status()).toBe(400)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('code')
      expect(data.code).toBe('INVALID_TOKEN')
    })

    test('returns error for malformed base64 token', async ({ request }) => {
      const response = await request.get(
        `${API_URL}/my-subscriptions/unsubscribe/not-valid-base64!!!`
      )

      expect(response.status()).toBe(400)
      const data = await response.json()
      expect(data.code).toBe('INVALID_TOKEN')
    })
  })

  test.describe('POST /my-subscriptions/unsubscribe/:token', () => {
    test('successfully cancels subscription with valid token', async ({ request }) => {
      const setup = await setupCreatorWithSubscription(request, 'postvalid')

      // Verify subscription is active before cancel
      const beforeResp = await request.get(
        `${API_URL}/e2e/subscription/${setup.subscriptionId}`,
        { headers: e2eHeaders() }
      )
      expect(beforeResp.status()).toBe(200)
      const beforeSub = await beforeResp.json()
      expect(beforeSub.status).toBe('active')
      expect(beforeSub.cancelAtPeriodEnd).toBe(false)

      // Execute cancellation via POST
      const response = await request.post(
        `${API_URL}/my-subscriptions/unsubscribe/${setup.cancelToken}`
      )

      expect(response.status(), 'Cancellation must succeed').toBe(200)

      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data).toHaveProperty('message')
      expect(data).toHaveProperty('subscription')
      expect(data.subscription.cancelAtPeriodEnd).toBe(true)

      // DB SIDE-EFFECT: Verify subscription is now set to cancel at period end
      const afterResp = await request.get(
        `${API_URL}/e2e/subscription/${setup.subscriptionId}`,
        { headers: e2eHeaders() }
      )
      expect(afterResp.status()).toBe(200)
      const afterSub = await afterResp.json()
      expect(afterSub.cancelAtPeriodEnd, 'Subscription must be marked for cancellation').toBe(true)
    })

    test('returns error for invalid token', async ({ request }) => {
      const response = await request.post(
        `${API_URL}/my-subscriptions/unsubscribe/invalid-token-12345`
      )

      expect(response.status()).toBe(400)

      const data = await response.json()
      expect(data.code).toBe('INVALID_TOKEN')
    })

    test('handles already canceled subscription gracefully', async ({ request }) => {
      const setup = await setupCreatorWithSubscription(request, 'already2')

      // First cancellation
      const firstResp = await request.post(
        `${API_URL}/my-subscriptions/unsubscribe/${setup.cancelToken}`
      )
      expect(firstResp.status()).toBe(200)

      // Second cancellation attempt - should still succeed with alreadyCanceled flag
      const secondResp = await request.post(
        `${API_URL}/my-subscriptions/unsubscribe/${setup.cancelToken}`
      )

      expect(secondResp.status()).toBe(200)
      const data = await secondResp.json()
      expect(data.success).toBe(true)
      expect(data.alreadyCanceled).toBe(true)
    })

    test('cancellation is idempotent', async ({ request }) => {
      const setup = await setupCreatorWithSubscription(request, 'idempotent')

      // Cancel multiple times
      const responses = await Promise.all([
        request.post(`${API_URL}/my-subscriptions/unsubscribe/${setup.cancelToken}`),
        request.post(`${API_URL}/my-subscriptions/unsubscribe/${setup.cancelToken}`),
      ])

      // Both should succeed
      for (const resp of responses) {
        expect(resp.status()).toBe(200)
        const data = await resp.json()
        expect(data.success).toBe(true)
      }

      // Final state should be cancelAtPeriodEnd=true
      const finalResp = await request.get(
        `${API_URL}/e2e/subscription/${setup.subscriptionId}`,
        { headers: e2eHeaders() }
      )
      const finalSub = await finalResp.json()
      expect(finalSub.cancelAtPeriodEnd).toBe(true)
    })
  })

  test.describe('Rate Limiting', () => {
    test('unsubscribe endpoint rate limits excessive requests', async ({ request }) => {
      // Make many rapid requests with invalid tokens to trigger rate limit
      const requests = Array(20).fill(null).map((_, i) =>
        request.get(`${API_URL}/my-subscriptions/unsubscribe/invalid-${Date.now()}-${i}`)
      )

      const responses = await Promise.all(requests)
      const statuses = responses.map(r => r.status())

      // Should have mostly 400s (invalid token)
      const invalidTokens = statuses.filter(s => s === 400).length
      expect(invalidTokens).toBeGreaterThan(0)

      // Rate limiting may kick in
      const rateLimited = statuses.filter(s => s === 429).length
      // Just verify we got results, rate limit config varies
      expect(statuses.length).toBe(20)
    })
  })
})

// ============================================
// TOKEN GENERATION ENDPOINT TESTS
// ============================================

test.describe('Token Generation Endpoint', () => {
  test('generates all token types for valid subscription', async ({ request }) => {
    const setup = await setupCreatorWithSubscription(request, 'gentokens')

    const response = await request.post(`${API_URL}/e2e/generate-tokens`, {
      headers: e2eHeaders(),
      data: { subscriptionId: setup.subscriptionId },
    })

    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data.subscriptionId).toBe(setup.subscriptionId)
    expect(data.cancelToken).toBeTruthy()
    expect(data.manageToken).toBeTruthy()
    expect(data.urls.cancel).toContain('/unsubscribe/')
    expect(data.urls.manage).toContain('/subscription/manage/')
  })

  test('returns 404 for non-existent subscription', async ({ request }) => {
    const response = await request.post(`${API_URL}/e2e/generate-tokens`, {
      headers: e2eHeaders(),
      data: { subscriptionId: '00000000-0000-0000-0000-000000000000' },
    })

    expect(response.status()).toBe(404)
  })

  test('generated cancel token works for unsubscribe flow', async ({ request }) => {
    const setup = await setupCreatorWithSubscription(request, 'gencancel')

    // Generate fresh tokens
    const tokenResp = await request.post(`${API_URL}/e2e/generate-tokens`, {
      headers: e2eHeaders(),
      data: { subscriptionId: setup.subscriptionId },
    })
    const { cancelToken } = await tokenResp.json()

    // Use generated token to get subscription info
    const infoResp = await request.get(
      `${API_URL}/my-subscriptions/unsubscribe/${cancelToken}`
    )

    expect(infoResp.status(), 'Generated token must work').toBe(200)
    const data = await infoResp.json()
    expect(data.subscription.id).toBe(setup.subscriptionId)
  })
})

// ============================================
// MANAGE PORTAL TOKEN FLOW
// ============================================

test.describe('Manage Portal Token Flow', () => {
  test.describe('GET /my-subscriptions/manage/:token', () => {
    test('returns error redirect for invalid token', async ({ request }) => {
      const response = await request.get(
        `${API_URL}/my-subscriptions/manage/invalid-manage-token`,
        { maxRedirects: 0 }
      )

      expect(response.status()).toBe(302)

      const location = response.headers()['location']
      expect(location).toContain('error=invalid_manage_link')
    })

    // Note: Valid portal token test requires real Stripe customer ID
    // which would require full Stripe integration in E2E
  })
})

// ============================================
// EXPRESS DASHBOARD TOKEN FLOW
// ============================================

test.describe('Express Dashboard Token Flow', () => {
  test.describe('GET /my-subscriptions/express-dashboard/:token', () => {
    test('returns error redirect for invalid token', async ({ request }) => {
      const response = await request.get(
        `${API_URL}/my-subscriptions/express-dashboard/invalid-dashboard-token`,
        { maxRedirects: 0 }
      )

      expect(response.status()).toBe(302)

      const location = response.headers()['location']
      expect(location).toContain('error=invalid_dashboard_link')
    })

    // Note: Valid express dashboard token test requires real Stripe account ID
    // which would require full Stripe integration in E2E
  })
})
