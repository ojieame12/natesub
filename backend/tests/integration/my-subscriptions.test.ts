import { beforeEach, describe, expect, it, vi, afterAll } from 'vitest'
import { createHmac } from 'crypto'
import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { dbStorage } from '../setup.js'
import { env } from '../../src/config/env.js'

// Mock stripe service
vi.mock('../../src/services/stripe.js', () => ({
  cancelSubscription: vi.fn(),
  reactivateSubscription: vi.fn(),
  createSubscriberPortalSession: vi.fn(),
}))

// Mock system log service
vi.mock('../../src/services/systemLog.js', () => ({
  logSubscriptionEvent: vi.fn().mockResolvedValue(undefined),
}))

import { cancelSubscription, reactivateSubscription, createSubscriberPortalSession } from '../../src/services/stripe.js'
import { logSubscriptionEvent } from '../../src/services/systemLog.js'

const mockCancelSubscription = vi.mocked(cancelSubscription)
const mockReactivateSubscription = vi.mocked(reactivateSubscription)
const mockCreateSubscriberPortalSession = vi.mocked(createSubscriberPortalSession)
const mockLogSubscriptionEvent = vi.mocked(logSubscriptionEvent)

// Hash function matching auth service
function hashToken(token: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex')
}

// Helper to create a test subscriber with session
async function createTestSubscriberWithSession(email?: string) {
  const user = await db.user.create({
    data: { email: email || `subscriber-${Date.now()}@test.com` },
  })

  const rawToken = `test-session-${Date.now()}-${Math.random()}`
  const hashedToken = hashToken(rawToken)

  const session = await db.session.create({
    data: {
      userId: user.id,
      token: hashedToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  dbStorage.sessions.set(session.id, { ...session, user })

  return { user, session, rawToken }
}

// Helper to create a test creator (service provider)
async function createTestCreator(email?: string) {
  const user = await db.user.create({
    data: { email: email || `creator-${Date.now()}@test.com` },
  })

  const profile = await db.profile.create({
    data: {
      userId: user.id,
      username: `creator${Date.now()}`,
      displayName: 'Test Creator',
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'service',
      pricingModel: 'single',
      singleAmount: 1000,
      stripeAccountId: 'acct_test123',
      payoutStatus: 'active',
    },
  })

  return { user, profile }
}

// Helper to create a subscription
async function createTestSubscription(creatorId: string, subscriberId: string, options: {
  status?: 'active' | 'canceled' | 'past_due'
  stripeSubscriptionId?: string
  stripeCustomerId?: string
  cancelAtPeriodEnd?: boolean
} = {}) {
  return db.subscription.create({
    data: {
      creatorId,
      subscriberId,
      amount: 1000,
      currency: 'USD',
      interval: 'month',
      status: options.status || 'active',
      startedAt: new Date(),
      stripeSubscriptionId: options.stripeSubscriptionId,
      stripeCustomerId: options.stripeCustomerId,
      cancelAtPeriodEnd: options.cancelAtPeriodEnd || false,
    },
  })
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

// Helper to make public request
function publicRequest(path: string, options: RequestInit = {}) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
  )
}

describe('my-subscriptions routes', () => {
  beforeEach(() => {
    Object.values(dbStorage).forEach(store => store.clear())
    vi.clearAllMocks()
  })

  afterAll(() => {
    Object.values(dbStorage).forEach(store => store.clear())
  })

  describe('GET /my-subscriptions', () => {
    it('requires authentication', async () => {
      const res = await publicRequest('/my-subscriptions', { method: 'GET' })
      expect(res.status).toBe(401)
    })

    it('returns empty list when subscriber has no subscriptions', async () => {
      const { rawToken } = await createTestSubscriberWithSession()

      const res = await authRequest('/my-subscriptions', { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.subscriptions).toEqual([])
      expect(body.hasMore).toBe(false)
      expect(body.nextCursor).toBeNull()
    })

    it('returns list of subscriptions I have', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator1 } = await createTestCreator('creator1@test.com')
      const { user: creator2 } = await createTestCreator('creator2@test.com')

      await createTestSubscription(creator1.id, subscriber.id)
      await createTestSubscription(creator2.id, subscriber.id)

      const res = await authRequest('/my-subscriptions', { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.subscriptions).toHaveLength(2)
      expect(body.hasMore).toBe(false)
    })

    it('includes provider info in response', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator, profile } = await createTestCreator()

      await createTestSubscription(creator.id, subscriber.id)

      const res = await authRequest('/my-subscriptions', { method: 'GET' }, rawToken)
      const body = await res.json()

      expect(body.subscriptions[0].provider).toBeDefined()
      expect(body.subscriptions[0].provider.id).toBe(creator.id)
      expect(body.subscriptions[0].provider.displayName).toBe(profile.displayName)
      expect(body.subscriptions[0].provider.username).toBe(profile.username)
    })

    it('includes hasStripe flag for Stripe subscriptions', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator } = await createTestCreator()

      await createTestSubscription(creator.id, subscriber.id, {
        stripeSubscriptionId: 'sub_test123',
      })

      const res = await authRequest('/my-subscriptions', { method: 'GET' }, rawToken)
      const body = await res.json()

      expect(body.subscriptions[0].hasStripe).toBe(true)
    })

    it('filters by status', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator1 } = await createTestCreator('creator1@test.com')
      const { user: creator2 } = await createTestCreator('creator2@test.com')

      await createTestSubscription(creator1.id, subscriber.id, { status: 'active' })
      await createTestSubscription(creator2.id, subscriber.id, { status: 'canceled' })

      const res = await authRequest('/my-subscriptions?status=canceled', { method: 'GET' }, rawToken)
      const body = await res.json()

      expect(body.subscriptions).toHaveLength(1)
      expect(body.subscriptions[0].status).toBe('canceled')
    })

    it('only returns subscriptions for the authenticated subscriber', async () => {
      const { user: subscriber1, rawToken: rawToken1 } = await createTestSubscriberWithSession('sub1@test.com')
      const { user: subscriber2 } = await createTestSubscriberWithSession('sub2@test.com')
      const { user: creator } = await createTestCreator()

      await createTestSubscription(creator.id, subscriber1.id)
      await createTestSubscription(creator.id, subscriber2.id)

      const res = await authRequest('/my-subscriptions', { method: 'GET' }, rawToken1)
      const body = await res.json()

      expect(body.subscriptions).toHaveLength(1)
    })
  })

  describe('GET /my-subscriptions/:id', () => {
    it('requires authentication', async () => {
      const res = await publicRequest('/my-subscriptions/00000000-0000-0000-0000-000000000000', { method: 'GET' })
      expect(res.status).toBe(401)
    })

    it('returns 404 for non-existent subscription', async () => {
      const { rawToken } = await createTestSubscriberWithSession()

      const res = await authRequest('/my-subscriptions/00000000-0000-0000-0000-000000000000', { method: 'GET' }, rawToken)
      expect(res.status).toBe(404)
    })

    it('returns 404 for subscription belonging to another subscriber', async () => {
      const { rawToken: rawToken1 } = await createTestSubscriberWithSession('sub1@test.com')
      const { user: subscriber2 } = await createTestSubscriberWithSession('sub2@test.com')
      const { user: creator } = await createTestCreator()

      const subscription = await createTestSubscription(creator.id, subscriber2.id)

      const res = await authRequest(`/my-subscriptions/${subscription.id}`, { method: 'GET' }, rawToken1)
      expect(res.status).toBe(404)
    })

    it('returns subscription details with provider info', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator, profile } = await createTestCreator()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        stripeSubscriptionId: 'sub_test123',
      })

      const res = await authRequest(`/my-subscriptions/${subscription.id}`, { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.subscription).toBeDefined()
      expect(body.subscription.id).toBe(subscription.id)
      expect(body.subscription.provider.id).toBe(creator.id)
      expect(body.subscription.provider.username).toBe(profile.username)
      expect(body.subscription.hasStripe).toBe(true)
    })
  })

  describe('POST /my-subscriptions/:id/portal', () => {
    it('requires authentication', async () => {
      const res = await publicRequest('/my-subscriptions/00000000-0000-0000-0000-000000000000/portal', {
        method: 'POST',
      })
      expect(res.status).toBe(401)
    })

    it('returns 404 for non-existent subscription', async () => {
      const { rawToken } = await createTestSubscriberWithSession()

      const res = await authRequest('/my-subscriptions/00000000-0000-0000-0000-000000000000/portal', {
        method: 'POST',
      }, rawToken)
      expect(res.status).toBe(404)
    })

    it('returns 400 for non-Stripe subscription', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator } = await createTestCreator()

      // Create subscription without stripeCustomerId
      const subscription = await createTestSubscription(creator.id, subscriber.id)

      const res = await authRequest(`/my-subscriptions/${subscription.id}/portal`, {
        method: 'POST',
      }, rawToken)

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('not available')
    })

    it('creates portal session for Stripe subscription', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator } = await createTestCreator()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        stripeSubscriptionId: 'sub_test123',
        stripeCustomerId: 'cus_test123',
      })

      mockCreateSubscriberPortalSession.mockResolvedValue({
        url: 'https://billing.stripe.com/session/test',
      })

      const res = await authRequest(`/my-subscriptions/${subscription.id}/portal`, {
        method: 'POST',
      }, rawToken)

      expect(res.status).toBe(200)
      expect(mockCreateSubscriberPortalSession).toHaveBeenCalledWith(
        'cus_test123',
        expect.any(String) // Return URL
      )

      const body = await res.json()
      expect(body.url).toBe('https://billing.stripe.com/session/test')
    })

    it('handles portal creation failure', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator } = await createTestCreator()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        stripeSubscriptionId: 'sub_test123',
        stripeCustomerId: 'cus_test123',
      })

      mockCreateSubscriberPortalSession.mockRejectedValue(new Error('Stripe API error'))

      const res = await authRequest(`/my-subscriptions/${subscription.id}/portal`, {
        method: 'POST',
      }, rawToken)

      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toContain('Failed to create portal')
    })
  })

  describe('POST /my-subscriptions/:id/cancel', () => {
    it('requires authentication', async () => {
      const res = await publicRequest('/my-subscriptions/00000000-0000-0000-0000-000000000000/cancel', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(401)
    })

    it('returns 404 for non-existent subscription', async () => {
      const { rawToken } = await createTestSubscriberWithSession()

      const res = await authRequest('/my-subscriptions/00000000-0000-0000-0000-000000000000/cancel', {
        method: 'POST',
        body: JSON.stringify({}),
      }, rawToken)
      expect(res.status).toBe(404)
    })

    it('returns 400 for already canceled subscription', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator } = await createTestCreator()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        status: 'canceled',
      })

      const res = await authRequest(`/my-subscriptions/${subscription.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      }, rawToken)
      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.error).toContain('already canceled')
    })

    it('cancels Stripe subscription at period end by default', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator } = await createTestCreator()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        stripeSubscriptionId: 'sub_test123',
      })

      mockCancelSubscription.mockResolvedValue({
        status: 'active',
        cancelAtPeriodEnd: true,
        canceledAt: null,
      })

      const res = await authRequest(`/my-subscriptions/${subscription.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      }, rawToken)

      expect(res.status).toBe(200)
      expect(mockCancelSubscription).toHaveBeenCalledWith('sub_test123', true)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.subscription.cancelAtPeriodEnd).toBe(true)
    })

    it('cancels Paystack subscription locally', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator } = await createTestCreator()

      const subscription = await createTestSubscription(creator.id, subscriber.id)

      const res = await authRequest(`/my-subscriptions/${subscription.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      }, rawToken)

      expect(res.status).toBe(200)
      expect(mockCancelSubscription).not.toHaveBeenCalled()

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.subscription.cancelAtPeriodEnd).toBe(true)
    })
  })

  describe('POST /my-subscriptions/:id/reactivate', () => {
    it('requires authentication', async () => {
      const res = await publicRequest('/my-subscriptions/00000000-0000-0000-0000-000000000000/reactivate', {
        method: 'POST',
      })
      expect(res.status).toBe(401)
    })

    it('returns 400 for subscription not set to cancel', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator } = await createTestCreator()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        cancelAtPeriodEnd: false,
      })

      const res = await authRequest(`/my-subscriptions/${subscription.id}/reactivate`, {
        method: 'POST',
      }, rawToken)
      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.error).toContain('not set to cancel')
    })

    it('returns 400 for already canceled subscription', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator } = await createTestCreator()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        status: 'canceled',
        cancelAtPeriodEnd: true,
      })

      const res = await authRequest(`/my-subscriptions/${subscription.id}/reactivate`, {
        method: 'POST',
      }, rawToken)
      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.error).toContain('Cannot reactivate')
    })

    it('reactivates Stripe subscription', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator } = await createTestCreator()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        stripeSubscriptionId: 'sub_test123',
        cancelAtPeriodEnd: true,
      })

      mockReactivateSubscription.mockResolvedValue({
        status: 'active',
        cancelAtPeriodEnd: false,
      })

      const res = await authRequest(`/my-subscriptions/${subscription.id}/reactivate`, {
        method: 'POST',
      }, rawToken)

      expect(res.status).toBe(200)
      expect(mockReactivateSubscription).toHaveBeenCalledWith('sub_test123')

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.subscription.cancelAtPeriodEnd).toBe(false)
    })

    it('reactivates Paystack subscription locally', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator } = await createTestCreator()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        cancelAtPeriodEnd: true,
      })

      const res = await authRequest(`/my-subscriptions/${subscription.id}/reactivate`, {
        method: 'POST',
      }, rawToken)

      expect(res.status).toBe(200)
      expect(mockReactivateSubscription).not.toHaveBeenCalled()

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.subscription.cancelAtPeriodEnd).toBe(false)
    })

    it('logs reactivation event via logSubscriptionEvent', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator } = await createTestCreator()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        stripeSubscriptionId: 'sub_test123',
        cancelAtPeriodEnd: true,
      })

      mockReactivateSubscription.mockResolvedValue({
        status: 'active',
        cancelAtPeriodEnd: false,
      })

      await authRequest(`/my-subscriptions/${subscription.id}/reactivate`, {
        method: 'POST',
      }, rawToken)

      expect(mockLogSubscriptionEvent).toHaveBeenCalledWith({
        event: 'reactivate',
        subscriptionId: subscription.id,
        subscriberId: subscriber.id,
        creatorId: creator.id,
        provider: 'stripe',
        source: 'in_app',
      })
    })
  })

  describe('Audit Logging', () => {
    it('logs cancellation event via logSubscriptionEvent for Stripe', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator } = await createTestCreator()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        stripeSubscriptionId: 'sub_test123',
      })

      mockCancelSubscription.mockResolvedValue({
        status: 'active',
        cancelAtPeriodEnd: true,
        canceledAt: null,
      })

      await authRequest(`/my-subscriptions/${subscription.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      }, rawToken)

      expect(mockLogSubscriptionEvent).toHaveBeenCalledWith({
        event: 'cancel',
        subscriptionId: subscription.id,
        subscriberId: subscriber.id,
        creatorId: creator.id,
        provider: 'stripe',
        source: 'in_app',
      })
    })

    it('logs cancellation event via logSubscriptionEvent for Paystack', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator } = await createTestCreator()

      const subscription = await createTestSubscription(creator.id, subscriber.id)

      await authRequest(`/my-subscriptions/${subscription.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      }, rawToken)

      expect(mockLogSubscriptionEvent).toHaveBeenCalledWith({
        event: 'cancel',
        subscriptionId: subscription.id,
        subscriberId: subscriber.id,
        creatorId: creator.id,
        provider: 'paystack',
        source: 'in_app',
      })
    })
  })

  describe('Payment Amount Display', () => {
    it('returns gross amount (what subscriber paid) in payment history', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator } = await createTestCreator()

      const subscription = await createTestSubscription(creator.id, subscriber.id)

      // Create payment with grossCents (what subscriber paid)
      await db.payment.create({
        data: {
          subscriptionId: subscription.id,
          creatorId: creator.id,
          subscriberId: subscriber.id,
          grossCents: 1100, // Subscriber paid $11
          amountCents: 1000, // Base price $10
          subscriberFeeCents: 100, // $1 subscriber fee
          netCents: 900,
          feeCents: 100,
          currency: 'USD',
          status: 'succeeded',
          type: 'recurring',
        },
      })

      const res = await authRequest(`/my-subscriptions/${subscription.id}`, { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.subscription.payments).toHaveLength(1)
      // Should show $11 (gross / 100), not $10 (base / 100)
      expect(body.subscription.payments[0].amount).toBe(11)
    })

    it('falls back to amountCents + subscriberFeeCents when grossCents is null', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator } = await createTestCreator()

      const subscription = await createTestSubscription(creator.id, subscriber.id)

      // Create legacy payment without grossCents
      await db.payment.create({
        data: {
          subscriptionId: subscription.id,
          creatorId: creator.id,
          subscriberId: subscriber.id,
          grossCents: null, // Legacy payment - no grossCents
          amountCents: 1000, // Base price $10
          subscriberFeeCents: 100, // $1 subscriber fee
          netCents: 900,
          feeCents: 100,
          currency: 'USD',
          status: 'succeeded',
          type: 'recurring',
        },
      })

      const res = await authRequest(`/my-subscriptions/${subscription.id}`, { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.subscription.payments).toHaveLength(1)
      // Should calculate as (amountCents + subscriberFeeCents) / 100 = $11
      expect(body.subscription.payments[0].amount).toBe(11)
    })

    it('handles payment with no subscriber fee', async () => {
      const { user: subscriber, rawToken } = await createTestSubscriberWithSession()
      const { user: creator } = await createTestCreator()

      const subscription = await createTestSubscription(creator.id, subscriber.id)

      // Create payment with no subscriber fee (creator absorbs all fees)
      await db.payment.create({
        data: {
          subscriptionId: subscription.id,
          creatorId: creator.id,
          subscriberId: subscriber.id,
          grossCents: null,
          amountCents: 1000,
          subscriberFeeCents: null, // No subscriber fee
          netCents: 900,
          feeCents: 100,
          currency: 'USD',
          status: 'succeeded',
          type: 'recurring',
        },
      })

      const res = await authRequest(`/my-subscriptions/${subscription.id}`, { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.subscription.payments).toHaveLength(1)
      // Should show $10 (amountCents / 100 + 0)
      expect(body.subscription.payments[0].amount).toBe(10)
    })
  })
})
