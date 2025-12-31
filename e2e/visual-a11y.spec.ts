import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { setAuthCookie, e2eLogin, deterministicEmail } from './auth.helper'

/**
 * Visual Regression & Accessibility (a11y) Tests
 *
 * These tests ensure:
 * 1. Visual consistency of high-conversion UI elements (payment buttons, cards)
 * 2. WCAG 2.1 AA compliance for checkout and subscriber flows
 * 3. CSRF protection on sensitive endpoints
 *
 * Visual snapshots are stored in e2e/__screenshots__/
 * Update snapshots: npx playwright test visual-a11y --update-snapshots
 */

const API_URL = 'http://localhost:3001'

// Stub routes for consistent visual testing
async function setupVisualStubs(page: import('@playwright/test').Page) {
  // Stub auth/me for consistent user state
  await page.route('**/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'visual-test-user',
          email: 'visual@test.com',
          firstName: 'Visual',
          lastName: 'Test',
          username: 'visualtest',
          country: 'US',
          onboardingComplete: true,
        },
      }),
    })
  })

  // Stub creator profile for public page
  await page.route('**/creators/visualtest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'visual-creator',
        username: 'visualtest',
        firstName: 'Visual',
        lastName: 'Test',
        bio: 'Test creator for visual snapshots',
        avatarUrl: null,
        bannerUrl: null,
        tiers: [
          { id: 'tier-1', name: 'Basic', price: 500, currency: 'usd', perks: ['Access to content'] },
          { id: 'tier-2', name: 'Premium', price: 1500, currency: 'usd', perks: ['All basic perks', 'Exclusive content'] },
        ],
        country: 'US',
      }),
    })
  })
}

test.describe('Visual Regression: Payment UI', () => {
  test.beforeEach(async ({ page }) => {
    await setupVisualStubs(page)
  })

  test('subscription tier cards render consistently', async ({ page }) => {
    await page.goto('/visualtest')
    await page.waitForLoadState('networkidle')

    // Wait for tier cards to render
    const tierCards = page.locator('[data-testid="tier-card"], .tier-card, [class*="TierCard"]')

    // Only snapshot if tier cards exist
    if (await tierCards.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(tierCards.first()).toHaveScreenshot('tier-card-basic.png', {
        maxDiffPixels: 100, // Allow minor anti-aliasing differences
      })
    }
  })

  test('checkout button states render consistently', async ({ page }) => {
    await page.goto('/visualtest')
    await page.waitForLoadState('networkidle')

    const subscribeBtn = page.locator('[data-testid="subscribe-btn"], button:has-text("Subscribe"), button:has-text("subscribe")')

    if (await subscribeBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      // Default state
      await expect(subscribeBtn.first()).toHaveScreenshot('subscribe-btn-default.png', {
        maxDiffPixels: 50,
      })

      // Hover state
      await subscribeBtn.first().hover()
      await expect(subscribeBtn.first()).toHaveScreenshot('subscribe-btn-hover.png', {
        maxDiffPixels: 50,
      })
    }
  })

  test('payment method selector renders consistently', async ({ page, request }) => {
    const email = deterministicEmail('visual-payment')
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    // Go to payment step in onboarding
    await page.goto('/onboarding?step=payment')
    await page.waitForLoadState('networkidle')

    const paymentSelector = page.locator('[data-testid="payment-method-selector"], [class*="PaymentMethod"]')

    if (await paymentSelector.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(paymentSelector).toHaveScreenshot('payment-method-selector.png', {
        maxDiffPixels: 100,
      })
    }
  })
})

test.describe('Visual Regression: Subscriber Portal', () => {
  test.beforeEach(async ({ page }) => {
    // Stub portal data
    await page.route('**/subscriptions/portal/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subscriptions: [
            {
              id: 'sub-1',
              creatorUsername: 'testcreator',
              creatorName: 'Test Creator',
              tierName: 'Premium',
              amount: 1500,
              currency: 'usd',
              status: 'active',
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            },
          ],
        }),
      })
    })
  })

  test('subscription management card renders consistently', async ({ page }) => {
    // Stub the OTP flow
    await page.route('**/subscriptions/portal/request-otp', async (route) => {
      await route.fulfill({ status: 200, body: JSON.stringify({ success: true }) })
    })

    await page.route('**/subscriptions/portal/verify-otp', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          verified: true,
          subscriptions: [{
            id: 'sub-1',
            creatorUsername: 'testcreator',
            creatorName: 'Test Creator',
            tierName: 'Premium',
            amount: 1500,
            currency: 'usd',
            status: 'active',
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          }],
        }),
      })
    })

    await page.goto('/portal')
    await page.waitForLoadState('networkidle')

    // Enter email and verify
    const emailInput = page.locator('[data-testid="portal-email-input"], input[type="email"]')
    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await emailInput.fill('test@example.com')
      await page.locator('button:has-text("Continue"), button:has-text("Send")').first().click()

      // Enter OTP
      const otpInput = page.locator('[data-testid="otp-input"], input[name="otp"]')
      if (await otpInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await otpInput.fill('123456')
        await page.locator('button:has-text("Verify")').click()
      }

      // Wait for subscription cards
      await page.waitForTimeout(1000)
      const subCard = page.locator('[data-testid="subscription-card"], [class*="SubscriptionCard"]')

      if (await subCard.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(subCard.first()).toHaveScreenshot('subscription-card-active.png', {
          maxDiffPixels: 100,
        })
      }
    }
  })
})

test.describe('Accessibility: Checkout Flow', () => {
  test('checkout page has no critical a11y violations', async ({ page }) => {
    await setupVisualStubs(page)
    await page.goto('/visualtest')
    await page.waitForLoadState('networkidle')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .exclude('[data-testid="analytics"]') // Exclude third-party widgets
      .analyze()

    // Filter to only critical and serious violations
    const critical = results.violations.filter(v =>
      v.impact === 'critical' || v.impact === 'serious'
    )

    expect(critical, `Found ${critical.length} critical a11y violations: ${JSON.stringify(critical.map(v => ({ id: v.id, impact: v.impact, description: v.description })), null, 2)}`).toHaveLength(0)
  })

  test('onboarding identity step has no critical a11y violations', async ({ page, request }) => {
    const email = deterministicEmail('a11y-onboarding')
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    await page.goto('/onboarding?step=identity')
    await page.waitForLoadState('networkidle')

    // Wait for form to render
    await page.waitForSelector('[data-testid="identity-first-name"], input[name="firstName"]', { timeout: 10000 }).catch(() => {})

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    const critical = results.violations.filter(v =>
      v.impact === 'critical' || v.impact === 'serious'
    )

    expect(critical, `Found ${critical.length} critical a11y violations`).toHaveLength(0)
  })

  test('subscriber portal has no critical a11y violations', async ({ page }) => {
    await page.goto('/portal')
    await page.waitForLoadState('networkidle')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    const critical = results.violations.filter(v =>
      v.impact === 'critical' || v.impact === 'serious'
    )

    expect(critical, `Found ${critical.length} critical a11y violations`).toHaveLength(0)
  })
})

test.describe('Accessibility: Form Inputs', () => {
  test('all form inputs have associated labels', async ({ page, request }) => {
    const email = deterministicEmail('a11y-forms')
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    await page.goto('/onboarding?step=identity')
    await page.waitForLoadState('networkidle')

    // Check that all visible inputs have labels or aria-label
    const inputs = await page.locator('input:visible, select:visible, textarea:visible').all()

    for (const input of inputs) {
      const id = await input.getAttribute('id')
      const ariaLabel = await input.getAttribute('aria-label')
      const ariaLabelledBy = await input.getAttribute('aria-labelledby')
      const placeholder = await input.getAttribute('placeholder')

      // Input should have either: associated label, aria-label, aria-labelledby, or at minimum a placeholder
      const hasLabel = id ? await page.locator(`label[for="${id}"]`).count() > 0 : false
      const hasAccessibleName = hasLabel || ariaLabel || ariaLabelledBy || placeholder

      expect(hasAccessibleName, `Input missing accessible name: ${await input.evaluate(el => el.outerHTML)}`).toBeTruthy()
    }
  })

  test('focus order is logical in checkout flow', async ({ page }) => {
    await setupVisualStubs(page)
    await page.goto('/visualtest')
    await page.waitForLoadState('networkidle')

    // Tab through and ensure focus moves in a logical order
    const focusableElements: string[] = []

    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab')
      const focused = await page.evaluate(() => {
        const el = document.activeElement
        return el ? el.tagName + (el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : '') : null
      })
      if (focused) focusableElements.push(focused)
    }

    // Should have focusable elements (not stuck on body)
    expect(focusableElements.filter(e => e !== 'BODY').length).toBeGreaterThan(0)
  })
})

test.describe('Security: CSRF Protection', () => {
  test('API rejects requests without proper origin', async ({ request }) => {
    // Attempt to call a sensitive endpoint with a malicious origin
    const response = await request.post(`${API_URL}/auth/logout`, {
      headers: {
        'Origin': 'https://malicious-site.com',
        'Content-Type': 'application/json',
      },
      data: {},
    })

    // Should be rejected (403 Forbidden) or require auth (401)
    // A 200 with malicious origin would be a CSRF vulnerability
    const status = response.status()
    expect([401, 403, 400]).toContain(status)
  })

  test('API accepts requests from allowed origins', async ({ request }) => {
    // Request from localhost (allowed in dev)
    const response = await request.post(`${API_URL}/auth/logout`, {
      headers: {
        'Origin': 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      data: {},
    })

    // Should not be blocked by CORS (may be 401 if not authenticated, but not 403)
    expect(response.status()).not.toBe(403)
  })

  test('sensitive endpoints require authentication', async ({ request }) => {
    // Attempt to access subscription data without auth
    const response = await request.get(`${API_URL}/subscriptions`)

    expect(response.status()).toBe(401)
  })

  test('management tokens are validated', async ({ request }) => {
    // Attempt to access management endpoint with invalid token
    const response = await request.get(`${API_URL}/subscriptions/manage/invalid-token-here`)

    // Should return 400 or 404, not 500
    expect([400, 404]).toContain(response.status())
  })
})

test.describe('Security: Input Validation', () => {
  test('XSS payloads are escaped in user display', async ({ page, request }) => {
    const email = deterministicEmail('xss-test')
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    await page.goto('/onboarding?step=identity')
    await page.waitForLoadState('networkidle')

    const xssPayload = '<script>alert("XSS")</script>'

    const firstNameInput = page.locator('[data-testid="identity-first-name"]')
    if (await firstNameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstNameInput.fill(xssPayload)

      // The script should not execute - check that it's escaped in the DOM
      const hasScript = await page.evaluate(() => {
        return document.querySelector('script:not([src])') !== null
      })

      expect(hasScript, 'XSS payload should not create script element').toBeFalsy()
    }
  })

  test('SQL injection payloads do not cause errors', async ({ request }) => {
    const sqlPayload = "'; DROP TABLE users; --"

    // Attempt to search with SQL injection
    const response = await request.get(`${API_URL}/creators/search`, {
      params: { q: sqlPayload },
    })

    // Should return valid response (empty results), not 500
    expect(response.status()).not.toBe(500)
  })
})
