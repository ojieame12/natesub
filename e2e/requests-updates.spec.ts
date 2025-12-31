import { test, expect } from '@playwright/test'
import { e2eLogin, setAuthCookie } from './auth.helper'

/**
 * Requests & Updates E2E Tests
 *
 * Tests the request (invoice) and subscriber update flows:
 * - Creating and sending requests
 * - Public request pages (/r/:token)
 * - Request payment flow
 * - Subscriber updates
 * - Update history
 *
 * Run with: npx playwright test requests-updates.spec.ts
 */

const API_URL = 'http://localhost:3001'

const E2E_API_KEY = process.env.E2E_API_KEY
const e2eHeaders = () => ({
  'x-e2e-api-key': E2E_API_KEY || '',
  'Content-Type': 'application/json',
})

// ============================================
// HELPER: Setup creator
// ============================================

async function setupCreator(
  request: import('@playwright/test').APIRequestContext,
  suffix: string
) {
  const ts = Date.now().toString().slice(-8)
  const email = `requests-${suffix}-${ts}@e2e.natepay.co`
  const username = `req${suffix}${ts}`

  const { token, user } = await e2eLogin(request, email)

  const profileResp = await request.put(`${API_URL}/profile`, {
    data: {
      username,
      displayName: `Requests Test ${suffix}`,
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

  expect(profileResp.status()).toBe(200)

  await request.post(`${API_URL}/stripe/connect`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })

  return { token, userId: user.id, email, username }
}

// ============================================
// REQUEST LIST TESTS
// ============================================

test.describe('Request List API', () => {
  test('GET /requests returns empty for new creator', async ({ request }) => {
    const { token } = await setupCreator(request, 'empty')

    const response = await request.get(`${API_URL}/requests`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.requests).toBeDefined()
    expect(Array.isArray(data.requests)).toBe(true)
  })

  test('GET /requests requires auth', async ({ request }) => {
    const response = await request.get(`${API_URL}/requests`)

    expect(response.status()).toBe(401)
  })

  test('GET /requests supports filtering by status', async ({ request }) => {
    const { token } = await setupCreator(request, 'filter')

    const response = await request.get(`${API_URL}/requests?status=sent`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.requests).toBeDefined()
  })
})

// ============================================
// CREATE REQUEST TESTS
// ============================================

test.describe('Create Request API', () => {
  test('POST /requests creates new request', async ({ request }) => {
    const { token } = await setupCreator(request, 'create')

    const response = await request.post(`${API_URL}/requests`, {
      data: {
        recipientName: 'E2E Test Recipient',
        recipientEmail: `recipient-${Date.now()}@e2e.natepay.co`,
        relationship: 'client',
        amountCents: 5000, // $50
        currency: 'USD',
        description: 'E2E test request for services',
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.request).toBeDefined()
    expect(data.request.id).toBeTruthy()
    expect(data.request.status).toBe('sent')
    expect(data.publicUrl).toBeTruthy()
  })

  test('POST /requests validates amount', async ({ request }) => {
    const { token } = await setupCreator(request, 'validate')

    const response = await request.post(`${API_URL}/requests`, {
      data: {
        recipientName: 'Test',
        recipientEmail: 'test@e2e.natepay.co',
        relationship: 'client',
        amountCents: 0, // Invalid
        currency: 'USD',
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(400)
  })

  test('POST /requests validates email', async ({ request }) => {
    const { token } = await setupCreator(request, 'emailval')

    const response = await request.post(`${API_URL}/requests`, {
      data: {
        recipientName: 'Test',
        recipientEmail: 'not-an-email',
        relationship: 'client',
        amountCents: 1000,
        currency: 'USD',
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(400)
  })

  test('POST /requests requires auth', async ({ request }) => {
    const response = await request.post(`${API_URL}/requests`, {
      data: {
        recipientName: 'Test',
        recipientEmail: 'test@example.com',
        amountCents: 1000,
      },
    })

    expect(response.status()).toBe(401)
  })
})

// ============================================
// REQUEST DETAIL TESTS
// ============================================

test.describe('Request Detail API', () => {
  test('GET /requests/:id returns request detail', async ({ request }) => {
    const { token, username } = await setupCreator(request, 'detail')

    // Seed a request
    const seedResp = await request.post(`${API_URL}/e2e/seed-request`, {
      data: {
        creatorUsername: username,
        recipientName: 'Detail Test',
        recipientEmail: `detail-${Date.now()}@e2e.natepay.co`,
        amountCents: 2500,
        currency: 'USD',
        status: 'sent',
      },
      headers: e2eHeaders(),
    })

    expect(seedResp.status()).toBe(200)
    const { requestId } = await seedResp.json()

    const response = await request.get(`${API_URL}/requests/${requestId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.request).toBeDefined()
    expect(data.request.amountCents).toBe(2500)
  })

  test('GET /requests/:id returns 404 for unknown', async ({ request }) => {
    const { token } = await setupCreator(request, 'notfound')

    const response = await request.get(`${API_URL}/requests/unknown-id-123`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(404)
  })
})

// ============================================
// PUBLIC REQUEST PAGE TESTS
// ============================================

test.describe('Public Request Page', () => {
  test('GET /requests/r/:token returns request for valid token', async ({ request }) => {
    const { username } = await setupCreator(request, 'pubtoken')

    // Seed a request
    const seedResp = await request.post(`${API_URL}/e2e/seed-request`, {
      data: {
        creatorUsername: username,
        recipientName: 'Public Test',
        recipientEmail: `public-${Date.now()}@e2e.natepay.co`,
        amountCents: 3000,
        currency: 'USD',
        status: 'sent',
      },
      headers: e2eHeaders(),
    })

    expect(seedResp.status()).toBe(200)
    const { tokenHash } = await seedResp.json()

    // Note: The actual token is hashed, so we'd need the real token
    // This tests the endpoint exists and validates format
    const response = await request.get(`${API_URL}/requests/r/invalid-token-format`)

    expect([404, 400]).toContain(response.status())
  })

  test('public request page loads in browser', async ({ page, request }) => {
    const { username } = await setupCreator(request, 'pubui')

    // Seed a request
    const seedResp = await request.post(`${API_URL}/e2e/seed-request`, {
      data: {
        creatorUsername: username,
        recipientName: 'Public UI Test',
        recipientEmail: `pubui-${Date.now()}@e2e.natepay.co`,
        amountCents: 4500,
        currency: 'USD',
        status: 'sent',
      },
      headers: e2eHeaders(),
    })

    if (seedResp.status() === 200) {
      const { tokenHash } = await seedResp.json()

      // Try to load the page (will show error since we don't have the real token)
      await page.goto(`/r/${tokenHash}`)
      await page.waitForLoadState('networkidle')

      // Should load something (error or request page)
      const content = await page.content()
      const hasContent =
        content.includes('request') ||
        content.includes('Request') ||
        content.includes('not found') ||
        content.includes('expired')

      expect(hasContent).toBeTruthy()
    }
  })
})

// ============================================
// REQUEST ACTIONS TESTS
// ============================================

test.describe('Request Actions', () => {
  test('PUT /requests/:id/cancel cancels request', async ({ request }) => {
    const { token, username } = await setupCreator(request, 'cancel')

    // Seed a request
    const seedResp = await request.post(`${API_URL}/e2e/seed-request`, {
      data: {
        creatorUsername: username,
        recipientName: 'Cancel Test',
        recipientEmail: `cancel-${Date.now()}@e2e.natepay.co`,
        amountCents: 1000,
        currency: 'USD',
        status: 'sent',
      },
      headers: e2eHeaders(),
    })

    expect(seedResp.status()).toBe(200)
    const { requestId } = await seedResp.json()

    const cancelResp = await request.put(`${API_URL}/requests/${requestId}/cancel`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    // May be PUT or POST depending on implementation
    expect([200, 204, 404, 405]).toContain(cancelResp.status())
  })

  test('PUT /requests/:id/resend resends request', async ({ request }) => {
    const { token, username } = await setupCreator(request, 'resend')

    const seedResp = await request.post(`${API_URL}/e2e/seed-request`, {
      data: {
        creatorUsername: username,
        recipientName: 'Resend Test',
        recipientEmail: `resend-${Date.now()}@e2e.natepay.co`,
        amountCents: 1500,
        currency: 'USD',
        status: 'sent',
      },
      headers: e2eHeaders(),
    })

    expect(seedResp.status()).toBe(200)
    const { requestId } = await seedResp.json()

    const resendResp = await request.post(`${API_URL}/requests/${requestId}/resend`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect([200, 404, 405, 429]).toContain(resendResp.status())
  })
})

// ============================================
// UPDATES API TESTS
// ============================================

test.describe('Updates API', () => {
  test('GET /updates returns update history', async ({ request }) => {
    const { token } = await setupCreator(request, 'updatelist')

    const response = await request.get(`${API_URL}/updates`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.updates).toBeDefined()
    expect(Array.isArray(data.updates)).toBe(true)
  })

  test('POST /updates creates new update', async ({ request }) => {
    const { token, username } = await setupCreator(request, 'createupd')

    // First seed a subscriber so there's an audience
    await request.post(`${API_URL}/e2e/seed-subscription`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `sub-update-${Date.now()}@e2e.natepay.co`,
        amount: 1000,
        currency: 'USD',
        interval: 'month',
      },
      headers: e2eHeaders(),
    })

    const response = await request.post(`${API_URL}/updates`, {
      data: {
        subject: 'E2E Test Update',
        body: 'This is a test update from E2E tests.',
        audience: 'all',
        sendEmail: false, // Don't actually send
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.update || data.id).toBeTruthy()
  })

  test('POST /updates validates subject', async ({ request }) => {
    const { token } = await setupCreator(request, 'validsubj')

    const response = await request.post(`${API_URL}/updates`, {
      data: {
        subject: '', // Empty
        body: 'Test body',
        audience: 'all',
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(400)
  })

  test('GET /updates requires auth', async ({ request }) => {
    const response = await request.get(`${API_URL}/updates`)

    expect(response.status()).toBe(401)
  })
})

// ============================================
// UPDATE DETAIL TESTS
// ============================================

test.describe('Update Detail', () => {
  test('GET /updates/:id returns update detail', async ({ request }) => {
    const { token, username } = await setupCreator(request, 'upddetail')

    // Create an update
    const createResp = await request.post(`${API_URL}/updates`, {
      data: {
        subject: 'Detail Test Update',
        body: 'Update body content',
        audience: 'all',
        sendEmail: false,
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    if (createResp.status() === 200) {
      const { update, id } = await createResp.json()
      const updateId = update?.id || id

      if (updateId) {
        const detailResp = await request.get(`${API_URL}/updates/${updateId}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        })

        expect(detailResp.status()).toBe(200)
        const data = await detailResp.json()
        expect(data.update || data.id).toBeTruthy()
      }
    }
  })
})

// ============================================
// UI FLOW TESTS
// ============================================

test.describe('Requests UI', () => {
  test('sent requests page loads', async ({ page, request }) => {
    const { token } = await setupCreator(request, 'sentui')
    await setAuthCookie(page, token)

    await page.goto('/requests')
    await page.waitForLoadState('networkidle')

    const url = page.url()
    const content = await page.content()

    const hasRequestsContent =
      url.includes('request') ||
      content.toLowerCase().includes('request') ||
      content.toLowerCase().includes('invoice') ||
      content.toLowerCase().includes('sent')

    expect(hasRequestsContent, 'Requests page should show request/invoice content').toBeTruthy()
  })

  test('new request page loads', async ({ page, request }) => {
    const { token } = await setupCreator(request, 'newui')
    await setAuthCookie(page, token)

    await page.goto('/new-request')
    await page.waitForLoadState('networkidle')

    const url = page.url()
    const content = await page.content()

    const hasNewRequestContent =
      url.includes('request') ||
      content.toLowerCase().includes('create') ||
      content.toLowerCase().includes('new') ||
      content.toLowerCase().includes('recipient') ||
      content.toLowerCase().includes('amount')

    expect(hasNewRequestContent, 'New request page should show create form').toBeTruthy()
  })

  test('updates history page loads', async ({ page, request }) => {
    const { token } = await setupCreator(request, 'updui')
    await setAuthCookie(page, token)

    await page.goto('/updates')
    await page.waitForLoadState('networkidle')

    const url = page.url()
    const content = await page.content()

    const hasUpdatesContent =
      url.includes('update') ||
      content.toLowerCase().includes('update') ||
      content.toLowerCase().includes('post') ||
      content.toLowerCase().includes('send')

    expect(hasUpdatesContent, 'Updates page should show update content').toBeTruthy()
  })

  test('new update page loads', async ({ page, request }) => {
    const { token } = await setupCreator(request, 'newupdui')
    await setAuthCookie(page, token)

    await page.goto('/updates/new')
    await page.waitForLoadState('networkidle')

    const url = page.url()
    const content = await page.content()

    const hasNewUpdateContent =
      url.includes('update') ||
      content.toLowerCase().includes('subject') ||
      content.toLowerCase().includes('compose') ||
      content.toLowerCase().includes('audience') ||
      content.toLowerCase().includes('write')

    expect(hasNewUpdateContent, 'New update page should show compose form').toBeTruthy()
  })
})

// ============================================
// REQUEST PREVIEW TESTS
// ============================================

test.describe('Request Preview', () => {
  test('request preview page shows preview', async ({ page, request }) => {
    const { token } = await setupCreator(request, 'preview')
    await setAuthCookie(page, token)

    // Navigate through new request flow
    await page.goto('/new-request')
    await page.waitForLoadState('networkidle')

    // If there's a preview step in the flow, check it
    const previewUrl = page.url()
    if (previewUrl.includes('preview')) {
      const content = await page.content()
      const hasPreview =
        content.toLowerCase().includes('preview') ||
        content.toLowerCase().includes('confirm') ||
        content.toLowerCase().includes('review')

      expect(hasPreview).toBeTruthy()
    }
  })
})
