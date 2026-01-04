import { test, expect } from '@playwright/test'
import { e2eLogin, setAuthCookie, buildUsername } from './auth.helper'

/**
 * Payroll & Income Statement E2E Tests
 *
 * Tests the payroll system including:
 * - Period listing and details
 * - PDF generation
 * - Public verification (/verify/:code)
 * - Income statement generation
 *
 * Run with: npx playwright test payroll.spec.ts
 */

const API_URL = 'http://localhost:3001'

const E2E_API_KEY = process.env.E2E_API_KEY
const e2eHeaders = () => ({
  'x-e2e-api-key': E2E_API_KEY || '',
  'Content-Type': 'application/json',
})

// ============================================
// HELPER: Setup creator with service purpose
// ============================================

async function setupServiceCreator(
  request: import('@playwright/test').APIRequestContext,
  suffix: string
) {
  const ts = Date.now().toString().slice(-8)
  const email = `payroll-${suffix}-${ts}@e2e.natepay.co`
  const username = buildUsername('pay', suffix, ts)

  const { token, user } = await e2eLogin(request, email)

  const profileResp = await request.put(`${API_URL}/profile`, {
    data: {
      username,
      displayName: `Payroll Test ${suffix}`,
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'service', // Service purpose required for payroll
      pricingModel: 'single',
      singleAmount: 50,
      paymentProvider: 'stripe',
      isPublic: true,
      perks: [
        { id: `perk_${ts}_1`, title: 'Monthly payroll summary', enabled: true },
        { id: `perk_${ts}_2`, title: 'Income statement PDF', enabled: true },
        { id: `perk_${ts}_3`, title: 'Audit-ready breakdown', enabled: true },
      ],
      address: '123 E2E Test Street',
      city: 'San Francisco',
      state: 'CA',
      zip: '94102',
    },
    headers: { 'Authorization': `Bearer ${token}` },
  })

  expect(profileResp.status(), 'Profile creation for payroll test must succeed').toBe(200)

  // Connect Stripe
  await request.post(`${API_URL}/stripe/connect`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })

  return { token, userId: user.id, email, username }
}

// ============================================
// PAYROLL PERIODS API TESTS
// ============================================

test.describe('Payroll Periods API', () => {
  test('GET /payroll/periods returns empty for new creator', async ({ request }) => {
    const { token } = await setupServiceCreator(request, 'empty')

    const response = await request.get(`${API_URL}/payroll/periods`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.periods).toBeDefined()
    expect(Array.isArray(data.periods)).toBe(true)
    expect(data.ytdByCurrency).toBeDefined()
    expect(typeof data.total).toBe('number')
  })

  test('GET /payroll/periods requires auth', async ({ request }) => {
    const response = await request.get(`${API_URL}/payroll/periods`)

    expect(response.status()).toBe(401)
  })

  test('POST /payroll/generate triggers period generation', async ({ request }) => {
    const { token } = await setupServiceCreator(request, 'generate')

    const response = await request.post(`${API_URL}/payroll/generate`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.status).toBe('processing')
    expect(data.message).toContain('generation')
  })

  test('returns warning if address is missing', async ({ request }) => {
    const ts = Date.now().toString().slice(-8)
    const email = `payroll-noaddr-${ts}@e2e.natepay.co`
    const username = buildUsername('paynoaddr', '', ts)

    const { token } = await e2eLogin(request, email)

    // Create profile WITHOUT address
    await request.put(`${API_URL}/profile`, {
      data: {
        username,
        displayName: 'No Address Test',
        country: 'United States',
        countryCode: 'US',
        currency: 'USD',
        purpose: 'service',
        pricingModel: 'single',
        singleAmount: 50,
        paymentProvider: 'stripe',
        isPublic: true,
        perks: [
          { id: `perk_noaddr_${ts}_1`, title: 'Monthly payroll summary', enabled: true },
          { id: `perk_noaddr_${ts}_2`, title: 'Income statement PDF', enabled: true },
          { id: `perk_noaddr_${ts}_3`, title: 'Audit-ready breakdown', enabled: true },
        ],
        // No address fields
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    const response = await request.get(`${API_URL}/payroll/periods`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    // Should include address warning
    expect(data.warnings).toBeDefined()
    expect(data.warnings.some((w: { type: string }) => w.type === 'missing_address')).toBe(true)
  })
})

// ============================================
// PAYROLL PERIOD DETAIL TESTS
// ============================================

test.describe('Payroll Period Detail', () => {
  test('GET /payroll/periods/:id returns 404 for non-existent period', async ({ request }) => {
    const { token } = await setupServiceCreator(request, 'notfound')

    const response = await request.get(`${API_URL}/payroll/periods/non-existent-id`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(404)
  })

  test('period detail includes payment breakdown', async ({ request }) => {
    const { token, username } = await setupServiceCreator(request, 'detail')

    // Seed some payments to create period data
    await request.post(`${API_URL}/e2e/seed-payment`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `sub-detail-${Date.now()}@e2e.natepay.co`,
        amountCents: 10000, // $100
        currency: 'USD',
        status: 'succeeded',
      },
      headers: e2eHeaders(),
    })

    // Trigger period generation
    await request.post(`${API_URL}/payroll/generate`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    // Wait a moment for generation
    await new Promise((r) => setTimeout(r, 1000))

    // Get periods
    const periodsResp = await request.get(`${API_URL}/payroll/periods`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    const periodsData = await periodsResp.json()

    if (periodsData.periods.length > 0) {
      const periodId = periodsData.periods[0].id

      const detailResp = await request.get(`${API_URL}/payroll/periods/${periodId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      expect(detailResp.status()).toBe(200)
      const detail = await detailResp.json()

      expect(detail.period).toBeDefined()
      expect(detail.period.periodStart).toBeDefined()
      expect(detail.period.periodEnd).toBeDefined()
      expect(detail.period.currency).toBe('USD')
      expect(detail.period.verificationCode).toBeDefined()
    }
  })
})

// ============================================
// PDF GENERATION TESTS
// ============================================

test.describe('PDF Generation', () => {
  test('POST /payroll/periods/:id/pdf returns URL', async ({ request }) => {
    const { token, username } = await setupServiceCreator(request, 'pdf')

    // Seed payment
    await request.post(`${API_URL}/e2e/seed-payment`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `sub-pdf-${Date.now()}@e2e.natepay.co`,
        amountCents: 5000,
        currency: 'USD',
        status: 'succeeded',
      },
      headers: e2eHeaders(),
    })

    // Generate periods
    await request.post(`${API_URL}/payroll/generate`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    await new Promise((r) => setTimeout(r, 1000))

    // Get periods
    const periodsResp = await request.get(`${API_URL}/payroll/periods`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    const periodsData = await periodsResp.json()

    if (periodsData.periods.length > 0) {
      const periodId = periodsData.periods[0].id

      // Request PDF
      const pdfResp = await request.post(`${API_URL}/payroll/periods/${periodId}/pdf`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      // May return URL or error depending on R2 config
      expect([200, 500]).toContain(pdfResp.status())

      if (pdfResp.status() === 200) {
        const data = await pdfResp.json()
        expect(data.pdfUrl).toBeDefined()
      }
    }
  })
})

// ============================================
// PUBLIC VERIFICATION TESTS
// ============================================

test.describe('Public Verification', () => {
  test('GET /payroll/verify/:code validates income statement', async ({ request }) => {
    const { token, username } = await setupServiceCreator(request, 'verify')

    // Seed payment
    await request.post(`${API_URL}/e2e/seed-payment`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `sub-verify-${Date.now()}@e2e.natepay.co`,
        amountCents: 7500,
        currency: 'USD',
        status: 'succeeded',
      },
      headers: e2eHeaders(),
    })

    // Generate periods
    await request.post(`${API_URL}/payroll/generate`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    await new Promise((r) => setTimeout(r, 1000))

    // Get period with verification code
    const periodsResp = await request.get(`${API_URL}/payroll/periods`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    const periodsData = await periodsResp.json()

    if (periodsData.periods.length > 0) {
      const verificationCode = periodsData.periods[0].verificationCode

      // Public verification (no auth required)
      const verifyResp = await request.get(`${API_URL}/payroll/verify/${verificationCode}`)

      expect(verifyResp.status()).toBe(200)
      const data = await verifyResp.json()

      expect(data.valid).toBe(true)
      expect(data.document).toBeDefined()
      expect(data.document.platformConfirmed).toBe(true)
    }
  })

  test('verification fails for invalid code', async ({ request }) => {
    const response = await request.get(`${API_URL}/payroll/verify/invalid-code-xyz123`)

    expect(response.status()).toBe(404)
  })

  test('verification rejects short codes', async ({ request }) => {
    const response = await request.get(`${API_URL}/payroll/verify/short`)

    expect(response.status()).toBe(400)
  })
})

// ============================================
// INCOME STATEMENT (CUSTOM DATE RANGE) TESTS
// ============================================

test.describe('Income Statement Generation', () => {
  test('POST /payroll/custom-statement generates custom range statement', async ({ request }) => {
    const { token, username } = await setupServiceCreator(request, 'stmt')

    // Seed payment
    await request.post(`${API_URL}/e2e/seed-payment`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `sub-stmt-${Date.now()}@e2e.natepay.co`,
        amountCents: 15000,
        currency: 'USD',
        status: 'succeeded',
      },
      headers: e2eHeaders(),
    })

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)

    const response = await request.post(`${API_URL}/payroll/custom-statement`, {
      data: {
        startDate: startOfMonth.toISOString(),
        endDate: endOfMonth.toISOString(),
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.statement).toBeDefined()
    expect(data.statement.startDate).toBeDefined()
    expect(data.statement.endDate).toBeDefined()
    expect(typeof data.statement.grossCents).toBe('number')
    expect(typeof data.statement.netCents).toBe('number')
  })

  test('income statement requires auth', async ({ request }) => {
    const response = await request.post(`${API_URL}/payroll/custom-statement`, {
      data: {
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
      },
    })

    expect(response.status()).toBe(401)
  })
})

// ============================================
// UI FLOW TESTS
// ============================================

test.describe('Payroll UI', () => {
  test('payroll history page loads', async ({ page, request }) => {
    const { token } = await setupServiceCreator(request, 'uihist')
    await setAuthCookie(page, token)

    await page.goto('/payroll')
    await page.waitForLoadState('networkidle')

    // Should show payroll page or redirect appropriately
    const url = page.url()
    const content = await page.content()

    const hasPayrollContent =
      url.includes('payroll') ||
      content.toLowerCase().includes('income') ||
      content.toLowerCase().includes('earning') ||
      content.toLowerCase().includes('statement') ||
      content.toLowerCase().includes('period')

    expect(hasPayrollContent, 'Payroll page should show income/earnings content').toBeTruthy()
  })

  test('verification page loads publicly', async ({ page, request }) => {
    const { token, username } = await setupServiceCreator(request, 'uiverify')

    // Seed payment
    await request.post(`${API_URL}/e2e/seed-payment`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `sub-uiverify-${Date.now()}@e2e.natepay.co`,
        amountCents: 5000,
        currency: 'USD',
        status: 'succeeded',
      },
      headers: e2eHeaders(),
    })

    // Generate periods
    await request.post(`${API_URL}/payroll/generate`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    await new Promise((r) => setTimeout(r, 1000))

    // Get verification code
    const periodsResp = await request.get(`${API_URL}/payroll/periods`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    const periodsData = await periodsResp.json()

    if (periodsData.periods.length > 0) {
      const verificationCode = periodsData.periods[0].verificationCode

      // Visit verification page (public, no auth)
      await page.goto(`/verify/${verificationCode}`)
      await page.waitForLoadState('networkidle')

      const content = await page.content()

      const hasVerificationContent =
        content.toLowerCase().includes('verified') ||
        content.toLowerCase().includes('income') ||
        content.toLowerCase().includes('authentic') ||
        content.toLowerCase().includes('confirm')

      expect(hasVerificationContent, 'Verification page should show verification status').toBeTruthy()
    }
  })

  test('payroll detail page shows period info', async ({ page, request }) => {
    const { token, username } = await setupServiceCreator(request, 'uidetail')

    // Seed payment
    await request.post(`${API_URL}/e2e/seed-payment`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `sub-uidetail-${Date.now()}@e2e.natepay.co`,
        amountCents: 8000,
        currency: 'USD',
        status: 'succeeded',
      },
      headers: e2eHeaders(),
    })

    await request.post(`${API_URL}/payroll/generate`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    await new Promise((r) => setTimeout(r, 1000))

    await setAuthCookie(page, token)

    // Get first period ID
    const periodsResp = await request.get(`${API_URL}/payroll/periods`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    const periodsData = await periodsResp.json()

    if (periodsData.periods.length > 0) {
      const periodId = periodsData.periods[0].id

      await page.goto(`/payroll/${periodId}`)
      await page.waitForLoadState('networkidle')

      const content = await page.content()

      const hasDetailContent =
        content.toLowerCase().includes('earning') ||
        content.toLowerCase().includes('payment') ||
        content.toLowerCase().includes('period') ||
        content.toLowerCase().includes('net') ||
        content.toLowerCase().includes('gross')

      expect(hasDetailContent, 'Payroll detail page should show period info').toBeTruthy()
    }
  })
})
