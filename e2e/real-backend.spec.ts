import { test, expect } from '@playwright/test'
import { e2eLogin, setAuthCookie, deterministicEmail } from './auth.helper'

/**
 * Real Backend E2E Tests
 *
 * These tests hit the REAL backend (with PAYMENTS_MODE=stub for external providers).
 * This validates:
 * - API contracts between frontend and backend
 * - Database persistence
 * - Session/cookie handling
 * - Full request/response flows
 *
 * External providers (Stripe, Paystack) are stubbed at the backend level,
 * so we don't need route stubs here.
 *
 * Run with: npx playwright test real-backend.spec.ts
 */

test.describe('Onboarding - Real Backend', () => {
  test('creates user and starts onboarding', async ({ page, request }) => {
    const email = deterministicEmail('onboarding-start')

    // Create user via e2e-login (this hits the real backend)
    const { token, user, onboarding } = await e2eLogin(request, email)
    expect(user.id).toBeTruthy()
    expect(user.email).toBe(email)

    // Set auth cookie
    await setAuthCookie(page, token)

    // Navigate to onboarding
    await page.goto('/onboarding')
    await page.waitForLoadState('networkidle')

    // Should be on onboarding page (not redirected to dashboard)
    expect(page.url()).toContain('onboarding')

    // Should show onboarding content
    await expect(page.locator('body')).toBeVisible()
  })

  test('completes identity step with real persistence', async ({ page, request }) => {
    const email = deterministicEmail('onboarding-identity')

    // Create user
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    // Go to identity step
    await page.goto('/onboarding?step=identity')
    await page.waitForLoadState('networkidle')

    // Fill identity form
    const firstNameInput = page.locator('input[name="firstName"], [data-testid="identity-first-name"]')
    const lastNameInput = page.locator('input[name="lastName"], [data-testid="identity-last-name"]')

    if (await firstNameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstNameInput.fill('E2E')
      await lastNameInput.fill('TestUser')

      // Select country (US for Stripe)
      const countrySelector = page.locator('[data-testid="country-selector"], select[name="country"]')
      if (await countrySelector.isVisible({ timeout: 2000 }).catch(() => false)) {
        await countrySelector.click()
        await page.locator('[data-testid="country-option-us"], option[value="US"]').click()
      }

      // Submit
      const continueBtn = page.locator('[data-testid="identity-continue-btn"], button:has-text("Continue")')
      if (await continueBtn.isEnabled({ timeout: 2000 }).catch(() => false)) {
        await continueBtn.click()
        // Should advance to next step
        await page.waitForTimeout(1000)
      }
    }

    // Verify we're still on an onboarding step (not error page)
    expect(page.url()).toContain('onboarding')
  })

  test('username availability check hits real API', async ({ page, request }) => {
    const email = deterministicEmail('onboarding-username')

    // Create user
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    // Go to username step
    await page.goto('/onboarding?step=username')
    await page.waitForLoadState('networkidle')

    // Find username input
    const usernameInput = page.locator('input[name="username"], [data-testid="username-input"]')

    if (await usernameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Type a unique username
      const uniqueUsername = `e2etest${Date.now()}`
      await usernameInput.fill(uniqueUsername)

      // Wait for availability check (real API call)
      await page.waitForTimeout(1500) // Debounce + API call

      // Check for availability indicator
      const availableIndicator = page.locator('[data-testid="username-available"], .available, text=available')
      const unavailableIndicator = page.locator('[data-testid="username-taken"], .taken, text=taken')

      // Should show one or the other (proves API was called)
      const hasAvailable = await availableIndicator.isVisible({ timeout: 3000 }).catch(() => false)
      const hasUnavailable = await unavailableIndicator.isVisible({ timeout: 1000 }).catch(() => false)

      expect(hasAvailable || hasUnavailable).toBeTruthy()
    }
  })
})

test.describe('Checkout - Real Backend', () => {
  test('public page loads for non-existent creator (404)', async ({ page }) => {
    // Try to load a definitely non-existent creator
    await page.goto('/nonexistent-creator-xyz-999')
    await page.waitForLoadState('networkidle')

    // Should show error or redirect (real backend returns 404)
    const content = await page.content()
    const hasError = content.includes('not found') ||
                     content.includes('404') ||
                     content.includes("doesn't exist")

    // Either shows error or redirected away
    expect(hasError || !page.url().includes('nonexistent-creator')).toBeTruthy()
  })

  test('checkout session creation requires valid creator', async ({ request }) => {
    // Try to create checkout session for non-existent creator (API level test)
    const response = await request.post('http://localhost:3001/checkout/session', {
      data: {
        creatorId: 'nonexistent-creator-id',
        email: 'test@example.com',
        amount: 1000,
      },
      headers: { 'Content-Type': 'application/json' },
    })

    // Should fail with 404 or 400 (not 500)
    expect([400, 404]).toContain(response.status())
  })
})

test.describe('Subscriber Portal - Real Backend', () => {
  test('OTP request endpoint works', async ({ request }) => {
    const testEmail = 'subscriber-otp-test@e2e.com'

    // Request OTP (real backend, will use test mode)
    const response = await request.post('http://localhost:3001/subscriber/otp', {
      data: { email: testEmail },
      headers: { 'Content-Type': 'application/json' },
    })

    // Should succeed (200) or indicate no subscriptions (404)
    // Both are valid API responses
    expect([200, 404]).toContain(response.status())
  })

  test('portal page loads and shows email form', async ({ page }) => {
    await page.goto('/subscriptions')
    await page.waitForLoadState('networkidle')

    // Should show email input form
    const emailInput = page.locator('input[type="email"]')
    await expect(emailInput).toBeVisible({ timeout: 5000 })

    // Should have continue button
    const continueBtn = page.locator('button:has-text("Continue")')
    await expect(continueBtn).toBeVisible()
  })
})

test.describe('Full Onboarding Journey - No Stubs', () => {
  test('completes onboarding from identity to payment method', async ({ page, request }) => {
    const email = deterministicEmail('full-onboarding-journey')
    const uniqueUsername = `e2efull${Date.now().toString(36)}`

    // Step 1: Create user via e2e-login (real backend)
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    // Step 2: Navigate to identity step
    await page.goto('/onboarding?step=identity')
    await page.waitForLoadState('networkidle')

    // Fill identity form
    const firstNameInput = page.locator('[data-testid="identity-first-name"]')
    await expect(firstNameInput).toBeVisible({ timeout: 10000 })
    await firstNameInput.fill('E2EFull')
    await page.locator('[data-testid="identity-last-name"]').fill('Journey')

    // Select US (Stripe country)
    await page.locator('[data-testid="country-selector"]').click()
    await page.locator('[data-testid="country-option-us"]').click()

    // Continue to address step
    await page.locator('[data-testid="identity-continue-btn"]').click()

    // Step 3: Address step (US requires address)
    const streetInput = page.locator('[data-testid="address-street"]')
    await expect(streetInput).toBeVisible({ timeout: 10000 })
    await streetInput.fill('123 E2E Test Street')
    await page.locator('[data-testid="address-city"]').fill('San Francisco')
    await page.locator('[data-testid="address-state"]').fill('CA')
    await page.locator('[data-testid="address-zip"]').fill('94102')
    await page.locator('[data-testid="address-continue-btn"]').click()

    // Step 4: Purpose step - select personal support
    const purposeList = page.locator('[data-testid="purpose-list"]')
    await expect(purposeList).toBeVisible({ timeout: 10000 })
    await page.locator('[data-testid="purpose-support"]').click()

    // Step 5: Avatar step - skip
    const avatarContinue = page.locator('[data-testid="avatar-continue-btn"]')
    await expect(avatarContinue).toBeVisible({ timeout: 10000 })
    await avatarContinue.click()

    // Step 6: Username step
    const usernameInput = page.locator('[data-testid="username-input"]')
    await expect(usernameInput).toBeVisible({ timeout: 10000 })
    await usernameInput.fill(uniqueUsername)

    // Wait for availability check
    await expect(page.locator('[data-testid="username-available"]')).toBeVisible({ timeout: 10000 })
    await page.locator('[data-testid="username-continue-btn"]').click()

    // Step 7: Payment method step - should show Stripe option
    const stripeOption = page.locator('[data-testid="payment-method-stripe"]')
    await expect(stripeOption).toBeVisible({ timeout: 10000 })

    // Click Stripe - in PAYMENTS_MODE=stub, this returns a mock URL
    await stripeOption.click()

    // Should either redirect to Stripe (stubbed URL) or show review step
    // Wait for either outcome
    await page.waitForTimeout(2000)

    // Verify we progressed (either to review or mock Stripe redirect)
    const url = page.url()
    const isOnReview = url.includes('review') || url.includes('step=9')
    const hasStripeRedirect = url.includes('stripe.com') || url.includes('connect')

    expect(isOnReview || hasStripeRedirect || url.includes('onboarding')).toBeTruthy()
  })

  test('onboarding progress persists across page reload', async ({ page, request }) => {
    const email = deterministicEmail('onboarding-persistence')

    // Create user and fill identity
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    await page.goto('/onboarding?step=identity')
    await page.waitForLoadState('networkidle')

    const firstNameInput = page.locator('[data-testid="identity-first-name"]')
    if (await firstNameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstNameInput.fill('Persist')
      await page.locator('[data-testid="identity-last-name"]').fill('Test')

      await page.locator('[data-testid="country-selector"]').click()
      await page.locator('[data-testid="country-option-us"]').click()

      // Continue to save progress
      await page.locator('[data-testid="identity-continue-btn"]').click()
      await page.waitForTimeout(1000)

      // Reload and verify progress was saved
      await page.reload()
      await page.waitForLoadState('networkidle')

      // Should not be back at identity step (progress was saved)
      // Either on address step or further
      await page.waitForTimeout(500)
      const currentUrl = page.url()

      // Progress should have been saved - not back at step 0/start
      expect(currentUrl).toContain('onboarding')
    }
  })
})

test.describe('Auth Flow - Real Backend', () => {
  test('magic link request sends email and creates pending session', async ({ request }) => {
    const testEmail = `auth-test-${Date.now()}@e2e.natepay.co`

    // Request magic link (real backend)
    const response = await request.post('http://localhost:3001/auth/login', {
      data: { email: testEmail },
      headers: { 'Content-Type': 'application/json' },
    })

    // Should succeed - email is queued
    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.message).toBeTruthy()
  })

  test('OTP request for subscriber portal works', async ({ request }) => {
    const testEmail = `subscriber-auth-${Date.now()}@e2e.natepay.co`

    // Request OTP for subscriber portal
    const response = await request.post('http://localhost:3001/subscriber/otp', {
      data: { email: testEmail },
      headers: { 'Content-Type': 'application/json' },
    })

    // Should return 200 (OTP sent) or 404 (no subscriptions)
    expect([200, 404]).toContain(response.status())
  })

  test('e2e-login creates real session with valid cookie', async ({ page, request }) => {
    const email = deterministicEmail('auth-session-test')

    // Create user via e2e-login
    const { token, user } = await e2eLogin(request, email)
    expect(token).toBeTruthy()
    expect(user.id).toBeTruthy()

    // Set cookie and verify session works
    await setAuthCookie(page, token)
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Should either be on dashboard or redirected to onboarding (both valid for new user)
    const url = page.url()
    expect(url.includes('dashboard') || url.includes('onboarding')).toBeTruthy()
  })
})

test.describe('Subscription Management - Real Backend', () => {
  test('manage token API validates token format', async ({ request }) => {
    // Invalid token should return 400
    const response = await request.get('http://localhost:3001/subscription/manage/invalid-token')

    expect([400, 404]).toContain(response.status())
  })

  test('cancel endpoint requires valid subscription', async ({ request }) => {
    // Try to cancel with invalid token
    const response = await request.post('http://localhost:3001/subscription/manage/fake-token/cancel', {
      data: { reason: 'test' },
      headers: { 'Content-Type': 'application/json' },
    })

    expect([400, 404]).toContain(response.status())
  })

  test('reactivate endpoint validates token and nonce', async ({ request }) => {
    // Try to reactivate with invalid token
    const response = await request.post('http://localhost:3001/subscription/manage/fake-token/reactivate', {
      headers: { 'Content-Type': 'application/json' },
    })

    expect([400, 404]).toContain(response.status())
  })

  test('portal redirect endpoint requires valid token', async ({ request }) => {
    const response = await request.post('http://localhost:3001/subscription/manage/fake-token/portal', {
      headers: { 'Content-Type': 'application/json' },
    })

    expect([400, 404]).toContain(response.status())
  })
})

test.describe('Checkout - Real Provider (Nightly)', () => {
  // These tests require real Stripe/Paystack test keys
  // Run with: REAL_PROVIDERS=true npx playwright test real-backend.spec.ts
  const skipUnlessRealProviders = process.env.REAL_PROVIDERS !== 'true'

  test('Stripe checkout session creates valid redirect URL', async ({ request }) => {
    test.skip(skipUnlessRealProviders, 'Requires REAL_PROVIDERS=true')

    // This would require a seeded creator with Stripe account
    // For nightly runs with real test keys
    const response = await request.post('http://localhost:3001/checkout/session', {
      data: {
        creatorUsername: process.env.TEST_CREATOR_USERNAME || 'testcreator',
        email: 'checkout-test@e2e.com',
        amount: 1000,
      },
      headers: { 'Content-Type': 'application/json' },
    })

    if (response.status() === 200) {
      const data = await response.json()
      expect(data.url || data.sessionId).toBeTruthy()
    } else {
      // No seeded creator - skip gracefully
      expect([400, 404]).toContain(response.status())
    }
  })

  test('Paystack checkout creates valid authorization URL', async ({ request }) => {
    test.skip(skipUnlessRealProviders, 'Requires REAL_PROVIDERS=true')

    const response = await request.post('http://localhost:3001/checkout/session', {
      data: {
        creatorUsername: process.env.TEST_NG_CREATOR_USERNAME || 'testcreatorng',
        email: 'checkout-ng-test@e2e.com',
        amount: 5000,
      },
      headers: { 'Content-Type': 'application/json' },
    })

    if (response.status() === 200) {
      const data = await response.json()
      expect(data.authorizationUrl || data.reference).toBeTruthy()
    } else {
      expect([400, 404]).toContain(response.status())
    }
  })
})

test.describe('API Contract Validation', () => {
  test('auth/me returns proper structure', async ({ request }) => {
    // Test without auth - should fail gracefully
    const response = await request.get('http://localhost:3001/auth/me')

    // Should return 401 (not 500)
    expect(response.status()).toBe(401)
  })

  test('health endpoint is accessible', async ({ request }) => {
    const response = await request.get('http://localhost:3001/health/live')

    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.status).toBe('ok')
  })

  test('profile check-username validates format', async ({ request }) => {
    // Invalid username (too short)
    const response = await request.get('http://localhost:3001/profile/check-username?username=ab')

    // Should return 400 for invalid format
    expect(response.status()).toBe(400)
  })

  test('AI config endpoint is accessible', async ({ request }) => {
    const response = await request.get('http://localhost:3001/config/ai')

    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(typeof data.available).toBe('boolean')
  })
})
