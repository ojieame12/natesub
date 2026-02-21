/**
 * Subscriber Portal Tests
 *
 * Tests for the public subscriber portal including:
 * - CSRF protection on state-changing routes
 * - Gross amount calculations (what subscriber paid, not creator net)
 * - paymentCount in list responses
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import app from '../../src/app.js'
import { sign } from 'hono/jwt'
import { dbStorage, redisMock } from '../setup.js'

const SUBSCRIBER_SESSION_SECRET = process.env.JWT_SECRET + '_subscriber_portal'

// Helper to create a valid subscriber session token
async function createSubscriberSession(email: string): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  return sign(
    { email, type: 'subscriber_portal', exp: expiresAt },
    SUBSCRIBER_SESSION_SECRET
  )
}

describe('Subscriber Portal', () => {
  beforeEach(() => {
    // Clear storage
    dbStorage.users.clear()
    dbStorage.subscriptions.clear()
    dbStorage.payments.clear()
    dbStorage.profiles.clear()
    redisMock.clear()
  })

  describe('CSRF Protection', () => {
    it('blocks cancel request with invalid origin in production', async () => {
      // Set production mode
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      try {
        const token = await createSubscriberSession('subscriber@test.com')

        const res = await app.fetch(
          new Request('http://localhost/subscriber/subscriptions/sub_123/cancel', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': `subscriber_session=${token}`,
              'Origin': 'https://malicious-site.com',
            },
            body: JSON.stringify({ reason: 'too_expensive' }),
          })
        )

        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body.code).toBe('CSRF_BLOCKED')
      } finally {
        process.env.NODE_ENV = originalEnv
      }
    })

    it('allows cancel request with valid natepay.co origin', async () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      // Create test user and subscription
      const userId = 'user_subscriber'
      const creatorId = 'user_creator'
      const subId = 'sub_test_123'

      dbStorage.users.set(userId, {
        id: userId,
        email: 'subscriber@test.com',
        role: 'user',
      })
      dbStorage.users.set(creatorId, {
        id: creatorId,
        email: 'creator@test.com',
        role: 'creator',
      })
      dbStorage.profiles.set(creatorId, {
        id: 'profile_1',
        userId: creatorId,
        displayName: 'Test Creator',
        username: 'testcreator',
      })
      dbStorage.subscriptions.set(subId, {
        id: subId,
        subscriberId: userId,
        creatorId: creatorId,
        status: 'active',
        amount: 1000,
        currency: 'USD',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })

      try {
        const token = await createSubscriberSession('subscriber@test.com')

        const res = await app.fetch(
          new Request('http://localhost/subscriber/subscriptions/sub_test_123/cancel', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': `subscriber_session=${token}`,
              'Origin': 'https://natepay.co',
            },
            body: JSON.stringify({ reason: 'too_expensive' }),
          })
        )

        // Should not be blocked by CSRF (may fail for other reasons like Stripe)
        expect(res.status).not.toBe(403)
      } finally {
        process.env.NODE_ENV = originalEnv
      }
    })

    it('allows requests in development without origin check', async () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'test' // Not production

      try {
        const token = await createSubscriberSession('subscriber@test.com')

        const res = await app.fetch(
          new Request('http://localhost/subscriber/subscriptions/sub_123/cancel', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': `subscriber_session=${token}`,
              'Origin': 'https://any-origin.com',
            },
            body: JSON.stringify({ reason: 'too_expensive' }),
          })
        )

        // Should not be blocked by CSRF in dev
        expect(res.status).not.toBe(403)
      } finally {
        process.env.NODE_ENV = originalEnv
      }
    })

    it('blocks verify request with invalid origin in production', async () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      try {
        const res = await app.fetch(
          new Request('http://localhost/subscriber/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Origin': 'https://phishing-site.com',
            },
            body: JSON.stringify({ email: 'test@test.com', otp: '123456' }),
          })
        )

        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body.code).toBe('CSRF_BLOCKED')
      } finally {
        process.env.NODE_ENV = originalEnv
      }
    })

    it('blocks startsWith bypass attack (natepay.co.evil.com)', async () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      try {
        const res = await app.fetch(
          new Request('http://localhost/subscriber/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Origin': 'https://natepay.co.evil.com',
            },
            body: JSON.stringify({ email: 'test@test.com', otp: '123456' }),
          })
        )

        // This MUST be blocked - was previously bypassing startsWith check
        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body.code).toBe('CSRF_BLOCKED')
      } finally {
        process.env.NODE_ENV = originalEnv
      }
    })

    it('blocks referer startsWith bypass attack', async () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      try {
        const res = await app.fetch(
          new Request('http://localhost/subscriber/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // No Origin header, fall back to Referer
              'Referer': 'https://natepay.co.evil.com/phishing',
            },
            body: JSON.stringify({ email: 'test@test.com', otp: '123456' }),
          })
        )

        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body.code).toBe('CSRF_BLOCKED')
      } finally {
        process.env.NODE_ENV = originalEnv
      }
    })

    it('allows valid referer with path', async () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      try {
        const res = await app.fetch(
          new Request('http://localhost/subscriber/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Valid referer with path
              'Referer': 'https://natepay.co/subscriptions',
            },
            body: JSON.stringify({ email: 'test@test.com', otp: '123456' }),
          })
        )

        // Should not be blocked by CSRF (may fail for other reasons)
        expect(res.status).not.toBe(403)
      } finally {
        process.env.NODE_ENV = originalEnv
      }
    })
  })

  describe('Gross Amount Calculations', () => {
    it('returns totalPaid as sum of gross amounts, not net', async () => {
      const userId = 'user_sub'
      const creatorId = 'user_creator'
      const subId = 'sub_gross_test'

      // Create user
      dbStorage.users.set(userId, {
        id: userId,
        email: 'subscriber@test.com',
        role: 'user',
      })
      dbStorage.users.set(creatorId, {
        id: creatorId,
        email: 'creator@test.com',
        role: 'creator',
      })
      dbStorage.profiles.set(creatorId, {
        id: 'profile_1',
        userId: creatorId,
        displayName: 'Creator',
        username: 'creator',
      })

      // Create subscription with ltvCents (net) different from gross
      dbStorage.subscriptions.set(subId, {
        id: subId,
        subscriberId: userId,
        creatorId: creatorId,
        status: 'active',
        amount: 1000,
        currency: 'USD',
        ltvCents: 1800, // Net amount (what creator earned)
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })

      // Create payments with gross amounts
      dbStorage.payments.set('pay_1', {
        id: 'pay_1',
        subscriptionId: subId,
        userId: creatorId,
        subscriberId: userId,
        status: 'succeeded',
        grossCents: 1100, // What subscriber paid (amount + fee)
        amountCents: 1000,
        subscriberFeeCents: 100,
        netCents: 900,
        currency: 'USD',
        createdAt: new Date(),
      })
      dbStorage.payments.set('pay_2', {
        id: 'pay_2',
        subscriptionId: subId,
        userId: creatorId,
        subscriberId: userId,
        status: 'succeeded',
        grossCents: 1100,
        amountCents: 1000,
        subscriberFeeCents: 100,
        netCents: 900,
        currency: 'USD',
        createdAt: new Date(),
      })

      const token = await createSubscriberSession('subscriber@test.com')

      const res = await app.fetch(
        new Request('http://localhost/subscriber/subscriptions', {
          headers: {
            'Cookie': `subscriber_session=${token}`,
          },
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      // totalPaid should be sum of grossCents (2200), not ltvCents (1800)
      const sub = body.subscriptions[0]
      expect(sub.totalPaid).toBe(22) // $22.00 (2200 cents)
      expect(sub.paymentCount).toBe(2)
    })

    it('falls back to amountCents + subscriberFeeCents when grossCents is null', async () => {
      const userId = 'user_legacy'
      const creatorId = 'user_creator'
      const subId = 'sub_legacy'

      dbStorage.users.set(userId, {
        id: userId,
        email: 'legacy@test.com',
        role: 'user',
      })
      dbStorage.users.set(creatorId, {
        id: creatorId,
        email: 'creator@test.com',
        role: 'creator',
      })
      dbStorage.profiles.set(creatorId, {
        id: 'profile_1',
        userId: creatorId,
        displayName: 'Creator',
        username: 'creator',
      })

      dbStorage.subscriptions.set(subId, {
        id: subId,
        subscriberId: userId,
        creatorId: creatorId,
        status: 'active',
        amount: 1000,
        currency: 'USD',
        ltvCents: 900,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })

      // Legacy payment without grossCents
      dbStorage.payments.set('pay_legacy', {
        id: 'pay_legacy',
        subscriptionId: subId,
        userId: creatorId,
        subscriberId: userId,
        status: 'succeeded',
        grossCents: null, // Legacy - no grossCents
        amountCents: 1000,
        subscriberFeeCents: 100,
        netCents: 900,
        currency: 'USD',
        createdAt: new Date(),
      })

      const token = await createSubscriberSession('legacy@test.com')

      const res = await app.fetch(
        new Request('http://localhost/subscriber/subscriptions', {
          headers: {
            'Cookie': `subscriber_session=${token}`,
          },
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      // Should fall back to amountCents + subscriberFeeCents = 1100
      const sub = body.subscriptions[0]
      expect(sub.totalPaid).toBe(11) // $11.00
    })
  })

  describe('paymentCount in list response', () => {
    it('includes paymentCount in subscription list', async () => {
      const userId = 'user_count'
      const creatorId = 'user_creator'
      const subId = 'sub_count'

      dbStorage.users.set(userId, {
        id: userId,
        email: 'counter@test.com',
        role: 'user',
      })
      dbStorage.users.set(creatorId, {
        id: creatorId,
        email: 'creator@test.com',
        role: 'creator',
      })
      dbStorage.profiles.set(creatorId, {
        id: 'profile_1',
        userId: creatorId,
        displayName: 'Creator',
        username: 'creator',
      })

      dbStorage.subscriptions.set(subId, {
        id: subId,
        subscriberId: userId,
        creatorId: creatorId,
        status: 'active',
        amount: 500,
        currency: 'USD',
        ltvCents: 1500,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })

      // Create 3 payments
      for (let i = 1; i <= 3; i++) {
        dbStorage.payments.set(`pay_${i}`, {
          id: `pay_${i}`,
          subscriptionId: subId,
          userId: creatorId,
          subscriberId: userId,
          status: 'succeeded',
          grossCents: 550,
          amountCents: 500,
          subscriberFeeCents: 50,
          netCents: 450,
          currency: 'USD',
          createdAt: new Date(),
        })
      }

      const token = await createSubscriberSession('counter@test.com')

      const res = await app.fetch(
        new Request('http://localhost/subscriber/subscriptions', {
          headers: {
            'Cookie': `subscriber_session=${token}`,
          },
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.subscriptions[0]).toHaveProperty('paymentCount')
      expect(body.subscriptions[0].paymentCount).toBe(3)
    })
  })

  describe('Cursor pagination', () => {
    it('returns 400 for invalid cursor', async () => {
      const userId = 'cursor_user'
      dbStorage.users.set(userId, {
        id: userId,
        email: 'cursor@test.com',
        role: 'user',
      })

      const token = await createSubscriberSession('cursor@test.com')
      const res = await app.fetch(
        new Request('http://localhost/subscriber/subscriptions?cursor=00000000-0000-0000-0000-000000000000', {
          headers: { Cookie: `subscriber_session=${token}` },
        })
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.code).toBe('INVALID_CURSOR')
    })
  })
})
