import { test, expect } from '@playwright/test'
import { e2eLogin, buildUsername } from './auth.helper'

/**
 * Salary Mode E2E Tests
 *
 * Tests the Salary Mode feature that aligns subscriber billing
 * with creator's preferred payday (requires 2+ successful payments to unlock).
 *
 * Endpoints tested:
 * - GET /profile/salary-mode - Get salary mode status
 * - PATCH /profile/salary-mode - Enable/disable salary mode
 *
 * Run with: npx playwright test salary-mode.spec.ts
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
  options?: { unlockSalaryMode?: boolean }
) {
  const ts = Date.now().toString().slice(-8)
  const email = `salary-${suffix}-${ts}@e2e.natepay.co`
  const username = buildUsername('salary', suffix, ts)

  const { token, user } = await e2eLogin(request, email)

  // Create profile with Stripe
  const profileResp = await request.put(`${API_URL}/profile`, {
    data: {
      username,
      displayName: `Salary Mode Test ${suffix}`,
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'support',
      pricingModel: 'single',
      singleAmount: 10,
      paymentProvider: 'stripe',
      isPublic: true,
    },
    headers: { 'Authorization': `Bearer ${token}` },
  })

  expect(profileResp.status(), 'Profile must be created').toBe(200)

  // Connect Stripe (stub mode)
  await request.post(`${API_URL}/stripe/connect`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })

  // If unlocking salary mode, seed 2+ successful payments
  if (options?.unlockSalaryMode) {
    // Seed 2 payments to unlock payday alignment
    for (let i = 0; i < 2; i++) {
      await request.post(`${API_URL}/e2e/seed-payment`, {
        headers: e2eHeaders(),
        data: {
          creatorUsername: username,
          subscriberEmail: `sub-unlock-${i}-${ts}@e2e.natepay.co`,
          amountCents: 1000,
          currency: 'USD',
          status: 'succeeded',
        },
      })
    }

    // Unlock salary mode via E2E endpoint
    const unlockResp = await request.post(`${API_URL}/e2e/unlock-salary-mode`, {
      headers: e2eHeaders(),
      data: { username },
    })
    expect(unlockResp.status(), 'Unlock salary mode must succeed').toBe(200)
  }

  return { token, userId: user.id, email, username }
}

// ============================================
// TESTS
// ============================================

test.describe('Salary Mode', () => {
  test.describe('GET /profile/salary-mode', () => {
    test('returns salary mode status for creator with Stripe', async ({ request }) => {
      const { token } = await setupCreator(request, 'getstatus')

      const response = await request.get(`${API_URL}/profile/salary-mode`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      expect(response.status()).toBe(200)

      const data = await response.json()

      // Verify response structure
      expect(data).toHaveProperty('enabled')
      expect(data).toHaveProperty('preferredPayday')
      expect(data).toHaveProperty('billingDay')
      expect(data).toHaveProperty('unlocked')
      expect(data).toHaveProperty('successfulPayments')
      expect(data).toHaveProperty('paymentsUntilUnlock')
      expect(data).toHaveProperty('available')

      // Initial state
      expect(data.enabled).toBe(false)
      expect(data.available).toBe(true) // Stripe connected
      expect(data.unlocked).toBe(false) // No payments yet
      expect(typeof data.successfulPayments).toBe('number')
    })

    test('requires authentication', async ({ request }) => {
      const response = await request.get(`${API_URL}/profile/salary-mode`)

      expect(response.status()).toBe(401)
    })

    test('returns 404 for user without profile', async ({ request }) => {
      // Create user without profile
      const { token } = await e2eLogin(request, `noprofile-${Date.now()}@e2e.natepay.co`)

      const response = await request.get(`${API_URL}/profile/salary-mode`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      expect(response.status()).toBe(404)
    })
  })

  test.describe('PATCH /profile/salary-mode', () => {
    test('rejects enabling without Stripe account', async ({ request }) => {
      const ts = Date.now().toString().slice(-8)
      const email = `nostripe-${ts}@e2e.natepay.co`
      const { token } = await e2eLogin(request, email)

      // Create profile WITHOUT connecting Stripe
      await request.put(`${API_URL}/profile`, {
        data: {
          username: buildUsername('nostripe', '', ts),
          displayName: 'No Stripe Test',
          country: 'Nigeria',
          countryCode: 'NG',
          currency: 'NGN',
          purpose: 'support',
          pricingModel: 'single',
          singleAmount: 5000,
          paymentProvider: 'paystack', // Not Stripe
          isPublic: true,
        },
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const response = await request.patch(`${API_URL}/profile/salary-mode`, {
        headers: { 'Authorization': `Bearer ${token}` },
        data: { enabled: true, preferredPayday: 15 },
      })

      expect(response.status()).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Stripe')
    })

    test('rejects enabling without unlock (< 2 payments)', async ({ request }) => {
      const { token } = await setupCreator(request, 'locked')

      const response = await request.patch(`${API_URL}/profile/salary-mode`, {
        headers: { 'Authorization': `Bearer ${token}` },
        data: { enabled: true, preferredPayday: 15 },
      })

      expect(response.status()).toBe(403)
      const data = await response.json()
      expect(data.error).toContain('2 successful payments')
    })

    test('rejects enabling without preferredPayday', async ({ request }) => {
      const { token } = await setupCreator(request, 'nopayday', { unlockSalaryMode: true })

      const response = await request.patch(`${API_URL}/profile/salary-mode`, {
        headers: { 'Authorization': `Bearer ${token}` },
        data: { enabled: true }, // Missing preferredPayday
      })

      // Should be 400 (missing payday) since unlock succeeded
      expect(response.status()).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('preferredPayday')
    })

    test('validates preferredPayday range (1-28)', async ({ request }) => {
      const { token } = await setupCreator(request, 'badpayday')

      // Test payday = 0
      const resp1 = await request.patch(`${API_URL}/profile/salary-mode`, {
        headers: { 'Authorization': `Bearer ${token}` },
        data: { enabled: true, preferredPayday: 0 },
      })
      expect(resp1.status()).toBe(400)

      // Test payday = 31
      const resp2 = await request.patch(`${API_URL}/profile/salary-mode`, {
        headers: { 'Authorization': `Bearer ${token}` },
        data: { enabled: true, preferredPayday: 31 },
      })
      expect(resp2.status()).toBe(400)
    })

    test('successfully enables salary mode when unlocked', async ({ request }) => {
      const { token } = await setupCreator(request, 'enabled', { unlockSalaryMode: true })

      // Enable salary mode with preferredPayday = 15
      const response = await request.patch(`${API_URL}/profile/salary-mode`, {
        headers: { 'Authorization': `Bearer ${token}` },
        data: { enabled: true, preferredPayday: 15 },
      })

      expect(response.status()).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.enabled).toBe(true)
      expect(data.preferredPayday).toBe(15)

      // Verify via GET that billingDay is calculated
      const getResp = await request.get(`${API_URL}/profile/salary-mode`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      expect(getResp.status()).toBe(200)
      const status = await getResp.json()

      expect(status.enabled).toBe(true)
      expect(status.preferredPayday).toBe(15)
      expect(status.unlocked).toBe(true)
      // billingDay should be calculated (typically 3 days before payday)
      expect(status.billingDay).not.toBeNull()
      expect(typeof status.billingDay).toBe('number')
      expect(status.billingDay).toBeGreaterThanOrEqual(1)
      expect(status.billingDay).toBeLessThanOrEqual(28)
    })

    test('allows disabling salary mode', async ({ request }) => {
      const { token } = await setupCreator(request, 'disable')

      // Disable (should work even if not unlocked/enabled)
      const response = await request.patch(`${API_URL}/profile/salary-mode`, {
        headers: { 'Authorization': `Bearer ${token}` },
        data: { enabled: false },
      })

      expect(response.status()).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.enabled).toBe(false)
    })

    test('requires authentication', async ({ request }) => {
      const response = await request.patch(`${API_URL}/profile/salary-mode`, {
        data: { enabled: true, preferredPayday: 15 },
      })

      expect(response.status()).toBe(401)
    })
  })

  test.describe('Billing Day Calculation', () => {
    test('billingDay is null when no preferredPayday set', async ({ request }) => {
      const { token } = await setupCreator(request, 'nobilling')

      const response = await request.get(`${API_URL}/profile/salary-mode`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      expect(response.status()).toBe(200)
      const data = await response.json()
      expect(data.billingDay).toBeNull()
      expect(data.preferredPayday).toBeNull()
    })
  })
})
