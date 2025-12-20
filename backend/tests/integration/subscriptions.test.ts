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
}))

import { cancelSubscription, reactivateSubscription } from '../../src/services/stripe.js'

const mockCancelSubscription = vi.mocked(cancelSubscription)
const mockReactivateSubscription = vi.mocked(reactivateSubscription)

// Hash function matching auth service
function hashToken(token: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex')
}

// Helper to create a test creator with session
async function createTestCreatorWithSession(email?: string) {
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
      purpose: 'tips',
      pricingModel: 'single',
      singleAmount: 1000,
      stripeAccountId: 'acct_test123',
      payoutStatus: 'active',
    },
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

  return { user, profile, session, rawToken }
}

// Helper to create a test subscriber
async function createTestSubscriber(email?: string) {
  const user = await db.user.create({
    data: { email: email || `subscriber-${Date.now()}@test.com` },
  })

  const profile = await db.profile.create({
    data: {
      userId: user.id,
      username: `subscriber${Date.now()}`,
      displayName: 'Test Subscriber',
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'tips',
      pricingModel: 'single',
      singleAmount: 500,
    },
  })

  return { user, profile }
}

// Helper to create a subscription
async function createTestSubscription(creatorId: string, subscriberId: string, options: {
  status?: 'active' | 'canceled' | 'past_due'
  stripeSubscriptionId?: string
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

describe('subscriptions routes', () => {
  beforeEach(() => {
    Object.values(dbStorage).forEach(store => store.clear())
    vi.clearAllMocks()
  })

  afterAll(() => {
    Object.values(dbStorage).forEach(store => store.clear())
  })

  describe('GET /subscriptions', () => {
    it('requires authentication', async () => {
      const res = await publicRequest('/subscriptions', { method: 'GET' })
      expect(res.status).toBe(401)
    })

    it('returns empty list when creator has no subscribers', async () => {
      const { rawToken } = await createTestCreatorWithSession()

      const res = await authRequest('/subscriptions', { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.subscriptions).toEqual([])
      expect(body.hasMore).toBe(false)
      expect(body.nextCursor).toBeNull()
    })

    it('returns list of subscribers', async () => {
      const { user: creator, rawToken } = await createTestCreatorWithSession()
      const { user: subscriber1 } = await createTestSubscriber('sub1@test.com')
      const { user: subscriber2 } = await createTestSubscriber('sub2@test.com')

      await createTestSubscription(creator.id, subscriber1.id)
      await createTestSubscription(creator.id, subscriber2.id)

      const res = await authRequest('/subscriptions', { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.subscriptions).toHaveLength(2)
      expect(body.hasMore).toBe(false)
    })

    it('filters by active status (includes past_due)', async () => {
      const { user: creator, rawToken } = await createTestCreatorWithSession()
      const { user: subscriber1 } = await createTestSubscriber('sub1@test.com')
      const { user: subscriber2 } = await createTestSubscriber('sub2@test.com')
      const { user: subscriber3 } = await createTestSubscriber('sub3@test.com')

      await createTestSubscription(creator.id, subscriber1.id, { status: 'active' })
      await createTestSubscription(creator.id, subscriber2.id, { status: 'canceled' })
      await createTestSubscription(creator.id, subscriber3.id, { status: 'past_due' })

      const res = await authRequest('/subscriptions?status=active', { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      // Active filter includes both 'active' and 'past_due'
      expect(body.subscriptions).toHaveLength(2)
    })

    it('filters by canceled status', async () => {
      const { user: creator, rawToken } = await createTestCreatorWithSession()
      const { user: subscriber1 } = await createTestSubscriber('sub1@test.com')
      const { user: subscriber2 } = await createTestSubscriber('sub2@test.com')

      await createTestSubscription(creator.id, subscriber1.id, { status: 'active' })
      await createTestSubscription(creator.id, subscriber2.id, { status: 'canceled' })

      const res = await authRequest('/subscriptions?status=canceled', { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.subscriptions).toHaveLength(1)
      expect(body.subscriptions[0].status).toBe('canceled')
    })

    it('returns all subscriptions with status=all', async () => {
      const { user: creator, rawToken } = await createTestCreatorWithSession()
      const { user: subscriber1 } = await createTestSubscriber('sub1@test.com')
      const { user: subscriber2 } = await createTestSubscriber('sub2@test.com')

      await createTestSubscription(creator.id, subscriber1.id, { status: 'active' })
      await createTestSubscription(creator.id, subscriber2.id, { status: 'canceled' })

      const res = await authRequest('/subscriptions?status=all', { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.subscriptions).toHaveLength(2)
    })

    it('supports cursor pagination', async () => {
      const { user: creator, rawToken } = await createTestCreatorWithSession()

      // Create 3 subscribers
      for (let i = 0; i < 3; i++) {
        const { user: subscriber } = await createTestSubscriber(`sub${i}@test.com`)
        await createTestSubscription(creator.id, subscriber.id)
      }

      // Get first page with limit 2
      const res1 = await authRequest('/subscriptions?limit=2', { method: 'GET' }, rawToken)
      const body1 = await res1.json()

      expect(body1.subscriptions).toHaveLength(2)
      expect(body1.hasMore).toBe(true)
      expect(body1.nextCursor).toBeDefined()

      // Get second page using cursor
      const res2 = await authRequest(`/subscriptions?cursor=${body1.nextCursor}&limit=2`, { method: 'GET' }, rawToken)
      const body2 = await res2.json()

      expect(body2.subscriptions).toHaveLength(1)
      expect(body2.hasMore).toBe(false)
    })

    it('only returns subscriptions for the authenticated creator', async () => {
      const { user: creator1, rawToken: rawToken1 } = await createTestCreatorWithSession('creator1@test.com')
      const { user: creator2 } = await createTestCreatorWithSession('creator2@test.com')
      const { user: subscriber } = await createTestSubscriber()

      await createTestSubscription(creator1.id, subscriber.id)
      await createTestSubscription(creator2.id, subscriber.id)

      const res = await authRequest('/subscriptions', { method: 'GET' }, rawToken1)
      const body = await res.json()

      expect(body.subscriptions).toHaveLength(1)
    })
  })

  describe('GET /subscriptions/:id', () => {
    it('requires authentication', async () => {
      const res = await publicRequest('/subscriptions/00000000-0000-0000-0000-000000000000', { method: 'GET' })
      expect(res.status).toBe(401)
    })

    it('returns 404 for non-existent subscription', async () => {
      const { rawToken } = await createTestCreatorWithSession()

      const res = await authRequest('/subscriptions/00000000-0000-0000-0000-000000000000', { method: 'GET' }, rawToken)
      expect(res.status).toBe(404)
    })

    it('returns 404 for subscription belonging to another creator', async () => {
      const { user: creator1, rawToken: rawToken1 } = await createTestCreatorWithSession('creator1@test.com')
      const { user: creator2 } = await createTestCreatorWithSession('creator2@test.com')
      const { user: subscriber } = await createTestSubscriber()

      const subscription = await createTestSubscription(creator2.id, subscriber.id)

      const res = await authRequest(`/subscriptions/${subscription.id}`, { method: 'GET' }, rawToken1)
      expect(res.status).toBe(404)
    })

    it('returns subscription details with payment history', async () => {
      const { user: creator, rawToken } = await createTestCreatorWithSession()
      const { user: subscriber } = await createTestSubscriber()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        stripeSubscriptionId: 'sub_test123',
      })

      // Create payment history
      await db.payment.create({
        data: {
          subscriptionId: subscription.id,
          profileId: (await db.profile.findUnique({ where: { userId: creator.id } }))!.id,
          amountCents: 1000,
          currency: 'USD',
          status: 'succeeded',
          type: 'subscription',
          occurredAt: new Date(),
        },
      })

      const res = await authRequest(`/subscriptions/${subscription.id}`, { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.subscription).toBeDefined()
      expect(body.subscription.id).toBe(subscription.id)
      expect(body.subscription.subscriber.id).toBe(subscriber.id)
      expect(body.subscription.payments).toHaveLength(1)
      expect(body.subscription.payments[0].status).toBe('succeeded')
    })
  })

  describe('POST /subscriptions/:id/cancel', () => {
    it('requires authentication', async () => {
      const res = await publicRequest('/subscriptions/00000000-0000-0000-0000-000000000000/cancel', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(401)
    })

    it('returns 404 for non-existent subscription', async () => {
      const { rawToken } = await createTestCreatorWithSession()

      const res = await authRequest('/subscriptions/00000000-0000-0000-0000-000000000000/cancel', {
        method: 'POST',
        body: JSON.stringify({}),
      }, rawToken)
      expect(res.status).toBe(404)
    })

    it('returns 400 for already canceled subscription', async () => {
      const { user: creator, rawToken } = await createTestCreatorWithSession()
      const { user: subscriber } = await createTestSubscriber()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        status: 'canceled',
      })

      const res = await authRequest(`/subscriptions/${subscription.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      }, rawToken)
      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.error).toContain('already canceled')
    })

    it('cancels Stripe subscription at period end by default', async () => {
      const { user: creator, rawToken } = await createTestCreatorWithSession()
      const { user: subscriber } = await createTestSubscriber()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        stripeSubscriptionId: 'sub_test123',
      })

      mockCancelSubscription.mockResolvedValue({
        status: 'active',
        cancelAtPeriodEnd: true,
        canceledAt: null,
      })

      const res = await authRequest(`/subscriptions/${subscription.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      }, rawToken)

      expect(res.status).toBe(200)
      expect(mockCancelSubscription).toHaveBeenCalledWith('sub_test123', true) // atPeriodEnd = true

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.subscription.cancelAtPeriodEnd).toBe(true)
    })

    it('cancels Stripe subscription immediately when immediate=true', async () => {
      const { user: creator, rawToken } = await createTestCreatorWithSession()
      const { user: subscriber } = await createTestSubscriber()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        stripeSubscriptionId: 'sub_test123',
      })

      const canceledAt = new Date()
      mockCancelSubscription.mockResolvedValue({
        status: 'canceled',
        cancelAtPeriodEnd: false,
        canceledAt,
      })

      const res = await authRequest(`/subscriptions/${subscription.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ immediate: true }),
      }, rawToken)

      expect(res.status).toBe(200)
      expect(mockCancelSubscription).toHaveBeenCalledWith('sub_test123', false) // atPeriodEnd = false

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.subscription.status).toBe('canceled')
    })

    it('cancels Paystack subscription locally (no Stripe ID)', async () => {
      const { user: creator, rawToken } = await createTestCreatorWithSession()
      const { user: subscriber } = await createTestSubscriber()

      const subscription = await createTestSubscription(creator.id, subscriber.id)
      // No stripeSubscriptionId = Paystack

      const res = await authRequest(`/subscriptions/${subscription.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      }, rawToken)

      expect(res.status).toBe(200)
      expect(mockCancelSubscription).not.toHaveBeenCalled()

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.subscription.cancelAtPeriodEnd).toBe(true)
    })

    it('handles Stripe cancellation failure', async () => {
      const { user: creator, rawToken } = await createTestCreatorWithSession()
      const { user: subscriber } = await createTestSubscriber()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        stripeSubscriptionId: 'sub_test123',
      })

      mockCancelSubscription.mockRejectedValue(new Error('Stripe API error'))

      const res = await authRequest(`/subscriptions/${subscription.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      }, rawToken)

      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toContain('Failed to cancel')
    })
  })

  describe('POST /subscriptions/:id/reactivate', () => {
    it('requires authentication', async () => {
      const res = await publicRequest('/subscriptions/00000000-0000-0000-0000-000000000000/reactivate', {
        method: 'POST',
      })
      expect(res.status).toBe(401)
    })

    it('returns 404 for non-existent subscription', async () => {
      const { rawToken } = await createTestCreatorWithSession()

      const res = await authRequest('/subscriptions/00000000-0000-0000-0000-000000000000/reactivate', {
        method: 'POST',
      }, rawToken)
      expect(res.status).toBe(404)
    })

    it('returns 400 for subscription not set to cancel', async () => {
      const { user: creator, rawToken } = await createTestCreatorWithSession()
      const { user: subscriber } = await createTestSubscriber()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        cancelAtPeriodEnd: false,
      })

      const res = await authRequest(`/subscriptions/${subscription.id}/reactivate`, {
        method: 'POST',
      }, rawToken)
      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.error).toContain('not set to cancel')
    })

    it('returns 400 for already canceled subscription', async () => {
      const { user: creator, rawToken } = await createTestCreatorWithSession()
      const { user: subscriber } = await createTestSubscriber()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        status: 'canceled',
        cancelAtPeriodEnd: true,
      })

      const res = await authRequest(`/subscriptions/${subscription.id}/reactivate`, {
        method: 'POST',
      }, rawToken)
      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.error).toContain('Cannot reactivate')
    })

    it('reactivates Stripe subscription', async () => {
      const { user: creator, rawToken } = await createTestCreatorWithSession()
      const { user: subscriber } = await createTestSubscriber()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        stripeSubscriptionId: 'sub_test123',
        cancelAtPeriodEnd: true,
      })

      mockReactivateSubscription.mockResolvedValue({
        status: 'active',
        cancelAtPeriodEnd: false,
      })

      const res = await authRequest(`/subscriptions/${subscription.id}/reactivate`, {
        method: 'POST',
      }, rawToken)

      expect(res.status).toBe(200)
      expect(mockReactivateSubscription).toHaveBeenCalledWith('sub_test123')

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.subscription.cancelAtPeriodEnd).toBe(false)
    })

    it('reactivates Paystack subscription locally', async () => {
      const { user: creator, rawToken } = await createTestCreatorWithSession()
      const { user: subscriber } = await createTestSubscriber()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        cancelAtPeriodEnd: true,
      })

      const res = await authRequest(`/subscriptions/${subscription.id}/reactivate`, {
        method: 'POST',
      }, rawToken)

      expect(res.status).toBe(200)
      expect(mockReactivateSubscription).not.toHaveBeenCalled()

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.subscription.cancelAtPeriodEnd).toBe(false)
    })

    it('handles Stripe reactivation failure', async () => {
      const { user: creator, rawToken } = await createTestCreatorWithSession()
      const { user: subscriber } = await createTestSubscriber()

      const subscription = await createTestSubscription(creator.id, subscriber.id, {
        stripeSubscriptionId: 'sub_test123',
        cancelAtPeriodEnd: true,
      })

      mockReactivateSubscription.mockRejectedValue(new Error('Stripe API error'))

      const res = await authRequest(`/subscriptions/${subscription.id}/reactivate`, {
        method: 'POST',
      }, rawToken)

      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toContain('Failed to reactivate')
    })
  })
})
