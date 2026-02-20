/**
 * Dynamic Minimum Integration Tests
 *
 * Tests for:
 * - /config/my-minimum endpoint
 * - Profile validation with dynamic minimums
 * - One-time subscription exclusion from subscriber count
 */

import { createHmac } from 'crypto'
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { dbStorage } from '../setup.js'
import { env } from '../../src/config/env.js'
import { getDynamicMinimum } from '../../src/constants/creatorMinimums.js'

// Mock email service
vi.mock('../../src/services/email.js', () => ({
  sendOtpEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
}))

// Mock Stripe service
vi.mock('../../src/services/stripe.js', () => ({
  stripe: {
    accounts: {
      create: vi.fn(async () => ({ id: 'acct_test_123' })),
      retrieve: vi.fn(async () => ({
        id: 'acct_test_123',
        charges_enabled: true,
        payouts_enabled: true,
      })),
    },
  },
  createExpressAccount: vi.fn(async () => ({
    accountId: 'acct_test_123',
    accountLink: 'https://connect.stripe.com/setup',
  })),
  getAccountStatus: vi.fn(async () => ({
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  })),
}))

// Mock platform subscription service
vi.mock('../../src/services/platformSubscription.js', () => ({
  startPlatformTrial: vi.fn(async () => 'trial_123'),
}))

// Hash function matching auth service
function hashToken(token: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex')
}

// Helper to create a test user with session and profile
async function createStripeCreator(options: {
  email?: string
  country?: string
  subscriberCount?: number
  oneTimeCount?: number
} = {}) {
  const {
    email = 'creator@test.com',
    country = 'Nigeria',
    subscriberCount = 0,
    oneTimeCount = 0,
  } = options

  const user = await db.user.create({
    data: { email },
  })

  const rawToken = `test-session-${user.id}`
  const hashedToken = hashToken(rawToken)

  const session = await db.session.create({
    data: {
      userId: user.id,
      token: hashedToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  dbStorage.sessions.set(session.id, { ...session, user })

  // Create profile
  const profile = await db.profile.create({
    data: {
      userId: user.id,
      username: `creator_${user.id.slice(0, 8)}`,
      displayName: 'Test Creator',
      country,
      countryCode: { Nigeria: 'NG', 'United States': 'US', 'South Africa': 'ZA', Kenya: 'KE', Ghana: 'GH' }[country] || 'GB',
      currency: { Nigeria: 'NGN', 'South Africa': 'ZAR', Kenya: 'KES', Ghana: 'GHS' }[country] || 'USD',
      purpose: 'support',
      paymentProvider: 'stripe',
      stripeAccountId: 'acct_test_123',
      stripeAccountStatus: 'complete',
      pricingModel: 'single',
      singleAmount: 15000, // $150 in cents
      feeMode: 'split',
    },
  })

  // Create monthly subscribers
  for (let i = 0; i < subscriberCount; i++) {
    const subscriber = await db.user.create({
      data: { email: `sub${i}@test.com` },
    })
    await db.subscription.create({
      data: {
        creatorId: user.id,
        subscriberId: subscriber.id,
        amount: 15000,
        currency: 'USD',
        interval: 'month',
        status: 'active',
      },
    })
  }

  // Create one-time subscriptions (should NOT count)
  for (let i = 0; i < oneTimeCount; i++) {
    const subscriber = await db.user.create({
      data: { email: `onetime${i}@test.com` },
    })
    await db.subscription.create({
      data: {
        creatorId: user.id,
        subscriberId: subscriber.id,
        amount: 5000,
        currency: 'USD',
        interval: 'one_time',
        status: 'active',
      },
    })
  }

  return { user, session, rawToken, profile }
}

// Helper to make authenticated request
function authRequest(path: string, options: RequestInit = {}, rawToken: string) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${rawToken}`,
        ...options.headers,
      },
    })
  )
}

describe('dynamic minimums', () => {
  beforeEach(() => {
    Object.values(dbStorage).forEach(store => store.clear())
  })

  afterAll(() => {
    Object.values(dbStorage).forEach(store => store.clear())
  })

  describe('GET /config/my-minimum', () => {
    it('requires authentication', async () => {
      const res = await app.fetch(new Request('http://localhost/config/my-minimum'))
      expect(res.status).toBe(401)
    })

    it('returns 404 when profile not found', async () => {
      // Create user without profile
      const user = await db.user.create({
        data: { email: 'noprofile@test.com' },
      })

      const rawToken = `test-session-${user.id}`
      const hashedToken = hashToken(rawToken)

      await db.session.create({
        data: {
          userId: user.id,
          token: hashedToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      const res = await authRequest('/config/my-minimum', {}, rawToken)
      expect(res.status).toBe(404)
    })

    it('returns no-store cache header', async () => {
      const { rawToken } = await createStripeCreator()
      const res = await authRequest('/config/my-minimum', {}, rawToken)

      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    })

    it('returns correct subscriber count (monthly only)', async () => {
      const { rawToken } = await createStripeCreator({
        subscriberCount: 5,
        oneTimeCount: 3, // Should NOT be counted
      })

      const res = await authRequest('/config/my-minimum', {}, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.subscriberCount).toBe(5) // Not 8
    })

    it('returns minimum and floor minimum', async () => {
      const { rawToken } = await createStripeCreator({
        country: 'Nigeria',
        subscriberCount: 5,
      })

      const res = await authRequest('/config/my-minimum', {}, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.minimum).toBeDefined()
      expect(body.minimum.usd).toBeGreaterThan(0)
      expect(body.minimum.local).toBeGreaterThan(0)
      expect(body.minimum.currency).toBe('NGN')
      expect(body.floorMinimum).toBeDefined()
      expect(body.floorMinimum).toBeLessThanOrEqual(body.minimum.usd)
    })

    it('returns debug info', async () => {
      const { rawToken } = await createStripeCreator()

      const res = await authRequest('/config/my-minimum', {}, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body._debug).toBeDefined()
      expect(body._debug.percentFees).toBeDefined()
      expect(body._debug.fixedCents).toBeDefined()
      expect(body._debug.netMarginRate).toBeDefined()
    })
  })

  describe('profile validation with dynamic minimums', () => {
    it('accepts price below dynamic minimum for new creator (minimum enforcement removed from backend)', async () => {
      // Backend no longer enforces minimum price on PATCH /profile.
      // Minimums are still enforced at checkout time (checkout.ts).
      const { rawToken } = await createStripeCreator({
        country: 'Nigeria',
        subscriberCount: 0,
      })

      // Get the dynamic minimum - creator uses NGN so minimum is in local currency
      const dynamicMin = getDynamicMinimum({ country: 'Nigeria', subscriberCount: 0 })

      // Price below minimum is now accepted (enforced at checkout)
      const belowMinimum = dynamicMin.minimumLocal - 1000
      const res = await authRequest(
        '/profile',
        {
          method: 'PATCH',
          body: JSON.stringify({ singleAmount: belowMinimum }),
        },
        rawToken
      )

      expect(res.status).toBe(200)
    })

    it('accepts price at dynamic minimum', async () => {
      const { rawToken } = await createStripeCreator({
        country: 'Nigeria',
        subscriberCount: 5,
      })

      // Get the dynamic minimum - creator uses NGN so minimum is in local currency
      const dynamicMin = getDynamicMinimum({ country: 'Nigeria', subscriberCount: 5 })

      // Set price at minimum (in NGN)
      const res = await authRequest(
        '/profile',
        {
          method: 'PATCH',
          body: JSON.stringify({ singleAmount: dynamicMin.minimumLocal }),
        },
        rawToken
      )

      expect(res.status).toBe(200)
    })

    it('minimum is consistent regardless of subscriber count (no account fee amortization)', async () => {
      const { rawToken } = await createStripeCreator({
        country: 'United States',
        subscriberCount: 20,
      })

      // No amortization — all subscriber counts yield same minimum
      const floorMin = getDynamicMinimum({ country: 'United States', subscriberCount: 20 })
      const newCreatorMin = getDynamicMinimum({ country: 'United States', subscriberCount: 1 })
      expect(floorMin.minimumUSD).toBe(newCreatorMin.minimumUSD)

      // Should be able to set at minimum (in USD)
      const res = await authRequest(
        '/profile',
        {
          method: 'PATCH',
          body: JSON.stringify({ singleAmount: floorMin.minimumLocal * 100 }), // Convert to cents
        },
        rawToken
      )

      expect(res.status).toBe(200)
    })

    it('cross-border countries use flat $45 minimum', async () => {
      // Nigeria is a cross-border country - uses flat $45 minimum
      const { rawToken } = await createStripeCreator({
        country: 'Nigeria',
        subscriberCount: 20,
      })

      // Cross-border countries have flat $45 minimum (margin-positive at 3+ subs)
      const floorMin = getDynamicMinimum({ country: 'Nigeria', subscriberCount: 20 })
      const newCreatorMin = getDynamicMinimum({ country: 'Nigeria', subscriberCount: 1 })

      // Both should be $45 (flat minimum)
      expect(floorMin.minimumUSD).toBe(45)
      expect(newCreatorMin.minimumUSD).toBe(45)

      // Should be able to set at minimum (in NGN)
      const res = await authRequest(
        '/profile',
        {
          method: 'PATCH',
          body: JSON.stringify({ singleAmount: floorMin.minimumLocal }),
        },
        rawToken
      )

      expect(res.status).toBe(200)
    })

    it('ZA new creator minimum is $45 (same as floor, no account fee amortization)', async () => {
      const zaMin = getDynamicMinimum({ country: 'South Africa', subscriberCount: 0 })
      expect(zaMin.minimumUSD).toBe(45) // No amortization — same as floor

      const { rawToken } = await createStripeCreator({
        country: 'South Africa',
        subscriberCount: 0,
      })

      // Can set at the $45 floor minimum
      const res = await authRequest(
        '/profile',
        {
          method: 'PATCH',
          body: JSON.stringify({ singleAmount: zaMin.minimumLocal }),
        },
        rawToken
      )

      expect(res.status).toBe(200)
    })

    it('ZA creator with 3+ subscribers can use $45 floor', async () => {
      const zaMin3 = getDynamicMinimum({ country: 'South Africa', subscriberCount: 3 })
      expect(zaMin3.minimumUSD).toBe(45) // At 3 subs, floor kicks in

      const { rawToken } = await createStripeCreator({
        country: 'South Africa',
        subscriberCount: 3,
      })

      const res = await authRequest(
        '/profile',
        {
          method: 'PATCH',
          body: JSON.stringify({ singleAmount: zaMin3.minimumLocal }),
        },
        rawToken
      )

      expect(res.status).toBe(200)
    })

    it('KE new creator minimum is $45 (same as floor, no account fee amortization)', async () => {
      const keMin = getDynamicMinimum({ country: 'Kenya', subscriberCount: 0 })
      expect(keMin.minimumUSD).toBe(45) // No amortization — same as floor

      const { rawToken } = await createStripeCreator({
        country: 'Kenya',
        subscriberCount: 0,
      })

      // Can set at the $45 floor minimum
      const res = await authRequest(
        '/profile',
        {
          method: 'PATCH',
          body: JSON.stringify({ singleAmount: keMin.minimumLocal }),
        },
        rawToken
      )

      expect(res.status).toBe(200)
    })

    it('accepts tier amounts below dynamic minimum (minimum enforcement removed from backend)', async () => {
      // Backend no longer enforces minimum price on PATCH /profile.
      // Minimums are still enforced at checkout time (checkout.ts).
      const { rawToken } = await createStripeCreator({
        country: 'Nigeria',
        subscriberCount: 0,
      })

      // Nigerian creator uses NGN
      const dynamicMin = getDynamicMinimum({ country: 'Nigeria', subscriberCount: 0 })
      const belowMinimum = dynamicMin.minimumLocal - 1000

      const res = await authRequest(
        '/profile',
        {
          method: 'PATCH',
          body: JSON.stringify({
            pricingModel: 'tiers',
            tiers: [
              { id: '1', name: 'Basic', amount: belowMinimum, perks: ['perk1'] },
              { id: '2', name: 'Pro', amount: dynamicMin.minimumLocal + 50000, perks: ['perk2'] },
            ],
          }),
        },
        rawToken
      )

      expect(res.status).toBe(200)
    })

    it('accepts amount way below minimum (minimum enforcement removed from backend)', async () => {
      // Backend no longer enforces minimum price on PATCH /profile.
      // Minimums are still enforced at checkout time (checkout.ts).
      const { rawToken } = await createStripeCreator({
        country: 'Nigeria',
        subscriberCount: 3,
      })

      const res = await authRequest(
        '/profile',
        {
          method: 'PATCH',
          body: JSON.stringify({ singleAmount: 1000 }), // Way below previous minimum (in NGN) - now accepted
        },
        rawToken
      )

      expect(res.status).toBe(200)
    })
  })

  describe('one_time subscription exclusion', () => {
    it('one_time subscriptions do not lower the dynamic minimum', async () => {
      // Create creator with only one_time subscriptions
      const { rawToken } = await createStripeCreator({
        country: 'Nigeria',
        subscriberCount: 0,
        oneTimeCount: 10, // 10 one-time payments
      })

      const res = await authRequest('/config/my-minimum', {}, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()

      // Should report 0 subscribers (one_time excluded)
      expect(body.subscriberCount).toBe(0)

      // Minimum should be the new creator minimum (high)
      const newCreatorMin = getDynamicMinimum({ country: 'Nigeria', subscriberCount: 0 })
      expect(body.minimum.usd).toBe(newCreatorMin.minimumUSD)
    })

    it('mixed monthly and one_time counts only monthly', async () => {
      const { rawToken } = await createStripeCreator({
        country: 'Nigeria',
        subscriberCount: 5,
        oneTimeCount: 20,
      })

      const res = await authRequest('/config/my-minimum', {}, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.subscriberCount).toBe(5) // Only monthly

      // Minimum should match 5 monthly subs
      const expected = getDynamicMinimum({ country: 'Nigeria', subscriberCount: 5 })
      expect(body.minimum.usd).toBe(expected.minimumUSD)
    })
  })

  describe('Paystack creators bypass minimum', () => {
    it('does not apply dynamic minimum to Paystack creators', async () => {
      const user = await db.user.create({
        data: { email: 'paystack@test.com' },
      })

      const rawToken = `test-session-${user.id}`
      const hashedToken = hashToken(rawToken)

      await db.session.create({
        data: {
          userId: user.id,
          token: hashedToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      await db.profile.create({
        data: {
          userId: user.id,
          username: 'paystack_creator',
          displayName: 'Paystack Creator',
          country: 'Nigeria',
          countryCode: 'NG',
          currency: 'NGN',
          purpose: 'support',
          paymentProvider: 'paystack',
          paystackSubaccountCode: 'ACCT_xxx',
          pricingModel: 'single',
          singleAmount: 500000, // ₦5000
          feeMode: 'split',
        },
      })

      // Paystack creator can set any price
      const res = await authRequest(
        '/profile',
        {
          method: 'PATCH',
          body: JSON.stringify({ singleAmount: 1000 }), // Very low - ₦10
        },
        rawToken
      )

      // Should succeed (Paystack has no minimum)
      expect(res.status).toBe(200)
    })
  })
})
