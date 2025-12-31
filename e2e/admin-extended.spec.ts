import { test, expect } from '@playwright/test'
import { e2eLogin } from './auth.helper'

/**
 * Admin Extended Surfaces E2E Tests
 *
 * Tests admin endpoints for:
 * - Tax reporting (/admin/tax/*)
 * - Financial tools (/admin/financials/*)
 * - Analytics (/admin/analytics/*)
 * - Refund management (/admin/refunds/*)
 * - Data export (/admin/export/*)
 *
 * IMPORTANT: These tests require ADMIN_API_KEY to be set with sufficient permissions.
 * Tests for super_admin-only endpoints will skip if the key lacks permissions.
 *
 * Run with: ADMIN_API_KEY=your-key npx playwright test admin-extended.spec.ts
 */

const API_URL = 'http://localhost:3001'

const ADMIN_API_KEY = process.env.ADMIN_API_KEY
// Skip admin tests if no API key is configured - these tests require real admin auth
const SKIP_ADMIN_TESTS = !ADMIN_API_KEY

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
// HELPER: Setup creator for testing
// ============================================

async function setupCreator(
  request: import('@playwright/test').APIRequestContext,
  suffix: string
) {
  const ts = Date.now().toString().slice(-8)
  const email = `admin-ext-${suffix}-${ts}@e2e.natepay.co`
  const username = `admext${suffix}${ts}`

  const { token, user } = await e2eLogin(request, email)

  await request.put(`${API_URL}/profile`, {
    data: {
      username,
      displayName: `Admin Extended Test ${suffix}`,
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'support',
      pricingModel: 'single',
      singleAmount: 10,
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
// TAX REPORTING TESTS
// ============================================

test.describe('Tax Reporting', () => {
  test('GET /admin/tax/summary/:year returns tax summary', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')
    const currentYear = new Date().getFullYear()

    const response = await request.get(`${API_URL}/admin/tax/summary/${currentYear}`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Tax summary must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.year).toBe(currentYear)
  })

  test('GET /admin/tax/creator-earnings/:year returns earnings', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')
    await setupCreator(request, 'taxearnings')
    const currentYear = new Date().getFullYear()

    const response = await request.get(`${API_URL}/admin/tax/creator-earnings/${currentYear}`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Creator earnings must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.earnings || data.creators !== undefined).toBeTruthy()
  })

  test('GET /admin/tax/export-1099 returns 1099 data', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')
    const currentYear = new Date().getFullYear()

    const response = await request.get(`${API_URL}/admin/tax/export-1099?year=${currentYear}`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), '1099 export must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.forms || data.eligible !== undefined).toBeTruthy()
  })

  test('tax endpoints require admin auth', async ({ request }) => {
    const currentYear = new Date().getFullYear()

    const response = await request.get(`${API_URL}/admin/tax/summary/${currentYear}`)

    expect(response.status()).toBe(401)
  })
})

// ============================================
// FINANCIAL TOOLS TESTS
// ============================================

test.describe('Financial Tools', () => {
  test('GET /admin/financials/reconciliation returns reconciliation data', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/financials/reconciliation`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Reconciliation must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.status || data.reconciliation !== undefined).toBeTruthy()
  })

  test('GET /admin/financials/fee-audit returns fee audit', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/financials/fee-audit`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Fee audit must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.audit || data.fees !== undefined).toBeTruthy()
  })

  test('GET /admin/financials/balance-sheet returns balance data', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/financials/balance-sheet`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Balance sheet must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(
      data.balance !== undefined ||
      data.assets !== undefined ||
      data.sheet !== undefined
    ).toBeTruthy()
  })

  test('GET /admin/financials/daily/:date returns daily snapshot', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')
    const today = new Date().toISOString().split('T')[0]

    const response = await request.get(`${API_URL}/admin/financials/daily/${today}`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Daily snapshot must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.date || data.daily !== undefined).toBeTruthy()
  })

  test('financials require admin auth', async ({ request }) => {
    const response = await request.get(`${API_URL}/admin/financials/reconciliation`)

    expect(response.status()).toBe(401)
  })
})

// ============================================
// ANALYTICS TESTS
// ============================================

test.describe('Analytics', () => {
  test('GET /admin/analytics/churn returns churn metrics', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/analytics/churn`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Churn metrics must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(
      data.churn !== undefined ||
      data.rate !== undefined ||
      data.metrics !== undefined
    ).toBeTruthy()
  })

  test('GET /admin/analytics/ltv returns lifetime value', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/analytics/ltv`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'LTV must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(
      data.ltv !== undefined ||
      data.value !== undefined ||
      data.average !== undefined
    ).toBeTruthy()
  })

  test('GET /admin/analytics/at-risk returns at-risk subscriptions', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/analytics/at-risk`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'At-risk subs must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(
      data.atRisk !== undefined ||
      data.subscriptions !== undefined ||
      Array.isArray(data)
    ).toBeTruthy()
  })

  test('GET /admin/analytics/cohort/:month returns cohort analysis', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')
    const lastMonth = new Date()
    lastMonth.setMonth(lastMonth.getMonth() - 1)
    const monthStr = lastMonth.toISOString().slice(0, 7) // YYYY-MM

    const response = await request.get(`${API_URL}/admin/analytics/cohort/${monthStr}`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Cohort analysis must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.cohort || data.month !== undefined).toBeTruthy()
  })

  test('GET /admin/analytics/mrr returns MRR metrics', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/analytics/mrr`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'MRR metrics must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(
      data.mrr !== undefined ||
      data.current !== undefined ||
      data.total !== undefined
    ).toBeTruthy()
  })

  test('analytics require admin auth', async ({ request }) => {
    const response = await request.get(`${API_URL}/admin/analytics/churn`)

    expect(response.status()).toBe(401)
  })
})

// ============================================
// REFUND MANAGEMENT TESTS
// ============================================

test.describe('Refund Management', () => {
  test('GET /admin/refunds returns refund list', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/refunds`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Refund list must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.refunds || data.items !== undefined).toBeTruthy()
  })

  test('GET /admin/refunds/stats returns refund statistics', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/refunds/stats`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Refund stats must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(
      data.stats !== undefined ||
      data.total !== undefined ||
      data.count !== undefined
    ).toBeTruthy()
  })

  test('GET /admin/refunds/policy returns refund policy', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/refunds/policy`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Refund policy must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.policy || data.rules !== undefined).toBeTruthy()
  })

  test('GET /admin/refunds/eligible/:paymentId checks eligibility', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')
    const { username } = await setupCreator(request, 'refundelig')

    // Seed a payment
    const seedResp = await request.post(`${API_URL}/e2e/seed-payment`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `sub-refund-${Date.now()}@e2e.natepay.co`,
        amountCents: 1000,
        currency: 'USD',
        status: 'succeeded',
      },
      headers: e2eHeaders(),
    })

    expect(seedResp.status(), 'Seed payment must succeed').toBe(200)
    const { paymentId } = await seedResp.json()

    const response = await request.get(`${API_URL}/admin/refunds/eligible/${paymentId}`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Refund eligibility must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(typeof data.eligible).toBe('boolean')
  })

  test('refunds require admin auth', async ({ request }) => {
    const response = await request.get(`${API_URL}/admin/refunds`)

    expect(response.status()).toBe(401)
  })
})

// ============================================
// DATA EXPORT TESTS
// ============================================

test.describe('Data Export', () => {
  test('GET /admin/export/payments returns payment export', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/export/payments?format=json`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Payment export must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.payments || Array.isArray(data)).toBeTruthy()
  })

  test('GET /admin/export/subscriptions returns subscription export', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/export/subscriptions?format=json`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Subscription export must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.subscriptions || Array.isArray(data)).toBeTruthy()
  })

  test('GET /admin/export/creators returns creator export', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')
    await setupCreator(request, 'exportcreator')

    const response = await request.get(`${API_URL}/admin/export/creators?format=json`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Creator export must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.creators || Array.isArray(data)).toBeTruthy()
  })

  test('GET /admin/export/users returns user export', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/export/users?format=json`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'User export must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.users || Array.isArray(data)).toBeTruthy()
  })

  test('GET /admin/export/disputes returns dispute export', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/export/disputes?format=json`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Dispute export must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.disputes || Array.isArray(data)).toBeTruthy()
  })

  test('export supports date range filter', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')
    const startDate = new Date()
    startDate.setMonth(startDate.getMonth() - 1)
    const endDate = new Date()

    const response = await request.get(
      `${API_URL}/admin/export/payments?format=json&startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`,
      { headers: adminHeaders() }
    )

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Date-filtered export must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data).toBeDefined()
  })

  test('export requires admin auth', async ({ request }) => {
    const response = await request.get(`${API_URL}/admin/export/payments`)

    expect(response.status()).toBe(401)
  })
})

// ============================================
// CREATOR MANAGEMENT TESTS
// ============================================

test.describe('Creator Management', () => {
  test('GET /admin/creators returns creator list', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')
    await setupCreator(request, 'creatorlist')

    const response = await request.get(`${API_URL}/admin/creators`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Creator list must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.creators || data.items !== undefined).toBeTruthy()
  })

  test('GET /admin/creators/stats/overview returns stats', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/creators/stats/overview`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Creator stats must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(
      data.stats !== undefined ||
      data.total !== undefined ||
      data.overview !== undefined
    ).toBeTruthy()
  })

  test('GET /admin/creators/:id returns creator detail', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')
    const { userId } = await setupCreator(request, 'creatordetail')

    const response = await request.get(`${API_URL}/admin/creators/${userId}`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Creator detail must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.creator || data.id !== undefined).toBeTruthy()
  })
})

// ============================================
// BULK OPERATIONS TESTS
// ============================================

test.describe('Bulk Operations', () => {
  test('POST /admin/bulk/cancel-subscriptions/preview returns preview', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.post(`${API_URL}/admin/bulk/cancel-subscriptions/preview`, {
      data: {
        subscriptionIds: [],
      },
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth (empty array is valid input)
    expect(response.status(), 'Bulk preview must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.preview || data.count !== undefined).toBeTruthy()
  })

  test('bulk operations require admin auth', async ({ request }) => {
    const response = await request.post(`${API_URL}/admin/bulk/cancel-subscriptions/preview`, {
      data: { subscriptionIds: [] },
    })

    expect(response.status()).toBe(401)
  })
})
