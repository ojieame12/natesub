import { beforeEach, describe, expect, it, vi, afterAll } from 'vitest'
import { createHash } from 'crypto'
import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { dbStorage } from '../setup.js'

// Mock email service
vi.mock('../../src/services/email.js', () => ({
  sendMagicLinkEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  sendNewSubscriberEmail: vi.fn(),
  sendRequestEmail: vi.fn(),
  sendUpdateEmail: vi.fn(),
}))

// Mock Stripe service
vi.mock('../../src/services/stripe.js', () => ({
  stripe: {
    webhooks: {
      constructEvent: vi.fn((body, sig, secret) => JSON.parse(body)),
    },
  },
  createCheckoutSession: vi.fn(),
}))

// Hash function matching auth service
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Helper to create a test user with session
async function createTestUserWithSession() {
  const user = await db.user.create({
    data: { email: 'creator@test.com' },
  })

  const profile = await db.profile.create({
    data: {
      userId: user.id,
      username: 'testcreator',
      displayName: 'Test Creator',
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'tips',
      pricingModel: 'single',
      singleAmount: 1000,
    },
  })

  const rawToken = 'test-session-token'
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

// Helper to make authenticated request
function authRequest(path: string, options: RequestInit = {}, rawToken = 'test-session-token') {
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

describe('activity and metrics', () => {
  beforeEach(() => {
    Object.values(dbStorage).forEach(store => store.clear())
  })

  afterAll(() => {
    Object.values(dbStorage).forEach(store => store.clear())
  })

  describe('activity feed', () => {
    it('returns activity feed for user', async () => {
      const { user } = await createTestUserWithSession()

      // Create some activities
      await db.activity.create({
        data: {
          userId: user.id,
          type: 'new_subscriber',
          payload: { subscriberName: 'John Doe' },
        },
      })
      await db.activity.create({
        data: {
          userId: user.id,
          type: 'payment_received',
          payload: { amount: 1000, currency: 'USD' },
        },
      })

      const res = await authRequest('/activity')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.activities).toHaveLength(2)
      expect(body.activities[0].type).toBeDefined()
      expect(body.activities[0].payload).toBeDefined()
    })

    it('supports pagination', async () => {
      const { user } = await createTestUserWithSession()

      // Create many activities
      for (let i = 0; i < 25; i++) {
        await db.activity.create({
          data: {
            userId: user.id,
            type: 'test_event',
            payload: { index: i },
          },
        })
      }

      const res = await authRequest('/activity?limit=10')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.activities).toHaveLength(10)
      expect(body.nextCursor).toBeDefined()
    })
  })

  describe('single activity', () => {
    it('returns single activity by id', async () => {
      const { user } = await createTestUserWithSession()

      const activity = await db.activity.create({
        data: {
          userId: user.id,
          type: 'request_accepted',
          payload: { requestId: 'req-123', amount: 2000 },
        },
      })

      const res = await authRequest(`/activity/${activity.id}`)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.activity.id).toBe(activity.id)
      expect(body.activity.type).toBe('request_accepted')
    })

    it('returns 404 for non-existent activity', async () => {
      await createTestUserWithSession()

      const res = await authRequest('/activity/00000000-0000-0000-0000-000000000000')

      expect(res.status).toBe(404)
    })
  })

  describe('dashboard metrics', () => {
    it('returns metrics with zero values for new creator', async () => {
      await createTestUserWithSession()

      const res = await authRequest('/activity/metrics')
      const body = await res.json()

      // Debug: log the response if not 200
      if (res.status !== 200) {
        console.log('Metrics error:', body)
      }

      expect(res.status).toBe(200)
      expect(body.metrics.subscriberCount).toBe(0)
      expect(body.metrics.mrrCents).toBe(0)
      expect(body.metrics.mrr).toBe(0)
      expect(body.metrics.totalRevenueCents).toBe(0)
    })

    it('calculates metrics with active subscriptions', async () => {
      const { user } = await createTestUserWithSession()

      // Create subscribers
      const sub1 = await db.user.create({ data: { email: 'sub1@test.com' } })
      const sub2 = await db.user.create({ data: { email: 'sub2@test.com' } })

      // Create active subscriptions (monthly)
      await db.subscription.create({
        data: {
          creatorId: user.id,
          subscriberId: sub1.id,
          amount: 1000, // $10/month
          currency: 'USD',
          interval: 'month',
          status: 'active',
          tierName: 'Basic',
        },
      })
      await db.subscription.create({
        data: {
          creatorId: user.id,
          subscriberId: sub2.id,
          amount: 2500, // $25/month
          currency: 'USD',
          interval: 'month',
          status: 'active',
          tierName: 'VIP',
        },
      })

      // Create some payments
      await db.payment.create({
        data: {
          creatorId: user.id,
          amountCents: 1000,
          currency: 'USD',
          feeCents: 100,
          netCents: 900,
          type: 'recurring',
          status: 'succeeded',
        },
      })

      const res = await authRequest('/activity/metrics')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.metrics.subscriberCount).toBe(2)
      expect(body.metrics.mrrCents).toBe(3500) // $10 + $25 = $35
      expect(body.metrics.mrr).toBe(35)
      expect(body.metrics.totalRevenueCents).toBe(900) // net from payment
      expect(body.metrics.tierBreakdown).toEqual({
        Basic: 1,
        VIP: 1,
      })
    })

    it('excludes canceled subscriptions from metrics', async () => {
      const { user } = await createTestUserWithSession()

      const sub1 = await db.user.create({ data: { email: 'sub1@test.com' } })

      // Create canceled subscription
      await db.subscription.create({
        data: {
          creatorId: user.id,
          subscriberId: sub1.id,
          amount: 1000,
          currency: 'USD',
          interval: 'month',
          status: 'canceled',
        },
      })

      const res = await authRequest('/activity/metrics')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.metrics.subscriberCount).toBe(0)
      expect(body.metrics.mrrCents).toBe(0)
    })
  })
})
