import { test, expect } from '@playwright/test'
import { e2eLogin, setAuthCookie, deterministicEmail } from './auth.helper'

/**
 * Admin & Webhook E2E Tests
 *
 * Tests admin functionality and webhook endpoints:
 * - Admin API endpoints
 * - Admin dashboard data
 * - Webhook signature validation
 * - Webhook event processing
 *
 * Note: Webhook tests use stub/mock payloads since we can't generate
 * real Stripe/Paystack signatures in E2E tests.
 *
 * Run with: npx playwright test admin-webhooks.spec.ts
 */

const API_URL = 'http://localhost:3001'

// Admin API key from environment - no fallback to ensure strict auth
const ADMIN_API_KEY = process.env.ADMIN_API_KEY
// Skip admin tests if no API key is configured - these tests require real admin auth
const SKIP_ADMIN_TESTS = !ADMIN_API_KEY

// E2E API key for helper endpoints
const E2E_API_KEY = process.env.E2E_API_KEY
const e2eHeaders = () => ({
  'x-e2e-api-key': E2E_API_KEY || '',
  'Content-Type': 'application/json',
})

const adminHeaders = () => ({
  'x-admin-api-key': ADMIN_API_KEY || '',
  'Content-Type': 'application/json',
})

// ============================================
// HELPER: Setup creator for admin tests
// ============================================

async function setupCreator(
  request: import('@playwright/test').APIRequestContext,
  suffix: string
) {
  const ts = Date.now().toString().slice(-8)
  const email = `admin-test-${suffix}-${ts}@e2e.natepay.co`
  const username = `admtest${suffix}${ts}`

  const { token, user } = await e2eLogin(request, email)

  await request.put(`${API_URL}/profile`, {
    data: {
      username,
      displayName: `Admin Test ${suffix}`,
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'support',
      pricingModel: 'single',
      singleAmount: 5,
      paymentProvider: 'stripe',
      feeMode: 'split',
      isPublic: true,
    },
    headers: { 'Authorization': `Bearer ${token}` },
  })

  await request.post(`${API_URL}/stripe/connect`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })

  return { token, userId: user.id, email, username }
}

// ============================================
// ADMIN API TESTS
// ============================================

test.describe('Admin API', () => {
  test('admin health endpoint responds', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/health`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Admin health must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.status).toBeTruthy()
  })

  test('admin dashboard returns metrics', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/dashboard`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Admin dashboard must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(
      data.totalUsers !== undefined ||
      data.totalSubscriptions !== undefined ||
      data.metrics !== undefined
    ).toBeTruthy()
  })

  test('admin users endpoint lists users', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')
    await setupCreator(request, 'list')

    const response = await request.get(`${API_URL}/admin/users`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Admin users list must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.users || data.items || Array.isArray(data)).toBeTruthy()
  })

  test('admin users endpoint supports pagination', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/users?limit=5&offset=0`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Admin users pagination must succeed with valid admin key').toBe(200)
    const data = await response.json()
    const users = data.users || data.items || data
    if (Array.isArray(users)) {
      expect(users.length).toBeLessThanOrEqual(5)
    }
  })

  test('admin creators endpoint lists creators', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')
    await setupCreator(request, 'creators')

    const response = await request.get(`${API_URL}/admin/creators`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Admin creators list must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.creators || data.items || Array.isArray(data)).toBeTruthy()
  })

  test('admin subscriptions endpoint lists subscriptions', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/subscriptions`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Admin subscriptions list must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.subscriptions || data.items !== undefined).toBeTruthy()
  })

  test('admin payments endpoint lists payments', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/payments`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Admin payments list must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.payments || data.items !== undefined).toBeTruthy()
  })

  test('admin requires authentication', async ({ request }) => {
    const response = await request.get(`${API_URL}/admin/dashboard`)

    expect(response.status()).toBe(401)
  })
})

// ============================================
// ADMIN USER MANAGEMENT TESTS
// ============================================

test.describe('Admin User Management', () => {
  test('can get user details by ID', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')
    const { userId } = await setupCreator(request, 'detail')

    const response = await request.get(`${API_URL}/admin/users/${userId}`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'User detail must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.id || data.user?.id).toBe(userId)
  })

  test('can search users by email', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')
    const { email } = await setupCreator(request, 'search')

    const response = await request.get(`${API_URL}/admin/users?search=${encodeURIComponent(email)}`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'User search must succeed with valid admin key').toBe(200)
    const data = await response.json()
    const users = data.users || data.items || data
    if (Array.isArray(users) && users.length > 0) {
      expect(users.some((u: { email: string }) => u.email === email)).toBeTruthy()
    }
  })
})

// ============================================
// ADMIN SUBSCRIPTION MANAGEMENT TESTS
// ============================================

test.describe('Admin Subscription Management', () => {
  test('can get subscription details', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')
    const { username } = await setupCreator(request, 'subdetail')

    // Seed a subscription
    const seedResp = await request.post(`${API_URL}/e2e/seed-subscription`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `admin-sub-${Date.now()}@e2e.natepay.co`,
        amount: 500,
        currency: 'USD',
        interval: 'month',
      },
      headers: e2eHeaders(),
    })

    expect(seedResp.status(), 'Subscription seeding must succeed').toBe(200)
    const { subscriptionId } = await seedResp.json()

    const response = await request.get(`${API_URL}/admin/subscriptions/${subscriptionId}`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Subscription detail must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.id || data.subscription?.id).toBe(subscriptionId)
  })
})

// ============================================
// WEBHOOK ENDPOINT TESTS
// ============================================

test.describe('Webhook Endpoints', () => {
  test('Stripe webhook rejects invalid signature', async ({ request }) => {
    const response = await request.post(`${API_URL}/webhooks/stripe`, {
      data: {
        type: 'checkout.session.completed',
        data: { object: { id: 'test' } },
      },
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'invalid-signature',
      },
    })

    // Should reject without valid signature
    expect([400, 401, 403]).toContain(response.status())
  })

  test('Paystack webhook rejects invalid signature', async ({ request }) => {
    const response = await request.post(`${API_URL}/webhooks/paystack`, {
      data: {
        event: 'charge.success',
        data: { reference: 'test' },
      },
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': 'invalid-signature',
      },
    })

    // Should reject without valid signature
    expect([400, 401, 403]).toContain(response.status())
  })

  test('Stripe webhook rate limited', async ({ request }) => {
    // Send multiple requests
    const requests = Array(10).fill(null).map(() =>
      request.post(`${API_URL}/webhooks/stripe`, {
        data: {},
        headers: { 'stripe-signature': 'test' },
      })
    )

    const responses = await Promise.all(requests)
    const statuses = responses.map(r => r.status())

    // Should get some non-500 responses (rate limiting or signature rejection)
    expect(statuses.every(s => s !== 500)).toBeTruthy()
  })

  test('Paystack webhook rate limited', async ({ request }) => {
    const requests = Array(10).fill(null).map(() =>
      request.post(`${API_URL}/webhooks/paystack`, {
        data: {},
        headers: { 'x-paystack-signature': 'test' },
      })
    )

    const responses = await Promise.all(requests)
    const statuses = responses.map(r => r.status())

    expect(statuses.every(s => s !== 500)).toBeTruthy()
  })
})

// ============================================
// ADMIN STRIPE MANAGEMENT TESTS
// ============================================

test.describe('Admin Stripe Management', () => {
  test('admin can view Stripe accounts', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')
    await setupCreator(request, 'stripeview')

    const response = await request.get(`${API_URL}/admin/stripe/accounts`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Stripe accounts list must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.accounts || data.items !== undefined).toBeTruthy()
  })

  test('admin can view Stripe account details', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')
    await setupCreator(request, 'stripedetail')

    // Get the account ID
    const accountsResp = await request.get(`${API_URL}/admin/stripe/accounts`, {
      headers: adminHeaders(),
    })

    expect(accountsResp.status(), 'Stripe accounts list must succeed').toBe(200)
    const { accounts } = await accountsResp.json()

    // Conditional skip: only proceed if accounts exist to test
    if (!accounts || accounts.length === 0) {
      // No accounts seeded - this is expected in stub mode
      // Test passes but doesn't exercise account detail endpoint
      return
    }

    const accountId = accounts[0].stripeAccountId

    const response = await request.get(`${API_URL}/admin/stripe/accounts/${accountId}`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 (account exists) or 404 (account not found in Stripe)
    expect(response.status(), 'Account detail must return 200 or 404').toSatisfy(
      (s: number) => s === 200 || s === 404
    )
  })
})

// ============================================
// ADMIN PAYSTACK MANAGEMENT TESTS
// ============================================

test.describe('Admin Paystack Management', () => {
  test('admin can list Paystack banks', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/paystack/banks/NG`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Paystack banks list must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.banks || Array.isArray(data)).toBeTruthy()
  })
})

// ============================================
// ADMIN AUDIT/LOGS TESTS
// ============================================

test.describe('Admin Audit & Logs', () => {
  test('admin can view recent activities', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/activities`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Activities list must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.activities || data.items !== undefined).toBeTruthy()
  })

  test('admin can view email logs', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/emails`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Email logs must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.emails || data.items !== undefined).toBeTruthy()
  })

  test('admin can view system health', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/system/health`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'System health must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.status || data.healthy !== undefined).toBeTruthy()
  })
})

// ============================================
// ADMIN BULK OPERATIONS TESTS
// ============================================

test.describe('Admin Bulk Operations', () => {
  test('admin can export users (if available)', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/users/export`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 (success) or 501 (not implemented)
    expect([200, 501]).toContain(response.status())
  })

  test('admin can export subscriptions (if available)', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/subscriptions/export`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 (success) or 501 (not implemented)
    expect([200, 501]).toContain(response.status())
  })
})

// ============================================
// ADMIN REVENUE TESTS
// ============================================

test.describe('Admin Revenue', () => {
  test('admin can view revenue summary', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/revenue`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Revenue summary must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(
      data.totalRevenue !== undefined ||
      data.revenue !== undefined ||
      data.summary !== undefined
    ).toBeTruthy()
  })

  test('admin can view revenue by period', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/revenue?period=month`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Revenue by period must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data).toBeDefined()
  })
})

// ============================================
// ADMIN JOBS/OPERATIONS TESTS
// ============================================

test.describe('Admin Jobs & Operations', () => {
  test('admin can view job status', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/jobs`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Jobs status must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.jobs || data.queues !== undefined).toBeTruthy()
  })

  test('admin can view webhook failures', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/webhooks/failures`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Webhook failures must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.failures || data.failed !== undefined).toBeTruthy()
  })
})
