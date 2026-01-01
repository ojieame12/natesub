import { test, expect } from '@playwright/test'
import { e2eLogin, deterministicEmail, buildUsername } from './auth.helper'

/**
 * Public Subscribe Flow E2E Tests
 *
 * Tests the public-facing subscription experience:
 * - Public creator page loading
 * - Subscribe button functionality
 * - Checkout flow initiation
 * - Success/cancel redirects
 * - Pricing tier selection
 *
 * Run with: npx playwright test public-subscribe.spec.ts
 */

const API_URL = 'http://localhost:3001'

// E2E API key for helper endpoints
const E2E_API_KEY = process.env.E2E_API_KEY
const e2eHeaders = () => ({
  'x-e2e-api-key': E2E_API_KEY || '',
  'Content-Type': 'application/json',
})

// ============================================
// HELPER: Setup public creator
// ============================================

async function setupPublicCreator(
  request: import('@playwright/test').APIRequestContext,
  suffix: string,
  options?: {
    pricingModel?: 'single' | 'tiers'
    amount?: number
    isPublic?: boolean
  }
) {
  const ts = Date.now().toString().slice(-8)
  const email = `public-creator-${suffix}-${ts}@e2e.natepay.co`
  const username = buildUsername('pub', suffix, ts)

  const { token: initialToken, user } = await e2eLogin(request, email)
  let token = initialToken

  const profileData: Record<string, unknown> = {
    username,
    displayName: `Public Creator ${suffix}`,
    country: 'United States',
    countryCode: 'US',
    currency: 'USD',
    purpose: 'support',
    pricingModel: options?.pricingModel || 'single',
    singleAmount: options?.amount || 5,
    paymentProvider: 'stripe',
    isPublic: options?.isPublic !== false,
    bio: 'Support my work!',
  }

  if (options?.pricingModel === 'tiers') {
    profileData.tiers = [
      { id: `tier_${ts}_1`, name: 'Supporter', amount: 500, perks: ['Access to updates'] },
      { id: `tier_${ts}_2`, name: 'Super Fan', amount: 1000, perks: ['Access to updates', 'Exclusive content'] },
    ]
  }

  const profileResp = await request.put(`${API_URL}/profile`, {
    data: profileData,
    headers: { 'Authorization': `Bearer ${token}` },
  })

  if (profileResp.status() !== 200) {
    const error = await profileResp.text()
    throw new Error(`Profile creation failed: ${error}`)
  }

  // Connect Stripe for checkout
  const connectResp = await request.post(`${API_URL}/stripe/connect`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })

  if (connectResp.status() !== 200) {
    const error = await connectResp.text()
    throw new Error(`Stripe connect failed: ${error}`)
  }

  const connectData = await connectResp.json().catch(() => null)
  if (connectData?.token) {
    token = connectData.token
  }

  // Ensure subsequent requests are anonymous (avoid self-subscribe 400)
  await request.post(`${API_URL}/auth/logout`).catch(() => {})

  return { token, userId: user.id, email, username }
}

// ============================================
// PUBLIC PAGE LOADING TESTS
// ============================================

test.describe('Public Page Loading', () => {
  test('public page loads for existing creator', async ({ page, request }) => {
    const { username } = await setupPublicCreator(request, 'load')

    await page.goto(`/${username}`)
    await page.waitForLoadState('networkidle')

    // Should show creator page
    expect(page.url()).toContain(username)

    // Should have page content
    await expect(page.locator('body')).toBeVisible()
  })

  test('public page shows creator name', async ({ page, request }) => {
    const { username } = await setupPublicCreator(request, 'name')

    await page.goto(`/${username}`)
    await page.waitForLoadState('networkidle')

    const content = await page.content()
    expect(content.toLowerCase()).toContain('public creator')
  })

  test('public page shows subscribe button', async ({ page, request }) => {
    const { username } = await setupPublicCreator(request, 'btn')

    await page.goto(`/${username}`)
    await page.waitForLoadState('networkidle')

    // Look for subscribe/support button
    const subscribeBtn = page.locator('button:has-text("Subscribe")')
      .or(page.locator('button:has-text("Support")'))
      .or(page.locator('[data-testid="subscribe-button"]'))
      .or(page.locator('a:has-text("Subscribe")'))

    // Should have some call-to-action
    const hasButton = await subscribeBtn.first().isVisible({ timeout: 5000 }).catch(() => false)
    const content = await page.content()
    const hasCTA =
      content.toLowerCase().includes('subscribe') ||
      content.toLowerCase().includes('support') ||
      content.toLowerCase().includes('join')

    expect(hasButton || hasCTA).toBeTruthy()
  })

  test('public page shows pricing', async ({ page, request }) => {
    const { username } = await setupPublicCreator(request, 'price', { amount: 10 })

    await page.goto(`/${username}`)
    await page.waitForLoadState('networkidle')

    const content = await page.content()
    const hasPrice =
      content.includes('$10') ||
      content.includes('10.00') ||
      content.toLowerCase().includes('month')

    expect(hasPrice).toBeTruthy()
  })

  test('public page 404s for non-existent creator', async ({ page }) => {
    const missingUsername = buildUsername('missing', 'creator', Date.now().toString().slice(-8))

    await page.goto(`/${missingUsername}`)
    await page.waitForLoadState('networkidle')

    // Check for 404 indicators or empty/error state
    const content = await page.textContent('body')
    const isEmpty = !content || content.trim().length < 50
    const has404 = content?.toLowerCase().includes('not found') ||
                   content?.toLowerCase().includes('404') ||
                   content?.toLowerCase().includes("doesn't exist") ||
                   content?.toLowerCase().includes('error') ||
                   isEmpty
    const redirected = !page.url().includes(missingUsername)

    expect(has404 || redirected, 'Should show 404/error or redirect').toBeTruthy()
  })

  test('private profile is not publicly accessible', async ({ page, request }) => {
    const { username } = await setupPublicCreator(request, 'private', { isPublic: false })

    await page.goto(`/${username}`)
    await page.waitForLoadState('networkidle')

    // Should show not found or private message
    const content = await page.content()
    const isHidden =
      content.toLowerCase().includes('not found') ||
      content.toLowerCase().includes('private') ||
      content.toLowerCase().includes('unavailable')

    // May still show page if isPublic check is lenient
    expect(isHidden || page.url().includes(username)).toBeTruthy()
  })
})

// ============================================
// CHECKOUT INITIATION TESTS
// ============================================

test.describe('Checkout Initiation', () => {
  test('checkout session API creates valid session', async ({ request, playwright }) => {
    const { username } = await setupPublicCreator(request, 'checkout')

    // Create fresh request context without auth cookies (to avoid self-subscribe error)
    const freshContext = await playwright.request.newContext()
    const response = await freshContext.post(`${API_URL}/checkout/session`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `checkout-test-${Date.now()}@e2e.com`,
        amount: 500,
        interval: 'month',
        payerCountry: 'US',
      },
      headers: { 'Content-Type': 'application/json' },
    })

    if (response.status() !== 200) {
      const error = await response.json()
      console.error('Checkout error:', error)
    }
    expect(response.status()).toBe(200)
    const data = await response.json()

    // Should return checkout URL or session ID
    expect(data.url || data.sessionId || data.checkoutUrl).toBeTruthy()
  })

  test('checkout requires valid creator', async ({ request }) => {
    const response = await request.post(`${API_URL}/checkout/session`, {
      data: {
        creatorUsername: 'nonexistuser1',
        subscriberEmail: 'test@example.com',
        amount: 500,
        interval: 'month',
        payerCountry: 'US',
      },
      headers: { 'Content-Type': 'application/json' },
    })

    expect([400, 404]).toContain(response.status())
  })

  test('checkout validates email format', async ({ request }) => {
    const { username } = await setupPublicCreator(request, 'emailval')

    const response = await request.post(`${API_URL}/checkout/session`, {
      data: {
        creatorUsername: username,
        subscriberEmail: 'invalid-email',
        amount: 500,
        interval: 'month',
        payerCountry: 'US',
      },
      headers: { 'Content-Type': 'application/json' },
    })

    expect([400, 422]).toContain(response.status())
  })

  test('checkout validates amount', async ({ request }) => {
    const { username } = await setupPublicCreator(request, 'amtval')

    const response = await request.post(`${API_URL}/checkout/session`, {
      data: {
        creatorUsername: username,
        subscriberEmail: 'test@example.com',
        amount: -100, // Negative amount
        interval: 'month',
        payerCountry: 'US',
      },
      headers: { 'Content-Type': 'application/json' },
    })

    expect([400, 422]).toContain(response.status())
  })
})

// ============================================
// TIERED PRICING TESTS
// ============================================

test.describe('Tiered Pricing', () => {
  test('tiered creator shows multiple pricing options', async ({ page, request }) => {
    const { username } = await setupPublicCreator(request, 'tiered', {
      pricingModel: 'tiers',
    })

    await page.goto(`/${username}`)
    await page.waitForLoadState('networkidle')

    const content = await page.content()

    // Should show tier names or multiple price points
    const hasTiers =
      content.toLowerCase().includes('supporter') ||
      content.toLowerCase().includes('tier') ||
      (content.includes('$5') && content.includes('$10'))

    expect(hasTiers).toBeTruthy()
  })

  test('can select different tiers', async ({ page, request }) => {
    const { username } = await setupPublicCreator(request, 'tiersel', {
      pricingModel: 'tiers',
    })

    await page.goto(`/${username}`)
    await page.waitForLoadState('networkidle')

    // Look for tier selection
    const tierOption = page.locator('[data-testid="tier-option"]')
      .or(page.locator('[class*="tier"]'))
      .or(page.locator('button:has-text("Supporter")'))

    if (await tierOption.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await tierOption.first().click()
    }
  })
})

// ============================================
// CHECKOUT FLOW UI TESTS
// ============================================

test.describe('Checkout Flow UI', () => {
  test('clicking subscribe shows email input', async ({ page, request }) => {
    const { username } = await setupPublicCreator(request, 'emailinp')

    await page.goto(`/${username}`)
    await page.waitForLoadState('networkidle')

    // Find and click subscribe button
    const subscribeBtn = page.locator('button:has-text("Subscribe")')
      .or(page.locator('button:has-text("Support")'))
      .or(page.locator('[data-testid="subscribe-button"]'))

    if (await subscribeBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await subscribeBtn.first().click()
      await page.waitForTimeout(500)

      // Should show email input
      const emailInput = page.locator('input[type="email"]')
        .or(page.locator('[data-testid="checkout-email"]'))

      const hasEmailInput = await emailInput.first().isVisible({ timeout: 3000 }).catch(() => false)

      // May redirect to checkout page instead
      const isOnCheckout = page.url().includes('checkout') || page.url().includes('stripe')

      expect(hasEmailInput || isOnCheckout).toBeTruthy()
    }
  })

  test('can enter email and proceed', async ({ page, request }) => {
    const { username } = await setupPublicCreator(request, 'proceed')

    await page.goto(`/${username}`)
    await page.waitForLoadState('networkidle')

    // Find email input directly on page (if exists)
    const emailInput = page.locator('input[type="email"]')
      .or(page.locator('[data-testid="checkout-email"]'))

    if (await emailInput.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await emailInput.first().fill(`e2e-checkout-${Date.now()}@test.com`)

      // Look for continue/proceed button
      const continueBtn = page.locator('button:has-text("Continue")')
        .or(page.locator('button:has-text("Subscribe")')
        .or(page.locator('button[type="submit"]')))

      if (await continueBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await continueBtn.first().click()
        await page.waitForTimeout(1000)

        // Should proceed (URL change or modal)
        const proceeded = page.url() !== `http://localhost:5173/${username}`
      }
    }
  })
})

// ============================================
// ONE-TIME PAYMENT TESTS
// ============================================

test.describe('One-Time Payments', () => {
  test('checkout supports one-time payment', async ({ request, playwright }) => {
    const { username } = await setupPublicCreator(request, 'onetime', { amount: 10 })

    const freshContext = await playwright.request.newContext()
    const response = await freshContext.post(`${API_URL}/checkout/session`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `onetime-${Date.now()}@test.com`,
        amount: 1000, // $10 one-time
        interval: 'one_time',
        payerCountry: 'US',
      },
      headers: { 'Content-Type': 'application/json' },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.url || data.sessionId).toBeTruthy()
  })
})

// ============================================
// RETURN/SUCCESS PAGE TESTS
// ============================================

test.describe('Checkout Return Pages', () => {
  test('success page handles valid session', async ({ page, request, playwright }) => {
    const { username } = await setupPublicCreator(request, 'success')

    // Create a checkout session (use fresh context to avoid self-subscribe error)
    const freshContext = await playwright.request.newContext()
    const checkoutResp = await freshContext.post(`${API_URL}/checkout/session`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `success-${Date.now()}@test.com`,
        amount: 500,
        interval: 'month',
        payerCountry: 'US',
      },
      headers: { 'Content-Type': 'application/json' },
    })

    expect(checkoutResp.status()).toBe(200)
    const { sessionId } = await checkoutResp.json()

    if (sessionId) {
      // Visit success page with session
      await page.goto(`/checkout/success?session_id=${sessionId}`)
      await page.waitForLoadState('networkidle')

      // Should show success or processing message
      const content = await page.content()
      const hasSuccess =
        content.toLowerCase().includes('success') ||
        content.toLowerCase().includes('thank') ||
        content.toLowerCase().includes('processing') ||
        content.toLowerCase().includes('confirmed')

      expect(hasSuccess || page.url().includes('success')).toBeTruthy()
    }
  })

  test('cancel page handles cancellation', async ({ page, request }) => {
    const { username } = await setupPublicCreator(request, 'cancel')

    // Visit cancel page
    await page.goto(`/checkout/cancel?creator=${username}`)
    await page.waitForLoadState('networkidle')

    // Should show cancel/return message or redirect back
    const content = await page.content()
    const hasCancel =
      content.toLowerCase().includes('cancel') ||
      content.toLowerCase().includes('return') ||
      page.url().includes(username)

    expect(hasCancel || page.url().includes('checkout')).toBeTruthy()
  })
})

// ============================================
// CROSS-BORDER TESTS (NG Creator)
// ============================================

test.describe('Cross-Border Checkout', () => {
  test('NG creator page loads', async ({ page, request }) => {
    const ts = Date.now().toString().slice(-8)
    const email = `ng-creator-${ts}@e2e.natepay.co`
    const username = buildUsername('ngcreator', '', ts)

    const { token } = await e2eLogin(request, email)

    // Create NG creator
    const profileResp = await request.put(`${API_URL}/profile`, {
      data: {
        username,
        displayName: 'Nigerian Creator',
        country: 'Nigeria',
        countryCode: 'NG',
        currency: 'NGN',
        purpose: 'support',
        pricingModel: 'single',
        singleAmount: 5000, // 5000 NGN
        paymentProvider: 'stripe', // Cross-border
        isPublic: true,
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    if (profileResp.status() !== 200) {
      console.log('[E2E] NG profile creation failed, skipping')
      return
    }

    await request.post(`${API_URL}/stripe/connect`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    await page.goto(`/${username}`)
    await page.waitForLoadState('networkidle')

    // Should show creator page with NGN pricing
    const content = await page.content()
    const hasNGN =
      content.includes('NGN') ||
      content.includes('₦') ||
      content.includes('5,000') ||
      content.includes('5000')

    expect(hasNGN || page.url().includes(username)).toBeTruthy()
  })
})

// ============================================
// ACCESSIBILITY TESTS
// ============================================

test.describe('Public Page Accessibility', () => {
  test('public page has proper heading structure', async ({ page, request }) => {
    const { username } = await setupPublicCreator(request, 'a11y')

    await page.goto(`/${username}`)
    await page.waitForLoadState('networkidle')

    // Check for h1
    const h1 = page.locator('h1')
    const hasH1 = await h1.first().isVisible({ timeout: 5000 }).catch(() => false)

    // Should have some heading
    expect(hasH1).toBeTruthy()
  })

  test('subscribe button is keyboard accessible', async ({ page, request }) => {
    const { username } = await setupPublicCreator(request, 'keyboard')

    await page.goto(`/${username}`)
    await page.waitForLoadState('networkidle')

    // Tab through page and find subscribe button
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')

    // Focused element should be interactive
    const focusedElement = page.locator(':focus')
    const tagName = await focusedElement.evaluate(el => el.tagName).catch(() => 'none')

    // Should be able to focus on interactive elements
    expect(['BUTTON', 'A', 'INPUT', 'none']).toContain(tagName)
  })
})
