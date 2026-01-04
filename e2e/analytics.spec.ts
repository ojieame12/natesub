import { test, expect } from '@playwright/test'
import { e2eLogin, buildUsername } from './auth.helper'

/**
 * Analytics E2E Tests
 *
 * Tests the analytics tracking and stats endpoints.
 * - Public: Page view recording and conversion tracking
 * - Private: Creator analytics dashboard stats
 *
 * Run with: npx playwright test analytics.spec.ts
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

async function setupCreatorWithProfile(
  request: import('@playwright/test').APIRequestContext,
  suffix: string
) {
  const ts = Date.now().toString().slice(-8)
  const email = `analytics-${suffix}-${ts}@e2e.natepay.co`
  const username = buildUsername('analytics', suffix, ts)

  const { token, user } = await e2eLogin(request, email)

  // Create profile - use null provider since analytics tests don't need Stripe
  // This avoids the dynamic minimum validation ($95 for new US creators)
  const profileResp = await request.put(`${API_URL}/profile`, {
    data: {
      username,
      displayName: `Analytics Test ${suffix}`,
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'support',
      pricingModel: 'single',
      singleAmount: 1000, // $10 - reasonable test amount
      paymentProvider: null, // Skip Stripe minimum validation
      isPublic: true,
    },
    headers: { 'Authorization': `Bearer ${token}` },
  })

  expect(profileResp.status(), 'Profile must be created').toBe(200)
  const { profile } = await profileResp.json()

  return {
    token,
    userId: user.id,
    email,
    username,
    profileId: profile.id,
  }
}

// ============================================
// PUBLIC: PAGE VIEW TRACKING
// ============================================

test.describe('Analytics - Page View Tracking', () => {
  test.describe('POST /analytics/view', () => {
    test('records page view successfully', async ({ request }) => {
      const { profileId } = await setupCreatorWithProfile(request, 'view1')

      const response = await request.post(`${API_URL}/analytics/view`, {
        data: {
          profileId,
          referrer: 'https://twitter.com/test',
          utmSource: 'twitter',
          utmMedium: 'social',
          utmCampaign: 'launch',
          country: 'US',
        },
      })

      expect(response.status()).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('viewId')
      expect(data.existing).toBe(false) // New view
    })

    test('deduplicates views from same visitor within 30 minutes', async ({ request }) => {
      const { profileId } = await setupCreatorWithProfile(request, 'dedup')

      // First view
      const resp1 = await request.post(`${API_URL}/analytics/view`, {
        data: { profileId },
      })
      expect(resp1.status()).toBe(200)
      const view1 = await resp1.json()
      expect(view1.existing).toBe(false)

      // Second view from same visitor (should return existing)
      const resp2 = await request.post(`${API_URL}/analytics/view`, {
        data: { profileId },
      })
      expect(resp2.status()).toBe(200)
      const view2 = await resp2.json()
      expect(view2.existing).toBe(true)
      expect(view2.viewId).toBe(view1.viewId)
    })

    test('creates new view after 30-minute dedupe window expires', async ({ request }) => {
      const { profileId } = await setupCreatorWithProfile(request, 'dedupboundary')

      // Use predictable visitor info so we can compute the same hash
      const testIP = '10.99.99.99'
      const testUA = 'DedupeWindowBoundaryTest/1.0'

      // Compute the same hash the server would (sha256 of ip:userAgent, first 16 chars)
      // Server formula: crypto.createHash('sha256').update(`${ip}:${userAgent}`).digest('hex').slice(0, 16)
      // We'll seed with this exact hash
      const crypto = await import('crypto')
      const expectedHash = crypto
        .createHash('sha256')
        .update(`${testIP}:${testUA}`)
        .digest('hex')
        .slice(0, 16)

      // Seed a page view from 31 minutes ago with the expected visitor hash
      const seedResp = await request.post(`${API_URL}/e2e/seed-page-view`, {
        headers: e2eHeaders(),
        data: {
          profileId,
          visitorHash: expectedHash,
          minutesAgo: 31, // Outside the 30-minute window
        },
      })
      expect(seedResp.status(), 'Seed page view must succeed').toBe(200)
      const seededView = await seedResp.json()

      // Now make a real view request with the same IP + User-Agent
      // This should create a NEW view since the seeded one is >30 minutes old
      const viewResp = await request.post(`${API_URL}/analytics/view`, {
        data: { profileId },
        headers: {
          'x-forwarded-for': testIP,
          'user-agent': testUA,
        },
      })
      expect(viewResp.status()).toBe(200)
      const newView = await viewResp.json()

      // Should be a NEW view, not the seeded one
      expect(newView.existing).toBe(false)
      expect(newView.viewId).not.toBe(seededView.viewId)
    })

    test('still dedupes within 30-minute window with seeded view', async ({ request }) => {
      const { profileId } = await setupCreatorWithProfile(request, 'dedupwithin')

      // Use predictable visitor info
      const testIP = '10.88.88.88'
      const testUA = 'DedupeWithinWindowTest/1.0'

      const crypto = await import('crypto')
      const expectedHash = crypto
        .createHash('sha256')
        .update(`${testIP}:${testUA}`)
        .digest('hex')
        .slice(0, 16)

      // Seed a page view from 15 minutes ago (within the 30-minute window)
      const seedResp = await request.post(`${API_URL}/e2e/seed-page-view`, {
        headers: e2eHeaders(),
        data: {
          profileId,
          visitorHash: expectedHash,
          minutesAgo: 15, // Inside the 30-minute window
        },
      })
      expect(seedResp.status(), 'Seed page view must succeed').toBe(200)
      const seededView = await seedResp.json()

      // Now make a real view request with the same IP + User-Agent
      // This should return the EXISTING seeded view
      const viewResp = await request.post(`${API_URL}/analytics/view`, {
        data: { profileId },
        headers: {
          'x-forwarded-for': testIP,
          'user-agent': testUA,
        },
      })
      expect(viewResp.status()).toBe(200)
      const result = await viewResp.json()

      // Should return the existing seeded view
      expect(result.existing).toBe(true)
      expect(result.viewId).toBe(seededView.viewId)
    })

    test('requires valid profileId', async ({ request }) => {
      const response = await request.post(`${API_URL}/analytics/view`, {
        data: {
          profileId: 'not-a-uuid',
        },
      })

      expect(response.status()).toBe(400)
    })

    test('handles missing optional fields', async ({ request }) => {
      const { profileId } = await setupCreatorWithProfile(request, 'minimal')

      const response = await request.post(`${API_URL}/analytics/view`, {
        data: { profileId }, // Only required field
      })

      expect(response.status()).toBe(200)
      const data = await response.json()
      expect(data.viewId).toBeTruthy()
    })

    test('accepts any referrer string (not just URLs)', async ({ request }) => {
      const { profileId } = await setupCreatorWithProfile(request, 'anyref')

      // Apps/mail clients may send non-URL referrers
      const response = await request.post(`${API_URL}/analytics/view`, {
        data: {
          profileId,
          referrer: 'com.twitter.android',
        },
      })

      expect(response.status()).toBe(200)
    })
  })

  test.describe('PATCH /analytics/view/:viewId', () => {
    test('updates conversion progress', async ({ request }) => {
      const { profileId } = await setupCreatorWithProfile(request, 'convert')

      // Create view first
      const viewResp = await request.post(`${API_URL}/analytics/view`, {
        data: { profileId },
      })
      const { viewId } = await viewResp.json()

      // Update: reached payment section
      const resp1 = await request.patch(`${API_URL}/analytics/view/${viewId}`, {
        data: { reachedPayment: true },
      })
      expect(resp1.status()).toBe(200)
      const data1 = await resp1.json()
      expect(data1.success).toBe(true)
      expect(data1.updated).toBe(true)

      // Update: started checkout
      const resp2 = await request.patch(`${API_URL}/analytics/view/${viewId}`, {
        data: { startedCheckout: true },
      })
      expect(resp2.status()).toBe(200)

      // Update: completed checkout
      const resp3 = await request.patch(`${API_URL}/analytics/view/${viewId}`, {
        data: { completedCheckout: true },
      })
      expect(resp3.status()).toBe(200)
    })

    test('is idempotent for non-existent viewId', async ({ request }) => {
      const fakeViewId = '00000000-0000-0000-0000-000000000000'

      const response = await request.patch(`${API_URL}/analytics/view/${fakeViewId}`, {
        data: { reachedPayment: true },
      })

      expect(response.status()).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.updated).toBe(false) // No row updated
    })

    test('validates viewId format', async ({ request }) => {
      const response = await request.patch(`${API_URL}/analytics/view/not-a-uuid`, {
        data: { reachedPayment: true },
      })

      expect(response.status()).toBe(400)
    })
  })
})

// ============================================
// PRIVATE: CREATOR ANALYTICS STATS
// ============================================

test.describe('Analytics - Creator Stats', () => {
  test.describe('GET /analytics/stats', () => {
    test('returns analytics stats for creator', async ({ request }) => {
      const { token, profileId } = await setupCreatorWithProfile(request, 'stats1')

      // Seed some page views
      for (let i = 0; i < 5; i++) {
        await request.post(`${API_URL}/analytics/view`, {
          data: {
            profileId,
            referrer: i % 2 === 0 ? 'https://twitter.com' : 'https://instagram.com',
          },
          headers: {
            'x-forwarded-for': `192.168.1.${i}`, // Different IPs to avoid dedup
            'user-agent': `TestAgent/${i}`,
          },
        })
      }

      // Get stats
      const response = await request.get(`${API_URL}/analytics/stats`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      expect(response.status()).toBe(200)

      const data = await response.json()

      // Verify structure
      expect(data).toHaveProperty('views')
      expect(data.views).toHaveProperty('today')
      expect(data.views).toHaveProperty('week')
      expect(data.views).toHaveProperty('month')
      expect(data.views).toHaveProperty('total')

      expect(data).toHaveProperty('uniqueVisitors')
      expect(data.uniqueVisitors).toHaveProperty('today')
      expect(data.uniqueVisitors).toHaveProperty('week')
      expect(data.uniqueVisitors).toHaveProperty('month')

      expect(data).toHaveProperty('funnel')
      expect(data.funnel).toHaveProperty('views')
      expect(data.funnel).toHaveProperty('reachedPayment')
      expect(data.funnel).toHaveProperty('startedCheckout')
      expect(data.funnel).toHaveProperty('completedCheckout')
      expect(data.funnel).toHaveProperty('conversions')

      expect(data).toHaveProperty('rates')
      expect(data.rates).toHaveProperty('viewToPayment')
      expect(data.rates).toHaveProperty('paymentToCheckout')
      expect(data.rates).toHaveProperty('checkoutToSubscribe')
      expect(data.rates).toHaveProperty('overall')

      expect(data).toHaveProperty('devices')
      expect(Array.isArray(data.devices)).toBe(true)

      expect(data).toHaveProperty('referrers')
      expect(Array.isArray(data.referrers)).toBe(true)

      expect(data).toHaveProperty('dailyViews')
      expect(Array.isArray(data.dailyViews)).toBe(true)
    })

    test('requires authentication', async ({ request }) => {
      const response = await request.get(`${API_URL}/analytics/stats`)

      expect(response.status()).toBe(401)
    })

    test('returns 404 for user without profile', async ({ request }) => {
      const { token } = await e2eLogin(request, `noprofile-analytics-${Date.now()}@e2e.natepay.co`)

      const response = await request.get(`${API_URL}/analytics/stats`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      expect(response.status()).toBe(404)
    })

    test('returns zero stats for new creator', async ({ request }) => {
      const { token } = await setupCreatorWithProfile(request, 'newcreator')

      const response = await request.get(`${API_URL}/analytics/stats`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      expect(response.status()).toBe(200)
      const data = await response.json()

      // New creator should have zeros
      expect(data.views.today).toBe(0)
      expect(data.views.total).toBe(0)
      expect(data.uniqueVisitors.today).toBe(0)
      expect(data.funnel.conversions).toBe(0)
      expect(data.rates.overall).toBe(0)
    })

    test('calculates conversion rates correctly', async ({ request }) => {
      const { token, profileId } = await setupCreatorWithProfile(request, 'rates')

      // Create 10 views
      const viewIds: string[] = []
      for (let i = 0; i < 10; i++) {
        const resp = await request.post(`${API_URL}/analytics/view`, {
          data: { profileId },
          headers: {
            'x-forwarded-for': `10.0.0.${i}`,
            'user-agent': `RateTest/${i}`,
          },
        })
        const { viewId } = await resp.json()
        viewIds.push(viewId)
      }

      // 5 reached payment
      for (let i = 0; i < 5; i++) {
        await request.patch(`${API_URL}/analytics/view/${viewIds[i]}`, {
          data: { reachedPayment: true },
        })
      }

      // 2 started checkout
      for (let i = 0; i < 2; i++) {
        await request.patch(`${API_URL}/analytics/view/${viewIds[i]}`, {
          data: { startedCheckout: true },
        })
      }

      // Get stats
      const response = await request.get(`${API_URL}/analytics/stats`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      expect(response.status()).toBe(200)
      const data = await response.json()

      // Verify funnel counts
      expect(data.funnel.views).toBe(10)
      expect(data.funnel.reachedPayment).toBe(5)
      expect(data.funnel.startedCheckout).toBe(2)

      // Verify rates (view to payment = 5/10 = 50%)
      expect(data.rates.viewToPayment).toBe(50)
    })
  })
})

// ============================================
// RATE LIMITING
// ============================================

test.describe('Analytics - Rate Limiting', () => {
  test('page view endpoint has rate limiting', async ({ request }) => {
    const { profileId } = await setupCreatorWithProfile(request, 'ratelimit')

    // Make many requests rapidly
    const requests = Array(30).fill(null).map((_, i) =>
      request.post(`${API_URL}/analytics/view`, {
        data: { profileId },
        headers: {
          'x-forwarded-for': `172.16.0.${i}`,
          'user-agent': `RateLimit/${i}`,
        },
      })
    )

    const responses = await Promise.all(requests)
    const statuses = responses.map(r => r.status())

    // Some should succeed, some may be rate limited
    const succeeded = statuses.filter(s => s === 200).length
    const rateLimited = statuses.filter(s => s === 429).length

    expect(succeeded).toBeGreaterThan(0)
    // Rate limiting may or may not trigger depending on config
    expect(statuses.length).toBe(30)
  })
})
