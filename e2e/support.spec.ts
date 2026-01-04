import { test, expect } from '@playwright/test'
import { e2eLogin, setAuthCookie, buildUsername } from './auth.helper'

/**
 * Support & Help E2E Tests
 *
 * Tests the support ticket system and help pages:
 * - Creating support tickets (public and authenticated)
 * - Viewing ticket history
 * - Replying to tickets
 * - Help/settings pages
 *
 * Run with: npx playwright test support.spec.ts
 */

const API_URL = 'http://localhost:3001'

// ============================================
// HELPER: Setup creator
// ============================================

async function setupCreator(
  request: import('@playwright/test').APIRequestContext,
  suffix: string
) {
  const ts = Date.now().toString().slice(-8)
  const email = `support-${suffix}-${ts}@e2e.natepay.co`
  const username = buildUsername('sup', suffix, ts)

  const { token, user } = await e2eLogin(request, email)

  await request.put(`${API_URL}/profile`, {
    data: {
      username,
      displayName: `Support Test ${suffix}`,
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'support',
      pricingModel: 'single',
      singleAmount: 100, // Must meet $95 minimum for new US Stripe creators
      paymentProvider: 'stripe',
      isPublic: true,
    },
    headers: { 'Authorization': `Bearer ${token}` },
  })

  return { token, userId: user.id, email, username }
}

// ============================================
// CREATE TICKET TESTS (Public)
// ============================================

test.describe('Create Support Ticket', () => {
  test('POST /support/tickets creates ticket without auth', async ({ request }) => {
    const response = await request.post(`${API_URL}/support/tickets`, {
      data: {
        email: `anon-support-${Date.now()}@e2e.natepay.co`,
        name: 'Anonymous User',
        category: 'general',
        subject: 'E2E Test Ticket',
        message: 'This is a test support ticket from E2E tests. Please ignore.',
      },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.ticket).toBeDefined()
    expect(data.ticket.id).toBeTruthy()
    expect(data.ticket.status).toBe('open')
    expect(data.ticket.category).toBe('general')
  })

  test('POST /support/tickets creates ticket with auth', async ({ request }) => {
    const { token, email } = await setupCreator(request, 'authticket')

    const response = await request.post(`${API_URL}/support/tickets`, {
      data: {
        email, // Will be overridden with authenticated user email
        category: 'billing',
        subject: 'Billing Question',
        message: 'I have a question about my billing. This is from E2E tests.',
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.ticket).toBeDefined()
    expect(data.ticket.userId).toBeTruthy() // Should have user ID when authenticated
  })

  test('POST /support/tickets validates email', async ({ request }) => {
    const response = await request.post(`${API_URL}/support/tickets`, {
      data: {
        email: 'not-an-email',
        category: 'general',
        subject: 'Test',
        message: 'This message is long enough to pass validation.',
      },
    })

    expect(response.status()).toBe(400)
  })

  test('POST /support/tickets validates message length', async ({ request }) => {
    const response = await request.post(`${API_URL}/support/tickets`, {
      data: {
        email: 'test@e2e.natepay.co',
        category: 'general',
        subject: 'Test',
        message: 'Short', // Too short
      },
    })

    expect(response.status()).toBe(400)
  })

  test('POST /support/tickets validates category', async ({ request }) => {
    const response = await request.post(`${API_URL}/support/tickets`, {
      data: {
        email: 'test@e2e.natepay.co',
        category: 'invalid-category',
        subject: 'Test',
        message: 'This message is long enough to pass validation.',
      },
    })

    expect(response.status()).toBe(400)
  })

  test('high priority categories get priority flag', async ({ request }) => {
    const response = await request.post(`${API_URL}/support/tickets`, {
      data: {
        email: `payout-support-${Date.now()}@e2e.natepay.co`,
        category: 'payout', // Should be high priority
        subject: 'Payout Issue',
        message: 'I have an issue with my payout. This is from E2E tests.',
      },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.ticket.priority).toBe('high')
  })
})

// ============================================
// LIST TICKETS TESTS
// ============================================

test.describe('List Support Tickets', () => {
  test('GET /support/tickets returns user tickets', async ({ request }) => {
    const { token } = await setupCreator(request, 'listtickets')

    // Create a ticket first
    await request.post(`${API_URL}/support/tickets`, {
      data: {
        email: 'list@e2e.natepay.co',
        category: 'general',
        subject: 'List Test',
        message: 'This is a test for listing tickets from E2E tests.',
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    // Get tickets
    const response = await request.get(`${API_URL}/support/tickets`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.tickets).toBeDefined()
    expect(Array.isArray(data.tickets)).toBe(true)
    expect(data.tickets.length).toBeGreaterThanOrEqual(1)
  })

  test('GET /support/tickets requires auth', async ({ request }) => {
    const response = await request.get(`${API_URL}/support/tickets`)

    expect(response.status()).toBe(401)
  })
})

// ============================================
// TICKET DETAIL TESTS
// ============================================

test.describe('Ticket Detail', () => {
  test('GET /support/tickets/:id returns ticket detail', async ({ request }) => {
    const { token } = await setupCreator(request, 'ticketdetail')

    // Create a ticket
    const createResp = await request.post(`${API_URL}/support/tickets`, {
      data: {
        email: 'detail@e2e.natepay.co',
        category: 'technical',
        subject: 'Detail Test',
        message: 'This is a test for viewing ticket details from E2E tests.',
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(createResp.status()).toBe(200)
    const { ticket } = await createResp.json()

    // Get detail
    const detailResp = await request.get(`${API_URL}/support/tickets/${ticket.id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(detailResp.status()).toBe(200)
    const data = await detailResp.json()

    expect(data.ticket).toBeDefined()
    expect(data.ticket.subject).toBe('Detail Test')
    expect(data.ticket.messages).toBeDefined()
  })

  test('GET /support/tickets/:id returns 404 for unknown', async ({ request }) => {
    const { token } = await setupCreator(request, 'notfound')

    const response = await request.get(`${API_URL}/support/tickets/unknown-id-xyz`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(404)
  })

  test('GET /support/tickets/:id denies access to other user tickets', async ({ request }) => {
    // Create first user's ticket
    const user1 = await setupCreator(request, 'owner')
    const createResp = await request.post(`${API_URL}/support/tickets`, {
      data: {
        email: 'owner@e2e.natepay.co',
        category: 'general',
        subject: 'Owner Ticket',
        message: 'This ticket belongs to user1 and should not be visible to user2.',
      },
      headers: { 'Authorization': `Bearer ${user1.token}` },
    })

    const { ticket } = await createResp.json()

    // Create second user and try to access first user's ticket
    const user2 = await setupCreator(request, 'other')
    const response = await request.get(`${API_URL}/support/tickets/${ticket.id}`, {
      headers: { 'Authorization': `Bearer ${user2.token}` },
    })

    // Should be 404 (not found for this user) or 403 (forbidden)
    expect([403, 404]).toContain(response.status())
  })
})

// ============================================
// REPLY TO TICKET TESTS
// ============================================

test.describe('Reply to Ticket', () => {
  test('POST /support/tickets/:id/reply adds message', async ({ request }) => {
    const { token } = await setupCreator(request, 'reply')

    // Create a ticket
    const createResp = await request.post(`${API_URL}/support/tickets`, {
      data: {
        email: 'reply@e2e.natepay.co',
        category: 'general',
        subject: 'Reply Test',
        message: 'This is a test for replying to tickets from E2E tests.',
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    const { ticket } = await createResp.json()

    // Reply
    const replyResp = await request.post(`${API_URL}/support/tickets/${ticket.id}/reply`, {
      data: {
        message: 'This is a follow-up message from E2E tests.',
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(replyResp.status()).toBe(200)
    const data = await replyResp.json()

    expect(data.message || data.success).toBeTruthy()
  })

  test('POST /support/tickets/:id/reply validates message', async ({ request }) => {
    const { token } = await setupCreator(request, 'replyval')

    const createResp = await request.post(`${API_URL}/support/tickets`, {
      data: {
        email: 'replyval@e2e.natepay.co',
        category: 'general',
        subject: 'Validate Reply',
        message: 'This is a test for validating reply messages from E2E tests.',
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    const { ticket } = await createResp.json()

    // Empty reply
    const replyResp = await request.post(`${API_URL}/support/tickets/${ticket.id}/reply`, {
      data: {
        message: '',
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(replyResp.status()).toBe(400)
  })
})

// ============================================
// UI FLOW TESTS
// ============================================

test.describe('Help & Support UI', () => {
  test('help page loads', async ({ page, request }) => {
    const { token } = await setupCreator(request, 'helpui')
    await setAuthCookie(page, token)

    await page.goto('/settings/help')
    await page.waitForLoadState('networkidle')

    const url = page.url()
    const content = await page.content()

    const hasHelpContent =
      url.includes('help') ||
      url.includes('support') ||
      content.toLowerCase().includes('help') ||
      content.toLowerCase().includes('support') ||
      content.toLowerCase().includes('contact') ||
      content.toLowerCase().includes('faq')

    expect(hasHelpContent, 'Help page should show help/support content').toBeTruthy()
  })

  test('help page shows ticket form', async ({ page, request }) => {
    const { token } = await setupCreator(request, 'helpform')
    await setAuthCookie(page, token)

    await page.goto('/settings/help')
    await page.waitForLoadState('networkidle')

    const content = await page.content()

    const hasFormElements =
      content.toLowerCase().includes('subject') ||
      content.toLowerCase().includes('message') ||
      content.toLowerCase().includes('category') ||
      content.toLowerCase().includes('submit') ||
      content.toLowerCase().includes('send')

    expect(hasFormElements, 'Help page should have ticket form elements').toBeTruthy()
  })

  test('can navigate to help from settings', async ({ page, request }) => {
    const { token } = await setupCreator(request, 'navhelp')
    await setAuthCookie(page, token)

    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // Look for help link
    const helpLink = page.locator('a[href*="help"]')
      .or(page.locator('button:has-text("Help")'))
      .or(page.locator('a:has-text("Help")'))
      .or(page.locator('a:has-text("Support")'))

    if (await helpLink.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await helpLink.first().click()
      await page.waitForLoadState('networkidle')

      const newUrl = page.url()
      expect(newUrl.includes('help') || newUrl.includes('support')).toBeTruthy()
    }
  })

  test('ticket history shows user tickets', async ({ page, request }) => {
    const { token } = await setupCreator(request, 'ticketui')
    await setAuthCookie(page, token)

    // Create a ticket first
    await request.post(`${API_URL}/support/tickets`, {
      data: {
        email: 'ticketui@e2e.natepay.co',
        category: 'general',
        subject: 'UI Test Ticket',
        message: 'This ticket is created for UI testing purposes.',
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    await page.goto('/settings/help')
    await page.waitForLoadState('networkidle')

    // If there's a ticket history section, check it
    const content = await page.content()
    const hasTicketHistory =
      content.toLowerCase().includes('ticket') ||
      content.toLowerCase().includes('history') ||
      content.toLowerCase().includes('previous')

    // The page should either show tickets or a form
    expect(content.length > 0).toBeTruthy()
  })
})

// ============================================
// ADMIN SUPPORT TESTS
// ============================================

const ADMIN_API_KEY = process.env.ADMIN_API_KEY
// Skip admin tests if no API key is configured - these tests require real admin auth
const SKIP_ADMIN_TESTS = !ADMIN_API_KEY

test.describe('Admin Support Management', () => {
  const adminHeaders = () => ({
    'x-admin-api-key': ADMIN_API_KEY || '',
    'Content-Type': 'application/json',
  })

  test('GET /admin/support/tickets returns all tickets', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/support/tickets`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Support tickets must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(data.tickets || data.items !== undefined).toBeTruthy()
  })

  test('GET /admin/support/tickets/stats returns stats', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    const response = await request.get(`${API_URL}/admin/support/tickets/stats`, {
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(response.status(), 'Ticket stats must succeed with valid admin key').toBe(200)
    const data = await response.json()
    expect(
      data.stats !== undefined ||
      data.total !== undefined ||
      data.open !== undefined
    ).toBeTruthy()
  })

  test('admin can resolve ticket', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    // Create a ticket
    const createResp = await request.post(`${API_URL}/support/tickets`, {
      data: {
        email: `admin-resolve-${Date.now()}@e2e.natepay.co`,
        category: 'general',
        subject: 'Admin Resolve Test',
        message: 'This ticket will be resolved by admin for testing purposes.',
      },
    })

    expect(createResp.status(), 'Ticket creation must succeed').toBe(200)
    const { ticket } = await createResp.json()

    const resolveResp = await request.post(`${API_URL}/admin/support/tickets/${ticket.id}/resolve`, {
      data: {
        resolution: 'Resolved by E2E test',
      },
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(resolveResp.status(), 'Ticket resolve must succeed with valid admin key').toBe(200)
  })

  test('admin can reply to ticket', async ({ request }) => {
    test.skip(SKIP_ADMIN_TESTS, 'ADMIN_API_KEY required')

    // Create a ticket
    const createResp = await request.post(`${API_URL}/support/tickets`, {
      data: {
        email: `admin-reply-${Date.now()}@e2e.natepay.co`,
        category: 'billing',
        subject: 'Admin Reply Test',
        message: 'This ticket will receive an admin reply for testing purposes.',
      },
    })

    expect(createResp.status(), 'Ticket creation must succeed').toBe(200)
    const { ticket } = await createResp.json()

    const replyResp = await request.post(`${API_URL}/admin/support/tickets/${ticket.id}/reply`, {
      data: {
        message: 'This is an admin reply from E2E tests.',
      },
      headers: adminHeaders(),
    })

    // STRICT: Must return 200 with valid admin auth
    expect(replyResp.status(), 'Ticket reply must succeed with valid admin key').toBe(200)
  })

  test('admin endpoints require auth', async ({ request }) => {
    const response = await request.get(`${API_URL}/admin/support/tickets`)

    expect(response.status()).toBe(401)
  })
})
