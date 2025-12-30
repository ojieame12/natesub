import { beforeEach, describe, expect, it, vi, afterAll } from 'vitest'
import { createHmac } from 'crypto'
import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { dbStorage } from '../setup.js'
import { env } from '../../src/config/env.js'

// Hash function matching auth service
function hashToken(token: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex')
}

// Helper to create a test user with session
async function createTestUserWithSession() {
  const user = await db.user.create({
    data: { email: `analytics-test-${Date.now()}@test.com` },
  })

  const profile = await db.profile.create({
    data: {
      userId: user.id,
      username: `analyticsuser${Date.now()}`,
      displayName: 'Analytics Test User',
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

  const rawToken = `test-session-${Date.now()}`
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

// Helper to make public request with custom headers
function publicRequest(path: string, options: RequestInit = {}, headers: Record<string, string> = {}) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        ...options.headers,
      },
    })
  )
}

describe('analytics routes', () => {
  beforeEach(() => {
    Object.values(dbStorage).forEach(store => store.clear())
  })

  afterAll(() => {
    Object.values(dbStorage).forEach(store => store.clear())
  })

  describe('POST /analytics/view', () => {
    it('records a page view with UTM params', async () => {
      const { profile } = await createTestUserWithSession()

      const res = await publicRequest('/analytics/view', {
        method: 'POST',
        body: JSON.stringify({
          profileId: profile.id,
          utmSource: 'twitter',
          utmMedium: 'social',
          utmCampaign: 'launch',
        }),
      }, {
        'x-forwarded-for': '192.168.1.100',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.viewId).toBeDefined()
      expect(body.existing).toBe(false)

      // Verify page view was created
      const pageView = await db.pageView.findUnique({ where: { id: body.viewId } })
      expect(pageView).toBeDefined()
      expect(pageView?.profileId).toBe(profile.id)
      expect(pageView?.utmSource).toBe('twitter')
      expect(pageView?.utmMedium).toBe('social')
      expect(pageView?.utmCampaign).toBe('launch')
      expect(pageView?.deviceType).toBe('desktop')
    })

    it('detects mobile device from user agent', async () => {
      const { profile } = await createTestUserWithSession()

      const res = await publicRequest('/analytics/view', {
        method: 'POST',
        body: JSON.stringify({ profileId: profile.id }),
      }, {
        'x-forwarded-for': '10.0.0.1',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
      })

      expect(res.status).toBe(200)
      const body = await res.json()

      const pageView = await db.pageView.findUnique({ where: { id: body.viewId } })
      expect(pageView?.deviceType).toBe('mobile')
    })

    it('detects tablet device from user agent', async () => {
      const { profile } = await createTestUserWithSession()

      const res = await publicRequest('/analytics/view', {
        method: 'POST',
        body: JSON.stringify({ profileId: profile.id }),
      }, {
        'x-forwarded-for': '10.0.0.2',
        'user-agent': 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X)',
      })

      expect(res.status).toBe(200)
      const body = await res.json()

      const pageView = await db.pageView.findUnique({ where: { id: body.viewId } })
      expect(pageView?.deviceType).toBe('tablet')
    })

    it('returns existing viewId for same visitor within 30 minutes', async () => {
      const { profile } = await createTestUserWithSession()

      // First view
      const res1 = await publicRequest('/analytics/view', {
        method: 'POST',
        body: JSON.stringify({ profileId: profile.id }),
      }, {
        'x-forwarded-for': '192.168.1.50',
        'user-agent': 'Mozilla/5.0 Chrome/91.0',
      })

      expect(res1.status).toBe(200)
      const body1 = await res1.json()
      expect(body1.viewId).toBeDefined()
      expect(body1.existing).toBe(false)

      // Second view from same visitor (same IP + UA)
      const res2 = await publicRequest('/analytics/view', {
        method: 'POST',
        body: JSON.stringify({ profileId: profile.id }),
      }, {
        'x-forwarded-for': '192.168.1.50',
        'user-agent': 'Mozilla/5.0 Chrome/91.0',
      })

      expect(res2.status).toBe(200)
      const body2 = await res2.json()
      expect(body2.viewId).toBe(body1.viewId)
      expect(body2.existing).toBe(true)
    })

    it('creates new view for different visitor', async () => {
      const { profile } = await createTestUserWithSession()

      // First visitor
      const res1 = await publicRequest('/analytics/view', {
        method: 'POST',
        body: JSON.stringify({ profileId: profile.id }),
      }, {
        'x-forwarded-for': '10.0.0.1',
        'user-agent': 'Mozilla/5.0 Chrome/91.0',
      })

      // Different visitor (different IP)
      const res2 = await publicRequest('/analytics/view', {
        method: 'POST',
        body: JSON.stringify({ profileId: profile.id }),
      }, {
        'x-forwarded-for': '10.0.0.2',
        'user-agent': 'Mozilla/5.0 Chrome/91.0',
      })

      const body1 = await res1.json()
      const body2 = await res2.json()

      expect(body1.viewId).not.toBe(body2.viewId)
      expect(body2.existing).toBe(false)
    })

    it('records referrer URL', async () => {
      const { profile } = await createTestUserWithSession()

      const res = await publicRequest('/analytics/view', {
        method: 'POST',
        body: JSON.stringify({
          profileId: profile.id,
          referrer: 'https://twitter.com/status/12345',
        }),
      }, {
        'x-forwarded-for': '192.168.1.1',
        'user-agent': 'Chrome',
      })

      expect(res.status).toBe(200)
      const body = await res.json()

      const pageView = await db.pageView.findUnique({ where: { id: body.viewId } })
      expect(pageView?.referrer).toBe('https://twitter.com/status/12345')
    })

    it('rejects invalid profileId', async () => {
      const res = await publicRequest('/analytics/view', {
        method: 'POST',
        body: JSON.stringify({ profileId: 'not-a-uuid' }),
      })

      expect(res.status).toBe(400)
    })

    it('stores country code on page view', async () => {
      const { profile } = await createTestUserWithSession()

      const res = await publicRequest('/analytics/view', {
        method: 'POST',
        body: JSON.stringify({
          profileId: profile.id,
          country: 'NG', // Nigeria
        }),
      }, {
        'x-forwarded-for': '192.168.1.200',
        'user-agent': 'Chrome',
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.viewId).toBeDefined()

      const pageView = await db.pageView.findUnique({ where: { id: body.viewId } })
      expect(pageView?.country).toBe('NG')
    })

    it('normalizes country code to uppercase', async () => {
      const { profile } = await createTestUserWithSession()

      const res = await publicRequest('/analytics/view', {
        method: 'POST',
        body: JSON.stringify({
          profileId: profile.id,
          country: 'gb', // lowercase
        }),
      }, {
        'x-forwarded-for': '192.168.1.201',
        'user-agent': 'Chrome',
      })

      expect(res.status).toBe(200)
      const body = await res.json()

      const pageView = await db.pageView.findUnique({ where: { id: body.viewId } })
      expect(pageView?.country).toBe('GB')
    })

    it('handles missing country gracefully', async () => {
      const { profile } = await createTestUserWithSession()

      const res = await publicRequest('/analytics/view', {
        method: 'POST',
        body: JSON.stringify({
          profileId: profile.id,
          // No country provided
        }),
      }, {
        'x-forwarded-for': '192.168.1.202',
        'user-agent': 'Chrome',
      })

      expect(res.status).toBe(200)
      const body = await res.json()

      const pageView = await db.pageView.findUnique({ where: { id: body.viewId } })
      expect(pageView?.country).toBeNull()
    })

    it('validates country code length', async () => {
      const { profile } = await createTestUserWithSession()

      const res = await publicRequest('/analytics/view', {
        method: 'POST',
        body: JSON.stringify({
          profileId: profile.id,
          country: 'USA', // 3 chars - invalid
        }),
      }, {
        'x-forwarded-for': '192.168.1.203',
        'user-agent': 'Chrome',
      })

      // Should fail validation
      expect(res.status).toBe(400)
    })
  })

  describe('PATCH /analytics/view/:viewId', () => {
    it('updates conversion progress', async () => {
      const { profile } = await createTestUserWithSession()

      // Create a view
      const createRes = await publicRequest('/analytics/view', {
        method: 'POST',
        body: JSON.stringify({ profileId: profile.id }),
      }, {
        'x-forwarded-for': '10.0.0.5',
        'user-agent': 'Chrome',
      })

      const { viewId } = await createRes.json()

      // Update with conversion progress
      const updateRes = await publicRequest(`/analytics/view/${viewId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          reachedPayment: true,
          startedCheckout: true,
        }),
      })

      expect(updateRes.status).toBe(200)
      const body = await updateRes.json()
      expect(body.success).toBe(true)

      // Verify update
      const pageView = await db.pageView.findUnique({ where: { id: viewId } })
      expect(pageView?.reachedPayment).toBe(true)
      expect(pageView?.startedCheckout).toBe(true)
      expect(pageView?.completedCheckout).toBeFalsy()
    })

    it('marks checkout completed', async () => {
      const { profile } = await createTestUserWithSession()

      // Create a view
      const createRes = await publicRequest('/analytics/view', {
        method: 'POST',
        body: JSON.stringify({ profileId: profile.id }),
      }, {
        'x-forwarded-for': '10.0.0.6',
        'user-agent': 'Safari',
      })

      const { viewId } = await createRes.json()

      // Update with checkout completion
      const updateRes = await publicRequest(`/analytics/view/${viewId}`, {
        method: 'PATCH',
        body: JSON.stringify({ completedCheckout: true }),
      })

      expect(updateRes.status).toBe(200)

      const pageView = await db.pageView.findUnique({ where: { id: viewId } })
      expect(pageView?.completedCheckout).toBe(true)
    })

    it('rejects invalid viewId format', async () => {
      const res = await publicRequest('/analytics/view/not-a-uuid', {
        method: 'PATCH',
        body: JSON.stringify({ reachedPayment: true }),
      })

      expect(res.status).toBe(400)
    })
  })

  describe('GET /analytics/stats', () => {
    it('requires authentication', async () => {
      const res = await publicRequest('/analytics/stats', { method: 'GET' })
      expect(res.status).toBe(401)
    })

    it('returns 404 for user without profile', async () => {
      // Create user without profile
      const user = await db.user.create({
        data: { email: 'noprofile@test.com' },
      })

      const rawToken = 'no-profile-token'
      const hashedToken = hashToken(rawToken)

      const session = await db.session.create({
        data: {
          userId: user.id,
          token: hashedToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      dbStorage.sessions.set(session.id, { ...session, user })

      const res = await authRequest('/analytics/stats', { method: 'GET' }, rawToken)
      expect(res.status).toBe(404)
    })

    it('returns analytics stats for authenticated user', async () => {
      const { profile, rawToken, user } = await createTestUserWithSession()

      // Create some page views
      await db.pageView.create({
        data: {
          profileId: profile.id,
          visitorHash: 'hash1',
          deviceType: 'desktop',
          createdAt: new Date(),
        },
      })

      await db.pageView.create({
        data: {
          profileId: profile.id,
          visitorHash: 'hash2',
          deviceType: 'mobile',
          reachedPayment: true,
          createdAt: new Date(),
        },
      })

      await db.pageView.create({
        data: {
          profileId: profile.id,
          visitorHash: 'hash3',
          deviceType: 'mobile',
          reachedPayment: true,
          startedCheckout: true,
          completedCheckout: true,
          createdAt: new Date(),
        },
      })

      const res = await authRequest('/analytics/stats', { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()

      // Verify view counts
      expect(body.views).toBeDefined()
      expect(body.views.today).toBeGreaterThanOrEqual(3)
      expect(body.views.week).toBeGreaterThanOrEqual(3)
      expect(body.views.month).toBeGreaterThanOrEqual(3)
      expect(body.views.total).toBeGreaterThanOrEqual(3)

      // Verify funnel data
      expect(body.funnel).toBeDefined()
      expect(body.funnel.reachedPayment).toBeGreaterThanOrEqual(2)
      expect(body.funnel.startedCheckout).toBeGreaterThanOrEqual(1)
      expect(body.funnel.completedCheckout).toBeGreaterThanOrEqual(1)

      // Verify rates exist
      expect(body.rates).toBeDefined()
      expect(typeof body.rates.viewToPayment).toBe('number')
      expect(typeof body.rates.overall).toBe('number')

      // Verify device breakdown
      expect(body.devices).toBeDefined()
      expect(Array.isArray(body.devices)).toBe(true)
    })

    it('returns empty stats for user with no views', async () => {
      const { rawToken } = await createTestUserWithSession()

      const res = await authRequest('/analytics/stats', { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.views.today).toBe(0)
      expect(body.views.total).toBe(0)
      expect(body.funnel.views).toBe(0)
    })

    it('calculates conversion rates correctly', async () => {
      const { profile, rawToken, user } = await createTestUserWithSession()

      // Create 10 views, 5 reached payment, 2 started checkout, 1 converted
      for (let i = 0; i < 10; i++) {
        await db.pageView.create({
          data: {
            profileId: profile.id,
            visitorHash: `visitor${i}`,
            deviceType: 'desktop',
            reachedPayment: i < 5,
            startedCheckout: i < 2,
            completedCheckout: i < 1,
            createdAt: new Date(),
          },
        })
      }

      // Create a subscription to count as conversion
      await db.subscription.create({
        data: {
          creatorId: user.id,
          subscriberId: 'sub-123',
          amount: 1000,
          currency: 'USD',
          interval: 'month',
          status: 'active',
          startedAt: new Date(),
        },
      })

      const res = await authRequest('/analytics/stats', { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()

      // Views: 10, reached payment: 5 -> 50%
      expect(body.rates.viewToPayment).toBe(50)

      // Reached payment: 5, started checkout: 2 -> 40%
      expect(body.rates.paymentToCheckout).toBe(40)

      // Conversions: 1 out of 10 views -> 10%
      expect(body.rates.overall).toBe(10)
    })
  })
})
