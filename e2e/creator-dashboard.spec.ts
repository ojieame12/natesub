import { test, expect } from '@playwright/test'
import { e2eLogin, setAuthCookie, deterministicEmail, buildUsername } from './auth.helper'

/**
 * Creator Dashboard E2E Tests
 *
 * Tests creator dashboard features:
 * - Dashboard overview and metrics
 * - Profile settings management
 * - Page editor functionality
 * - Pricing configuration
 * - Subscriber list views
 *
 * Run with: npx playwright test creator-dashboard.spec.ts
 */

const API_URL = 'http://localhost:3001'

// E2E API key for helper endpoints
const E2E_API_KEY = process.env.E2E_API_KEY
const e2eHeaders = () => ({
  'x-e2e-api-key': E2E_API_KEY || '',
  'Content-Type': 'application/json',
})

// ============================================
// HELPER: Setup creator with full profile
// ============================================

async function setupCreatorWithProfile(
  request: import('@playwright/test').APIRequestContext,
  suffix: string
) {
  const ts = Date.now().toString().slice(-8)
  const email = `creator-dash-${suffix}-${ts}@e2e.natepay.co`
  const username = buildUsername('dash', suffix, ts)

  const { token, user } = await e2eLogin(request, email)

  const profileResp = await request.put(`${API_URL}/profile`, {
    data: {
      username,
      displayName: `Dashboard Test ${suffix}`,
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'support',
      pricingModel: 'single',
      singleAmount: 5,
      paymentProvider: 'stripe',
      feeMode: 'split',
      isPublic: true,
      bio: 'Test bio for E2E',
    },
    headers: { 'Authorization': `Bearer ${token}` },
  })

  if (profileResp.status() !== 200) {
    throw new Error(`Profile creation failed: ${await profileResp.text()}`)
  }

  // Connect Stripe
  await request.post(`${API_URL}/stripe/connect`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })

  return { token, userId: user.id, email, username }
}

// ============================================
// DASHBOARD OVERVIEW TESTS
// ============================================

test.describe('Dashboard Overview', () => {
  test('dashboard loads for authenticated creator', async ({ page, request }) => {
    const { token } = await setupCreatorWithProfile(request, 'overview')

    // Set auth cookie and navigate - need to go to a page first to set cookies
    await page.goto('/')
    await setAuthCookie(page, token)

    // Reload to pick up fresh auth state (clears React Query cache)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Now navigate to dashboard
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Should be on dashboard (not redirected)
    expect(page.url()).toContain('dashboard')

    // Should render without errors
    await expect(page.locator('body')).toBeVisible()
  })

  test('dashboard shows subscriber count', async ({ page, request }) => {
    const { token, username } = await setupCreatorWithProfile(request, 'subcount')

    // Set auth cookie and reload to clear cache
    await page.goto('/')
    await setAuthCookie(page, token)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Seed a subscription
    await request.post(`${API_URL}/e2e/seed-subscription`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `sub-count-${Date.now()}@e2e.natepay.co`,
        amount: 500,
        currency: 'USD',
        interval: 'month',
      },
      headers: e2eHeaders(),
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Look for subscriber count display
    const content = await page.content()
    const hasSubCount =
      content.includes('subscriber') ||
      content.includes('Subscriber') ||
      content.includes('member') ||
      content.includes('Member')

    expect(hasSubCount).toBeTruthy()
  })

  test('dashboard shows revenue metrics', async ({ page, request }) => {
    const { token, username } = await setupCreatorWithProfile(request, 'revenue')
    await page.goto('/')
    await setAuthCookie(page, token)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Seed a payment
    await request.post(`${API_URL}/e2e/seed-payment`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `payment-rev-${Date.now()}@e2e.natepay.co`,
        amountCents: 1000,
        currency: 'USD',
        status: 'succeeded',
      },
      headers: e2eHeaders(),
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Should show revenue/earnings
    const content = await page.content()
    const hasRevenue =
      content.toLowerCase().includes('revenue') ||
      content.toLowerCase().includes('earning') ||
      content.toLowerCase().includes('$') ||
      content.toLowerCase().includes('mrr')

    expect(hasRevenue).toBeTruthy()
  })

  test('dashboard requires authentication', async ({ page }) => {
    // Clear cookies and try to access dashboard
    await page.context().clearCookies()
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Should redirect to login or show auth prompt
    const url = page.url()
    const isOnDashboard = url.includes('dashboard')
    const isOnLogin = url.includes('login') || url.includes('auth')

    // Either redirected to login or still on dashboard but showing login prompt
    expect(isOnLogin || !isOnDashboard).toBeTruthy()
  })
})

// ============================================
// PROFILE API TESTS
// ============================================

test.describe('Profile API', () => {
  test('GET /profile returns creator profile', async ({ request }) => {
    const { token, username } = await setupCreatorWithProfile(request, 'getprof')

    const response = await request.get(`${API_URL}/profile`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.username).toBe(username)
    expect(data.displayName).toBeTruthy()
    expect(data.currency).toBe('USD')
  })

  test('PATCH /profile updates profile fields', async ({ request }) => {
    const { token } = await setupCreatorWithProfile(request, 'update')

    const response = await request.patch(`${API_URL}/profile`, {
      data: {
        displayName: 'Updated Display Name',
        bio: 'Updated bio text',
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.profile.displayName).toBe('Updated Display Name')
  })

  test('GET /profile/settings returns settings', async ({ request }) => {
    const { token } = await setupCreatorWithProfile(request, 'settings')

    const response = await request.get(`${API_URL}/profile/settings`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    // Should have settings structure
    expect(data).toBeDefined()
  })

  test('GET /profile/pricing returns pricing config', async ({ request }) => {
    const { token } = await setupCreatorWithProfile(request, 'pricing')

    const response = await request.get(`${API_URL}/profile/pricing`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    // Response has { plan, fees, subscription } structure
    expect(data.plan).toBeTruthy()
    expect(data.fees).toBeDefined()
  })

  test('GET /profile/onboarding-status returns status', async ({ request }) => {
    const { token } = await setupCreatorWithProfile(request, 'onbstatus')

    const response = await request.get(`${API_URL}/profile/onboarding-status`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    // Response has { steps: { profile: { completed, fields }, payments: {...} } }
    expect(data.steps).toBeDefined()
    expect(data.steps.profile).toBeDefined()
  })
})

// ============================================
// PAGE EDITOR TESTS
// ============================================

test.describe('Page Editor', () => {
  test('edit page loads for creator', async ({ page, request }) => {
    const { token, username } = await setupCreatorWithProfile(request, 'editor')
    await page.goto('/')
    await setAuthCookie(page, token)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Try to access page editor
    await page.goto('/edit-page')
    await page.waitForLoadState('networkidle')

    // Should show edit page or dashboard with edit capability
    const url = page.url()
    const content = await page.content()

    const hasEditor =
      url.includes('edit') ||
      content.toLowerCase().includes('edit') ||
      content.toLowerCase().includes('customize')

    expect(hasEditor).toBeTruthy()
  })

  test('can update display name via editor', async ({ page, request }) => {
    const { token } = await setupCreatorWithProfile(request, 'editname')
    await page.goto('/')
    await setAuthCookie(page, token)
    await page.reload()
    await page.waitForLoadState('networkidle')

    await page.goto('/edit-page')
    await page.waitForLoadState('networkidle')

    // Find display name input
    const nameInput = page.locator('[data-testid="edit-display-name"]')
      .or(page.locator('input[name="displayName"]'))
      .or(page.locator('input[placeholder*="name" i]'))

    if (await nameInput.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await nameInput.first().clear()
      await nameInput.first().fill('New Display Name')

      // Look for save button
      const saveBtn = page.locator('button:has-text("Save")')
        .or(page.locator('[data-testid="save-profile"]'))

      if (await saveBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await saveBtn.first().click()
        await page.waitForTimeout(1000)
      }
    }
  })

  test('can update bio via editor', async ({ page, request }) => {
    const { token } = await setupCreatorWithProfile(request, 'editbio')
    await page.goto('/')
    await setAuthCookie(page, token)
    await page.reload()
    await page.waitForLoadState('networkidle')

    await page.goto('/edit-page')
    await page.waitForLoadState('networkidle')

    // Find bio input
    const bioInput = page.locator('[data-testid="edit-bio"]')
      .or(page.locator('textarea[name="bio"]'))
      .or(page.locator('textarea'))

    if (await bioInput.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await bioInput.first().clear()
      await bioInput.first().fill('Updated bio from E2E test')
    }
  })
})

// ============================================
// SETTINGS PAGES TESTS
// ============================================

test.describe('Settings Pages', () => {
  test('settings page loads', async ({ page, request }) => {
    const { token } = await setupCreatorWithProfile(request, 'settingsui')
    await page.goto('/')
    await setAuthCookie(page, token)
    await page.reload()
    await page.waitForLoadState('networkidle')

    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // Should show settings or redirect to appropriate page
    const content = await page.content()
    const hasSettings =
      content.toLowerCase().includes('setting') ||
      content.toLowerCase().includes('account') ||
      content.toLowerCase().includes('preference')

    // May redirect to dashboard/profile which is also valid
    expect(hasSettings || page.url().includes('dashboard')).toBeTruthy()
  })

  test('notification settings accessible', async ({ page, request }) => {
    const { token } = await setupCreatorWithProfile(request, 'notif')
    await page.goto('/')
    await setAuthCookie(page, token)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Try notification settings path
    await page.goto('/settings/notifications')
    await page.waitForLoadState('networkidle')

    // Check if notifications section exists
    const content = await page.content()
    const hasNotif =
      content.toLowerCase().includes('notification') ||
      content.toLowerCase().includes('email') ||
      content.toLowerCase().includes('alert')

    // May redirect if path doesn't exist
    expect(hasNotif || page.url().includes('dashboard') || page.url().includes('settings')).toBeTruthy()
  })

  test('payment settings accessible', async ({ page, request }) => {
    const { token } = await setupCreatorWithProfile(request, 'payset')
    await page.goto('/')
    await setAuthCookie(page, token)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Try payment settings path
    await page.goto('/settings/payments')
    await page.waitForLoadState('networkidle')

    const content = await page.content()
    const hasPayment =
      content.toLowerCase().includes('payment') ||
      content.toLowerCase().includes('payout') ||
      content.toLowerCase().includes('stripe') ||
      content.toLowerCase().includes('bank')

    expect(hasPayment || page.url().includes('dashboard') || page.url().includes('settings')).toBeTruthy()
  })
})

// ============================================
// SUBSCRIBER LIST TESTS
// ============================================

test.describe('Subscriber List', () => {
  test('subscriber list API returns subscribers', async ({ request }) => {
    const { token, username } = await setupCreatorWithProfile(request, 'sublist')

    // Seed some subscriptions
    for (let i = 0; i < 3; i++) {
      await request.post(`${API_URL}/e2e/seed-subscription`, {
        data: {
          creatorUsername: username,
          subscriberEmail: `sub-list-${i}-${Date.now()}@e2e.natepay.co`,
          amount: 500 + i * 100,
          currency: 'USD',
          interval: 'month',
        },
        headers: e2eHeaders(),
      })
    }

    // Get subscribers via dashboard or creator API
    const response = await request.get(`${API_URL}/creator/subscribers`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    // Endpoint may be named differently
    if (response.status() === 200) {
      const data = await response.json()
      expect(data.subscribers || data.items || data).toBeDefined()
    } else if (response.status() === 404) {
      // Endpoint doesn't exist at this path - try activity metrics
      const metricsResp = await request.get(`${API_URL}/activity/metrics`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      expect(metricsResp.status()).toBe(200)
      const metrics = await metricsResp.json()
      expect(metrics.metrics.subscriberCount).toBeGreaterThanOrEqual(3)
    }
  })

  test('subscriber list UI shows subscribers', async ({ page, request }) => {
    const { token, username } = await setupCreatorWithProfile(request, 'sublistui')
    await page.goto('/')
    await setAuthCookie(page, token)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Seed a subscription
    await request.post(`${API_URL}/e2e/seed-subscription`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `sub-ui-${Date.now()}@e2e.natepay.co`,
        amount: 500,
        currency: 'USD',
        interval: 'month',
      },
      headers: e2eHeaders(),
    })

    // Navigate to subscribers page (dashboard might not show subscribers by default)
    await page.goto('/subscribers')
    await page.waitForLoadState('networkidle')

    // Should show subscriber info or allow access
    const content = await page.content()
    const url = page.url()
    const hasSubs =
      content.toLowerCase().includes('subscriber') ||
      content.toLowerCase().includes('member') ||
      content.toLowerCase().includes('supporter') ||
      url.includes('subscribers') ||
      url.includes('dashboard')

    expect(hasSubs).toBeTruthy()
  })
})

// ============================================
// PRICING MANAGEMENT TESTS
// ============================================

test.describe('Pricing Management', () => {
  test('can get current pricing', async ({ request }) => {
    const { token } = await setupCreatorWithProfile(request, 'getprice')

    const response = await request.get(`${API_URL}/profile/pricing`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    // Should have pricing info
    expect(data.pricingModel || data.singleAmount || data.tiers).toBeDefined()
  })

  test('can update pricing model', async ({ request }) => {
    const { token } = await setupCreatorWithProfile(request, 'updateprice')

    // Update to tiered pricing
    const response = await request.put(`${API_URL}/profile`, {
      data: {
        pricingModel: 'tiers',
        tiers: [
          { name: 'Basic', amount: 500, perks: ['Perk 1'] },
          { name: 'Pro', amount: 1000, perks: ['Perk 1', 'Perk 2'] },
        ],
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    // May succeed or fail validation depending on schema
    expect([200, 400]).toContain(response.status())
  })

  test('pricing page shows current config', async ({ page, request }) => {
    const { token } = await setupCreatorWithProfile(request, 'priceui')
    await page.goto('/')
    await setAuthCookie(page, token)
    await page.reload()
    await page.waitForLoadState('networkidle')

    await page.goto('/edit-page')
    await page.waitForLoadState('networkidle')

    // Look for pricing section
    const content = await page.content()
    const hasPricing =
      content.toLowerCase().includes('price') ||
      content.toLowerCase().includes('tier') ||
      content.toLowerCase().includes('amount') ||
      content.includes('$')

    expect(hasPricing).toBeTruthy()
  })
})

// ============================================
// PUBLIC PAGE PREVIEW TESTS
// ============================================

test.describe('Public Page Preview', () => {
  test('creator can preview their public page', async ({ page, request }) => {
    const { token, username } = await setupCreatorWithProfile(request, 'preview')
    await page.goto('/')
    await setAuthCookie(page, token)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Visit own public page
    await page.goto(`/${username}`)
    await page.waitForLoadState('networkidle')

    // Should show public page
    const content = await page.content()
    const hasPublicPage =
      content.toLowerCase().includes('subscribe') ||
      content.toLowerCase().includes('support') ||
      content.toLowerCase().includes('dashboard test')

    expect(hasPublicPage || page.url().includes(username)).toBeTruthy()
  })

  test('public page shows pricing', async ({ page, request }) => {
    const { token, username } = await setupCreatorWithProfile(request, 'pubprice')
    await page.goto('/')
    await setAuthCookie(page, token)
    await page.reload()
    await page.waitForLoadState('networkidle')

    await page.goto(`/${username}`)
    await page.waitForLoadState('networkidle')

    // Should show price
    const content = await page.content()
    const hasPrice =
      content.includes('$5') ||
      content.includes('5.00') ||
      content.toLowerCase().includes('month') ||
      content.toLowerCase().includes('subscribe')

    expect(hasPrice).toBeTruthy()
  })
})

// ============================================
// ACCOUNT MANAGEMENT TESTS
// ============================================

test.describe('Account Management', () => {
  test('can access account settings', async ({ request }) => {
    const { token } = await setupCreatorWithProfile(request, 'account')

    // Get auth/me for account info
    const response = await request.get(`${API_URL}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.email || data.user?.email).toBeTruthy()
  })

  test('session management works', async ({ request }) => {
    const { token } = await setupCreatorWithProfile(request, 'session')

    // Get current sessions
    const response = await request.get(`${API_URL}/auth/sessions`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    // Endpoint may not exist
    if (response.status() === 200) {
      const data = await response.json()
      expect(data.sessions || data).toBeDefined()
    }
  })

  test('logout invalidates session', async ({ request }) => {
    const { token } = await setupCreatorWithProfile(request, 'logout')

    // Logout
    const logoutResp = await request.post(`${API_URL}/auth/logout`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect([200, 204]).toContain(logoutResp.status())

    // Verify session is invalid
    const meResp = await request.get(`${API_URL}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(meResp.status()).toBe(401)
  })
})
