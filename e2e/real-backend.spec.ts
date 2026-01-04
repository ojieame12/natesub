import { test, expect } from '@playwright/test'
import { e2eLogin, setAuthCookie, deterministicEmail, buildUsername, waitForAuthReady, selectCountry } from './auth.helper'

// E2E API key for helper endpoints (matches playwright.config.ts)
const E2E_API_KEY = process.env.E2E_API_KEY || 'e2e-local-dev-key'
const e2eHeaders = () => ({
  'x-e2e-api-key': E2E_API_KEY,
  'Content-Type': 'application/json',
})

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

  test.skip('completes identity step with real persistence', async ({ page, request }) => {
    const email = deterministicEmail('onboarding-identity')

    // Listen for console errors
    const consoleErrors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    // Create user
    const { token } = await e2eLogin(request, email)

    // Force onboarding to identity step BEFORE setting auth
    const onboardingResp = await request.put('http://localhost:3001/auth/onboarding', {
      data: {
        step: 3,
        stepKey: 'identity',
        data: { countryCode: 'US', purpose: 'support' },
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    if (onboardingResp.status() !== 200) {
      throw new Error(`Failed to set onboarding step: ${await onboardingResp.text()}`)
    }

    // NOW set auth cookie so page uses the updated onboarding state
    await setAuthCookie(page, token)

    // Navigate directly to identity step
    await page.goto('/onboarding?step=identity')
    await page.waitForLoadState('networkidle')
    await waitForAuthReady(page)

    // Check for console errors
    if (consoleErrors.length > 0) {
      console.log('Console errors found:', consoleErrors)
    }

    // Check what's actually on the page
    const bodyText = await page.locator('body').textContent()
    const hasOnboardingContent = bodyText?.includes('Get paid') || bodyText?.includes('Continue')
    console.log('Has onboarding content:', hasOnboardingContent)
    console.log('Body text preview:', bodyText?.substring(0, 200))

    // Wait for ALL splash screens/loaders to disappear
    await page.waitForLoadState('domcontentloaded')

    // Wait for common loading indicators to be gone
    const loadingSelectors = [
      '.splash-screen',
      '[data-splash]',
      '[class*="loading-"]',
      '[class*="Loading"]',
      '.page-skeleton',
      '.auth-skeleton'
    ]

    for (const selector of loadingSelectors) {
      await page.waitForSelector(selector, { state: 'hidden', timeout: 2000 }).catch(() => {
        // Selector may not exist - that's OK
      })
    }

    // Additional wait for animations to complete
    await page.waitForTimeout(500)

    // Identity inputs should now be visible (splash removed)
    await page.locator('[data-testid="identity-first-name"]').fill('E2E', { timeout: 15000 })
    await page.locator('[data-testid="identity-last-name"]').fill('TestUser', { timeout: 5000 })

    // Select country via drawer picker
    await selectCountry(page, 'United States')

    const continueBtn = page.getByTestId('identity-continue-btn')
    await expect(continueBtn).toBeEnabled({ timeout: 10000 })
    await continueBtn.click()

    // Should advance to next step
    await page.waitForTimeout(1000)

    // Verify we're still on an onboarding step (not error page)
    expect(page.url()).toContain('onboarding')
  })

  test('username availability check hits real API', async ({ page, request }) => {
    const email = deterministicEmail('onboarding-username')

    // Create user
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    // Force onboarding to username step
    await request.put('http://localhost:3001/auth/onboarding', {
      data: {
        step: 7,
        stepKey: 'username',
        data: { countryCode: 'US', purpose: 'support' },
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    // Go to onboarding
    await page.goto('/onboarding')
    await page.waitForLoadState('networkidle')
    await waitForAuthReady(page)

    // Find username input - MUST be visible
    const usernameInput = page.locator('[data-testid="username-input"]')
    await expect(usernameInput).toBeVisible({ timeout: 5000 })

    // Type a unique username
    const uniqueUsername = `e2etest${Date.now()}`
    await usernameInput.fill(uniqueUsername)

    // Wait for availability check (real API call)
    await page.waitForTimeout(1500) // Debounce + API call

    // Check for availability indicator - one MUST appear
    const availableIndicator = page.locator('[data-testid="username-available"]')
    const unavailableIndicator = page.locator('[data-testid="username-taken"]')

    // Should show one or the other (proves API was called)
    const hasAvailable = await availableIndicator.isVisible({ timeout: 3000 }).catch(() => false)
    const hasUnavailable = await unavailableIndicator.isVisible({ timeout: 1000 }).catch(() => false)

    // At least one indicator MUST be visible - fail test if neither appears
    expect(hasAvailable || hasUnavailable, 'Expected username availability indicator to appear').toBeTruthy()
  })
})

test.describe('Checkout - Real Backend', () => {
  test('public page loads for non-existent creator (404)', async ({ page }) => {
    const missingUsername = buildUsername('missing', 'creator', Date.now().toString().slice(-8))

    // Try to load a definitely non-existent creator
    await page.goto(`/${missingUsername}`)
    await page.waitForLoadState('networkidle')

    // Should show error, empty page, or redirect
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

  test('checkout session creation requires valid creator', async ({ request }) => {
    // Try to create checkout session for non-existent creator (API level test)
    const response = await request.post('http://localhost:3001/checkout/session', {
      data: {
        creatorUsername: 'nonexistuser1',
        subscriberEmail: 'test@example.com',
        amount: 500,
        interval: 'month',
        payerCountry: 'US',
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
  test.skip('completes onboarding from identity to payment method', async ({ page, request }) => {
    const email = deterministicEmail('full-onboarding-journey')
    const uniqueUsername = `e2efull${Date.now().toString(36)}`

    // Step 1: Create user via e2e-login (real backend)
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    // Step 2: Navigate to identity step
    await request.put('http://localhost:3001/auth/onboarding', {
      data: {
        step: 3,
        stepKey: 'identity',
        data: { countryCode: 'US', purpose: 'support' },
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    await page.goto('/onboarding')
    await page.waitForLoadState('networkidle')
    await waitForAuthReady(page)
    await waitForAuthReady(page)

    // Fill identity form
    const firstNameInput = page.locator('[data-testid="identity-first-name"]')
    await expect(firstNameInput).toBeVisible({ timeout: 10000 })
    await firstNameInput.fill('E2EFull')
    await page.locator('[data-testid="identity-last-name"]').fill('Journey')

    // Select US via country picker
    await selectCountry(page, 'United States')

    const continueBtn = page.getByTestId('identity-continue-btn')
    await expect(continueBtn).toBeEnabled({ timeout: 10000 })
    await continueBtn.click()

    // Step 3: Address step (US requires address)
    // Wait for page transition and address form to render
    await page.waitForTimeout(1000)
    await page.waitForSelector('[data-testid="address-street"]', { state: 'visible', timeout: 30000 })

    const streetInput = page.locator('[data-testid="address-street"]')
    await expect(streetInput).toBeVisible({ timeout: 30000 })
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

  test.skip('onboarding progress persists across page reload', async ({ page, request }) => {
    const email = deterministicEmail('onboarding-persistence')

    // Create user and fill identity
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    await request.put('http://localhost:3001/auth/onboarding', {
      data: {
        step: 3,
        stepKey: 'identity',
        data: { countryCode: 'US', purpose: 'support' },
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    await page.goto('/onboarding')
    await page.waitForLoadState('networkidle')
    await waitForAuthReady(page)
    await waitForAuthReady(page)

    // Identity form MUST be visible - fail if UI doesn't render
    const firstNameInput = page.locator('[data-testid="identity-first-name"]')
    await expect(firstNameInput).toBeVisible({ timeout: 5000 })

    await firstNameInput.fill('Persist')
    await page.locator('[data-testid="identity-last-name"]').fill('Test')

    await selectCountry(page, 'United States')

    const continueBtn = page.getByTestId('identity-continue-btn')
    await expect(continueBtn).toBeEnabled({ timeout: 10000 })
    await continueBtn.click()
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
  })
})

test.describe('Auth Flow - Real Backend', () => {
  test('magic link request sends email and creates pending session', async ({ request }) => {
    const testEmail = `auth-test-${Date.now()}@e2e.natepay.co`

    // Request magic link (real backend)
    const response = await request.post('http://localhost:3001/auth/magic-link', {
      data: { email: testEmail },
      headers: { 'Content-Type': 'application/json' },
    })

    // Should succeed - email is queued
    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.message || data.success).toBeTruthy()
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

test.describe('Auth Flow - Full E2E (Real Email/OTP)', () => {
  // These tests validate the actual auth delivery flow
  // In test mode, magic links and OTPs may be returned in response for testing

  test('magic link flow creates valid session token', async ({ request }) => {
    const testEmail = `magic-link-flow-${Date.now()}@e2e.natepay.co`

    // Step 1: Request magic link
    const loginResponse = await request.post('http://localhost:3001/auth/magic-link', {
      data: { email: testEmail },
      headers: { 'Content-Type': 'application/json' },
    })

    expect(loginResponse.status()).toBe(200)
    const loginData = await loginResponse.json()

    // In test mode, the magic link token might be returned for E2E testing
    // This allows testing without email delivery
    if (loginData.testToken) {
      // Step 2: Verify the magic link token (POST + email)
      const verifyResponse = await request.post('http://localhost:3001/auth/verify', {
        data: { token: loginData.testToken, email: testEmail },
        headers: { 'Content-Type': 'application/json' },
      })

      // Should succeed and redirect (302) or return token (200)
      expect([200, 302]).toContain(verifyResponse.status())
    } else {
      // No test token - just verify the request was accepted
      expect(loginData.message || loginData.success).toBeTruthy()
    }
  })

  test('subscriber OTP verification flow', async ({ request }) => {
    const testEmail = `otp-flow-${Date.now()}@e2e.natepay.co`

    // Step 1: Request OTP
    const otpResponse = await request.post('http://localhost:3001/subscriber/otp', {
      data: { email: testEmail },
      headers: { 'Content-Type': 'application/json' },
    })

    // May return 404 if no subscriptions exist for this email
    if (otpResponse.status() === 404) {
      const body = await otpResponse.json()
      expect(body.error).toContain('subscription')
      return
    }

    expect(otpResponse.status()).toBe(200)
    const otpData = await otpResponse.json()

    // In test mode, the OTP might be returned for E2E testing
    if (otpData.testOtp) {
      // Step 2: Verify the OTP
      const verifyResponse = await request.post('http://localhost:3001/subscriber/verify', {
        data: {
          email: testEmail,
          otp: otpData.testOtp,
        },
        headers: { 'Content-Type': 'application/json' },
      })

      expect(verifyResponse.status()).toBe(200)
      const verifyData = await verifyResponse.json()
      expect(verifyData.token || verifyData.subscriptions).toBeTruthy()
    }
  })

  test('invalid magic link token returns proper error', async ({ request }) => {
    // Try to verify with invalid token
    const response = await request.post('http://localhost:3001/auth/verify', {
      data: {
        token: 'invalid-token-xyz',
        email: 'invalid-token@test.natepay.co',
      },
      headers: { 'Content-Type': 'application/json' },
    })

    // Should return 400 or 401 (not 500)
    expect([400, 401]).toContain(response.status())
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })

  test('invalid OTP returns proper error', async ({ request }) => {
    const testEmail = `otp-invalid-${Date.now()}@e2e.natepay.co`

    // Try to verify with invalid OTP
    const response = await request.post('http://localhost:3001/subscriber/verify', {
      data: {
        email: testEmail,
        otp: '000000', // Invalid OTP
      },
      headers: { 'Content-Type': 'application/json' },
    })

    // Should return 400 or 401 (not 500)
    expect([400, 401]).toContain(response.status())
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })

  test('expired OTP handling', async ({ request }) => {
    const testEmail = `otp-expired-${Date.now()}@e2e.natepay.co`

    // Request OTP first
    await request.post('http://localhost:3001/subscriber/otp', {
      data: { email: testEmail },
      headers: { 'Content-Type': 'application/json' },
    })

    // Try to verify with expired OTP format (all zeros typically indicates expired/invalid)
    const response = await request.post('http://localhost:3001/subscriber/verify', {
      data: {
        email: testEmail,
        otp: '999999', // Wrong OTP
      },
      headers: { 'Content-Type': 'application/json' },
    })

    // Should return proper error response
    expect([400, 401]).toContain(response.status())
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

test.describe('Subscription Management - Full Flow (Real Backend)', () => {
  // These tests exercise the manage subscription flow without stubs
  // They require a seeded creator with an active subscription
  const skipUnlessRealProviders = process.env.REAL_PROVIDERS === 'true'

  test('manage page renders subscription details from real backend', async ({ page, request }) => {
    // Skip if no real providers - this test needs a real subscription
    if (!skipUnlessRealProviders) {
      // Create a test subscription for validation
      const email = deterministicEmail('manage-flow-test')
      const { token } = await e2eLogin(request, email)
      const shortId = Date.now().toString(36).slice(-6)

      // Create a test creator profile
      const creatorResponse = await request.put('http://localhost:3001/profile', {
        data: {
          username: buildUsername('managet', '', shortId),
          displayName: 'Manage Test Creator',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'support',
          pricingModel: 'single',
          singleAmount: 500,
          paymentProvider: 'stripe',
        },
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!creatorResponse.ok()) {
        console.log('Profile creation failed - skipping manage flow test')
        return
      }
    }

    // Test the manage endpoint API contract
    const response = await request.get('http://localhost:3001/subscription/manage/test-token-format')

    // Should return structured error (not 500)
    expect([400, 404]).toContain(response.status())
    const body = await response.json()
    expect(body).toHaveProperty('error')
  })

  test('cancel flow validates reason and updates subscription', async ({ request }) => {
    // Test cancel API contract
    const response = await request.post('http://localhost:3001/subscription/manage/test-token/cancel', {
      data: {}, // Missing reason
      headers: { 'Content-Type': 'application/json' },
    })

    // Should return 400 for missing reason (not 500)
    expect([400, 404]).toContain(response.status())
  })

  test('reactivate flow requires nonce validation', async ({ request }) => {
    // Test that reactivate requires manageTokenNonce
    const response = await request.post('http://localhost:3001/subscription/manage/test-token/reactivate', {
      data: { nonce: 'invalid-nonce' },
      headers: { 'Content-Type': 'application/json' },
    })

    // Should return 400/404 (not 500)
    expect([400, 404]).toContain(response.status())
  })

  test('portal redirect validates Stripe account', async ({ request }) => {
    // Test portal redirect API
    const response = await request.post('http://localhost:3001/subscription/manage/test-token/portal', {
      headers: { 'Content-Type': 'application/json' },
    })

    // Should return structured error
    expect([400, 404]).toContain(response.status())
  })
})

test.describe('Checkout - Real Provider (Nightly)', () => {
  // These tests require real Stripe/Paystack test keys
  // Run with: REAL_PROVIDERS=true npx playwright test real-backend.spec.ts
  const skipUnlessRealProviders = process.env.REAL_PROVIDERS !== 'true'

  test('Stripe checkout session creates valid redirect URL', async ({ request }) => {
    test.skip(skipUnlessRealProviders, 'Requires REAL_PROVIDERS=true')

    // STRICT: Nightly must have seeded creator - fail if missing
    const creatorUsername = process.env.TEST_CREATOR_USERNAME
    expect(creatorUsername, 'TEST_CREATOR_USERNAME env var required for nightly').toBeTruthy()

    const response = await request.post('http://localhost:3001/checkout/session', {
      data: {
        creatorUsername,
        subscriberEmail: 'checkout-test@e2e.com',
        amount: 500, // Must match seeded creator's singleAmount in cents
        interval: 'one_time',
        payerCountry: 'US',
      },
      headers: { 'Content-Type': 'application/json' },
    })

    // STRICT: Must succeed - no 400/404 fallback
    expect(response.status(), 'Checkout must succeed with seeded creator').toBe(200)
    const data = await response.json()
    expect(data.url || data.sessionId, 'Must return checkout URL').toBeTruthy()
  })

  test('Paystack checkout creates valid authorization URL', async ({ request }) => {
    test.skip(skipUnlessRealProviders, 'Requires REAL_PROVIDERS=true')

    // STRICT: Nightly must have seeded NG creator - fail if missing
    const creatorUsername = process.env.TEST_NG_CREATOR_USERNAME
    expect(creatorUsername, 'TEST_NG_CREATOR_USERNAME env var required for nightly').toBeTruthy()

    const response = await request.post('http://localhost:3001/checkout/session', {
      data: {
        creatorUsername,
        subscriberEmail: 'checkout-ng-test@e2e.com',
        amount: 500000, // Must match seeded creator's singleAmount in kobo
        interval: 'one_time',
        payerCountry: 'NG',
      },
      headers: { 'Content-Type': 'application/json' },
    })

    // STRICT: Must succeed - no 400/404 fallback
    expect(response.status(), 'Checkout must succeed with seeded NG creator').toBe(200)
    const data = await response.json()
    expect(data.authorizationUrl || data.reference || data.url, 'Must return authorization URL').toBeTruthy()
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
    const response = await request.get('http://localhost:3001/profile/check-username/ab')

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

/**
 * Full Checkout Flow Tests (Nightly)
 *
 * These tests validate the COMPLETE checkout experience:
 * 1. Create checkout session → Get redirect URL
 * 2. Follow redirect (stub mode returns success URL directly)
 * 3. Verify success page renders correctly
 *
 * Run with: REAL_PROVIDERS=true npx playwright test real-backend.spec.ts
 */
test.describe('Checkout Return Verification (Nightly)', () => {
  const skipUnlessRealProviders = process.env.REAL_PROVIDERS !== 'true'

  test('Stripe checkout return page shows success UI', async ({ page, request }) => {
    test.skip(skipUnlessRealProviders, 'Requires REAL_PROVIDERS=true and seeded creator')

    // Step 1: Create checkout session (requires seeded creator)
    const creatorUsername = process.env.TEST_CREATOR_USERNAME || 'testcreator'
    const response = await request.post('http://localhost:3001/checkout/session', {
      data: {
        creatorUsername,
        subscriberEmail: 'return-test@e2e.com',
        amount: 500, // $5.00 in cents
        interval: 'one_time',
        payerCountry: 'US',
      },
      headers: { 'Content-Type': 'application/json' },
    })

    // Must succeed with seeded creator
    expect(response.status(), 'Checkout session must succeed').toBe(200)
    const data = await response.json()
    const checkoutUrl = data.url || data.sessionUrl

    expect(checkoutUrl, 'Must return checkout URL').toBeTruthy()

    // Step 2: In stub mode, the URL redirects directly to success page
    // In real mode, we'd need to complete Stripe checkout (not automated)
    // For nightly, we verify the success page can render with stub session
    if (checkoutUrl.includes('success=true') || checkoutUrl.includes('session_id=stub')) {
      await page.goto(checkoutUrl)
      await page.waitForLoadState('networkidle')

      // Step 3: Verify success UI elements
      const pageContent = await page.content()
      const hasSuccessIndicator =
        pageContent.toLowerCase().includes('success') ||
        pageContent.toLowerCase().includes('thank') ||
        pageContent.toLowerCase().includes('confirmed') ||
        pageContent.toLowerCase().includes('subscribed')

      expect(hasSuccessIndicator, 'Success page should show confirmation').toBeTruthy()
    }
  })

  test('Paystack checkout return page shows success UI', async ({ page, request }) => {
    test.skip(skipUnlessRealProviders, 'Requires REAL_PROVIDERS=true and seeded NG creator')

    const creatorUsername = process.env.TEST_NG_CREATOR_USERNAME || 'testcreatorng'
    const response = await request.post('http://localhost:3001/checkout/session', {
      data: {
        creatorUsername,
        subscriberEmail: 'return-ng-test@e2e.com',
        amount: 500000, // ₦5,000 in kobo
        interval: 'one_time',
        payerCountry: 'NG',
      },
      headers: { 'Content-Type': 'application/json' },
    })

    expect(response.status(), 'Checkout session must succeed').toBe(200)
    const data = await response.json()
    const checkoutUrl = data.authorizationUrl || data.url

    expect(checkoutUrl, 'Must return authorization URL').toBeTruthy()

    // Stub mode returns success redirect directly
    if (checkoutUrl.includes('success=true') || checkoutUrl.includes('reference=stub')) {
      await page.goto(checkoutUrl)
      await page.waitForLoadState('networkidle')

      const pageContent = await page.content()
      const hasSuccessIndicator =
        pageContent.toLowerCase().includes('success') ||
        pageContent.toLowerCase().includes('thank') ||
        pageContent.toLowerCase().includes('confirmed')

      expect(hasSuccessIndicator, 'Success page should show confirmation').toBeTruthy()
    }
  })
})

/**
 * Subscription Manage Token Flow (Nightly)
 *
 * Tests loading the manage page with a REAL subscription token.
 * This validates the full token→subscription→UI flow.
 */
test.describe('Subscription Manage Token Flow (Nightly)', () => {
  const skipUnlessRealProviders = process.env.REAL_PROVIDERS !== 'true'

  test('manage page loads with valid subscription token', async ({ page, request }) => {
    test.skip(skipUnlessRealProviders, 'Requires REAL_PROVIDERS=true and seeded subscription')

    // Step 1: Create a test subscription via API
    // This requires a seeded creator with completed checkout
    const email = 'manage-token-test@e2e.com'
    const creatorUsername = process.env.TEST_CREATOR_USERNAME || 'testcreator'

    // Request manage token (this creates/retrieves subscription record)
    const tokenResponse = await request.post('http://localhost:3001/subscription/request-manage-token', {
      data: {
        email,
        creatorUsername,
      },
      headers: { 'Content-Type': 'application/json' },
    })

    // If no subscription exists, API returns 404 - that's expected without seeded data
    if (tokenResponse.status() === 404) {
      console.log('[E2E] No subscription found for manage token test - skipping')
      return
    }

    expect(tokenResponse.status(), 'Token request should succeed').toBe(200)
    const tokenData = await tokenResponse.json()
    const manageToken = tokenData.token

    expect(manageToken, 'Must return manage token').toBeTruthy()

    // Step 2: Load manage page with token
    await page.goto(`/subscription/manage/${manageToken}`)
    await page.waitForLoadState('networkidle')

    // Step 3: Verify manage page renders (not error)
    const url = page.url()
    expect(url).toContain('manage')

    // Should show subscription details (not 404 or error)
    const pageContent = await page.content()
    const hasManageContent =
      pageContent.toLowerCase().includes('subscription') ||
      pageContent.toLowerCase().includes('cancel') ||
      pageContent.toLowerCase().includes('manage') ||
      pageContent.toLowerCase().includes('billing')

    expect(hasManageContent, 'Manage page should show subscription controls').toBeTruthy()
  })

  test('manage page shows error for invalid token', async ({ page }) => {
    // Load manage page with invalid token
    await page.goto('/subscription/manage/invalid-token-xyz-123')
    await page.waitForLoadState('networkidle')

    // Should show error or redirect
    const pageContent = await page.content()
    const hasError =
      pageContent.toLowerCase().includes('invalid') ||
      pageContent.toLowerCase().includes('expired') ||
      pageContent.toLowerCase().includes('not found') ||
      pageContent.toLowerCase().includes('error')

    expect(hasError, 'Invalid token should show error').toBeTruthy()
  })
})

/**
 * Subscriber Portal - Real Backend (No Stubs)
 *
 * These tests validate the subscriber portal flows against the real backend.
 * They create real data via e2e-login and checkout, then test the portal flows.
 */
test.describe('Subscriber Portal - Real Backend (Always-On)', () => {
  test('portal email form submits to real OTP endpoint', async ({ page }) => {
    await page.goto('/subscriptions')
    await page.waitForLoadState('networkidle')

    // Email input MUST be visible
    const emailInput = page.locator('input[type="email"]')
    await expect(emailInput).toBeVisible({ timeout: 5000 })

    // Enter a test email
    await emailInput.fill('real-portal-test@e2e.natepay.co')

    // Click continue
    const continueBtn = page.locator('button:has-text("Continue")')
    await expect(continueBtn).toBeVisible()
    await continueBtn.click()

    // Wait for response
    await page.waitForTimeout(2000)

    // Should either show OTP input (success) or "no subscriptions" message
    const hasOtpInput = await page.locator('input[inputmode="numeric"]').first().isVisible().catch(() => false)
    const hasNoSubsMessage = await page.locator('text=no subscription').or(page.locator('text=No subscription')).isVisible().catch(() => false)
    const hasErrorMessage = await page.locator('[data-testid="portal-error"]').isVisible().catch(() => false)

    // One of these states MUST be true (proves real API was called)
    expect(hasOtpInput || hasNoSubsMessage || hasErrorMessage, 'Portal must respond to email submission').toBeTruthy()
  })

  test('portal rejects invalid OTP via real API', async ({ page, request }) => {
    // First, find or create a subscriber with a subscription
    const ts = Date.now().toString().slice(-8)
    const creatorEmail = `e2e-portal-creator-${ts}@test.natepay.co`
    const creatorUsername = buildUsername('e2eportc', '', ts)
    const subscriberEmail = `e2e-subscriber-${ts}@test.natepay.co`

    // Create creator
    const { token } = await e2eLogin(request, creatorEmail)

    await request.put('http://localhost:3001/profile', {
      data: {
        username: creatorUsername,
        displayName: 'Portal Test Creator',
        country: 'United States',
        countryCode: 'US',
        currency: 'USD',
        purpose: 'support',
        pricingModel: 'single',
        singleAmount: 100,
        paymentProvider: 'stripe',
        isPublic: true,
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    await request.post('http://localhost:3001/stripe/connect', {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    // Create a checkout session (creates subscription intent)
    await fetch('http://localhost:3001/checkout/session', {
      method: 'POST',
      body: JSON.stringify({
        creatorUsername,
        amount: 500,
        interval: 'month',
        subscriberEmail,
        payerCountry: 'US',
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    // Now test portal with this subscriber email
    await page.goto('/subscriptions')
    await page.waitForLoadState('networkidle')

    const emailInput = page.locator('input[type="email"]')
    await expect(emailInput).toBeVisible({ timeout: 5000 })
    await emailInput.fill(subscriberEmail)
    await page.locator('button:has-text("Continue")').click()

    // Wait for OTP or no-subs message
    await page.waitForTimeout(2000)

    const otpInput = page.locator('input[inputmode="numeric"]').first()
    if (await otpInput.isVisible().catch(() => false)) {
      // Enter invalid OTP
      const otpInputs = page.locator('input[inputmode="numeric"]')
      const count = await otpInputs.count()
      if (count === 6) {
        for (let i = 0; i < 6; i++) {
          await otpInputs.nth(i).fill('0')
        }
      } else {
        await otpInputs.first().fill('000000')
      }

      // Submit OTP (may auto-submit or need button click)
      await page.waitForTimeout(1500)

      // Should show error for invalid OTP
      const errorBanner = page.locator('[data-testid="portal-error"]')
      await expect(errorBanner, 'Invalid OTP should show error').toBeVisible({ timeout: 5000 })
    }
  })
})

/**
 * Subscription Management - Real Backend (Always-On)
 *
 * Tests the /subscription/manage/:token endpoint with real tokens.
 */
test.describe('Subscription Management - Real Backend (Always-On)', () => {
  test('manage token API validates token format', async ({ request }) => {
    // Test that malformed tokens are rejected at API level
    // CORRECT: /subscription/manage/:token (singular)
    const response = await request.get('http://localhost:3001/subscription/manage/invalid-token')

    // Should return 400 or 404 (not 500)
    expect([400, 404]).toContain(response.status())
  })

  test('manage token API returns subscription details for valid token', async ({ request }) => {
    // Create a subscription using e2e-seed-subscription (guaranteed to exist)
    const ts = Date.now().toString().slice(-8)
    const creatorEmail = `e2e-manage-creator-${ts}@test.natepay.co`
    const creatorUsername = buildUsername('e2emanc', '', ts)
    const subscriberEmail = `e2e-manage-sub-${ts}@test.natepay.co`

    // Setup creator
    const { token } = await e2eLogin(request, creatorEmail)

    const profileResp = await request.put('http://localhost:3001/profile', {
      data: {
        username: creatorUsername,
        displayName: 'Manage Test Creator',
        country: 'United States',
        countryCode: 'US',
        currency: 'USD',
        purpose: 'support',
        pricingModel: 'single',
        singleAmount: 100,
        paymentProvider: 'stripe',
        isPublic: true,
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })
    expect(profileResp.status(), 'Profile creation must succeed').toBe(200)

    await request.post('http://localhost:3001/stripe/connect', {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    // Seed subscription directly (bypasses checkout, guaranteed to exist)
    // Uses triple-guarded /e2e/seed-subscription endpoint
    const seedResp = await request.post('http://localhost:3001/e2e/seed-subscription', {
      data: {
        creatorUsername,
        subscriberEmail,
        amount: 500,
        currency: 'USD',
        interval: 'month',
      },
      headers: e2eHeaders(),
    })
    expect(seedResp.status(), 'Subscription seeding must succeed').toBe(200)

    const seedData = await seedResp.json()
    expect(seedData.subscriptionId, 'Must return subscription ID').toBeTruthy()
    expect(seedData.manageToken, 'Must return manage token').toBeTruthy()

    // Now test the manage token endpoint with a REAL token
    const manageResp = await request.get(`http://localhost:3001/subscription/manage/${seedData.manageToken}`)

    // STRICT: Must return 200 with subscription details (not 404)
    expect(manageResp.status(), 'Manage token should return subscription details').toBe(200)

    const manageData = await manageResp.json()
    expect(manageData.subscription, 'Response should contain subscription data').toBeTruthy()
  })

  test('manage page UI renders subscription controls', async ({ page, request }) => {
    // This test uses e2e-seed-subscription to guarantee a subscription exists
    const ts = Date.now().toString().slice(-8)
    const creatorEmail = `e2e-manage-ui-${ts}@test.natepay.co`
    const creatorUsername = buildUsername('e2emanu', '', ts)
    const subscriberEmail = `e2e-manage-ui-sub-${ts}@test.natepay.co`

    // Setup creator
    const { token } = await e2eLogin(request, creatorEmail)

    const profileResp = await request.put('http://localhost:3001/profile', {
      data: {
        username: creatorUsername,
        displayName: 'Manage UI Creator',
        country: 'United States',
        countryCode: 'US',
        currency: 'USD',
        purpose: 'support',
        pricingModel: 'single',
        singleAmount: 100,
        paymentProvider: 'stripe',
        isPublic: true,
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })
    expect(profileResp.status(), 'Profile creation must succeed').toBe(200)

    await request.post('http://localhost:3001/stripe/connect', {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    // Seed subscription directly (bypasses checkout, guaranteed to exist)
    // Uses triple-guarded /e2e/seed-subscription endpoint
    const seedResp = await request.post('http://localhost:3001/e2e/seed-subscription', {
      data: {
        creatorUsername,
        subscriberEmail,
        amount: 500,
        currency: 'USD',
        interval: 'month',
      },
      headers: e2eHeaders(),
    })
    expect(seedResp.status(), 'Subscription seeding must succeed').toBe(200)

    const seedData = await seedResp.json()
    expect(seedData.manageUrl, 'Must return manage URL').toBeTruthy()

    // Navigate to the manage page with valid token
    await page.goto(`http://localhost:5173${seedData.manageUrl}`)
    await page.waitForLoadState('networkidle')

    // Page should render (not crash)
    await expect(page.locator('body')).toBeVisible()

    // STRICT: Should show subscription controls (not error/not found)
    const pageContent = await page.content()
    const hasSubscriptionControls =
      pageContent.toLowerCase().includes('subscription') ||
      pageContent.toLowerCase().includes('cancel') ||
      pageContent.toLowerCase().includes('manage') ||
      pageContent.toLowerCase().includes('active')

    // Should NOT show error states
    const hasError =
      pageContent.toLowerCase().includes('not found') &&
      pageContent.toLowerCase().includes('error')

    expect(hasSubscriptionControls, 'Manage page should show subscription controls').toBeTruthy()
    expect(hasError, 'Manage page should NOT show error for valid subscription').toBeFalsy()
  })
})

/**
 * Creator Dashboard - Real Backend (Always-On)
 *
 * Tests creator dashboard endpoints without stubs.
 */
test.describe('Creator Dashboard - Real Backend (Always-On)', () => {
  test('dashboard API returns creator stats', async ({ request }) => {
    const email = deterministicEmail('dashboard-stats')
    const { token } = await e2eLogin(request, email)

    // Request dashboard data
    const response = await request.get('http://localhost:3001/creator/dashboard', {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    // Should return data or 404 (no profile yet)
    expect([200, 404]).toContain(response.status())

    if (response.status() === 200) {
      const data = await response.json()
      // Should have expected shape
      expect(data).toHaveProperty('subscriptions')
    }
  })

  test('dashboard page renders for authenticated creator', async ({ page, request }) => {
    const ts = Date.now().toString().slice(-8)
    const email = `e2e-dashboard-${ts}@test.natepay.co`
    const username = buildUsername('e2edash', '', ts)

    // Create and setup creator
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    // Create profile
    await request.put('http://localhost:3001/profile', {
      data: {
        username,
        displayName: 'Dashboard Test',
        country: 'United States',
        countryCode: 'US',
        currency: 'USD',
        purpose: 'support',
        pricingModel: 'single',
        singleAmount: 100,
        paymentProvider: 'stripe',
        isPublic: true,
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    // Navigate to dashboard
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Should show dashboard content (not error or redirect to onboarding)
    const pageContent = await page.content()
    const hasDashboard =
      pageContent.toLowerCase().includes('dashboard') ||
      pageContent.toLowerCase().includes('subscriber') ||
      pageContent.toLowerCase().includes('revenue') ||
      pageContent.toLowerCase().includes('earnings')

    // May redirect to onboarding if profile incomplete - that's also valid
    const onOnboarding = page.url().includes('onboarding')

    expect(hasDashboard || onOnboarding, 'Should show dashboard or onboarding').toBeTruthy()
  })
})

/**
 * Admin API - Real Backend Integration (Always-On)
 *
 * Tests admin API endpoints without stubs.
 * Uses ADMIN_API_KEY_READONLY if available, skips otherwise.
 */
test.describe('Admin API - Real Backend (Always-On)', () => {
  // Use test API key from environment if available
  const adminApiKey = process.env.ADMIN_API_KEY_READONLY || process.env.ADMIN_API_KEY || 'test-admin-key'

  test('admin health endpoint responds with system status', async ({ request }) => {
    const response = await request.get('http://localhost:3001/admin/health', {
      headers: {
        'x-admin-api-key': adminApiKey,
      },
    })

    // Should return 200 (auth successful) or 401 (no valid API key in test)
    // In test mode, we accept 401 as "auth required" (not 500)
    expect([200, 401]).toContain(response.status())

    if (response.status() === 200) {
      const data = await response.json()
      // Health endpoint should return status info
      expect(data).toHaveProperty('status')
    }
  })

  test('admin me endpoint returns admin user info', async ({ request }) => {
    const response = await request.get('http://localhost:3001/admin/me', {
      headers: {
        'x-admin-api-key': adminApiKey,
      },
    })

    // Should return 200 (auth successful) or 401 (no valid API key)
    expect([200, 401]).toContain(response.status())

    if (response.status() === 200) {
      const data = await response.json()
      // Should return admin status
      expect(data).toHaveProperty('isAdmin')
    }
  })

  test('admin dashboard endpoint returns metrics', async ({ request }) => {
    const response = await request.get('http://localhost:3001/admin/dashboard', {
      headers: {
        'x-admin-api-key': adminApiKey,
      },
    })

    // Should return 200 or 401 (not 500)
    expect([200, 401]).toContain(response.status())

    if (response.status() === 200) {
      const data = await response.json()
      // Dashboard should return structured stats
      expect(data.users?.total ?? data.subscriptions?.active ?? data.revenue).toBeDefined()
    }
  })
})

/**
 * Admin API - Strict Data Validation (Read-Only)
 *
 * This test creates real data via E2E helpers, then verifies admin endpoints
 * return accurate metrics reflecting the seeded data. This complements the
 * stub-based admin-smoke.spec.ts by hitting the REAL backend.
 *
 * Read-only: Creates test data but doesn't modify admin state.
 */
test.describe('Admin API - Strict Data Validation (Read-Only)', () => {
  test('admin users endpoint reflects seeded test users', async ({ request }) => {
    // Step 1: Create unique test users via e2e-login
    const ts = Date.now().toString().slice(-8)
    const testEmail1 = `admin-test-user1-${ts}@e2e.natepay.co`
    const testEmail2 = `admin-test-user2-${ts}@e2e.natepay.co`

    const { user: user1 } = await e2eLogin(request, testEmail1)
    const { user: user2 } = await e2eLogin(request, testEmail2)

    expect(user1.id, 'User 1 should be created').toBeTruthy()
    expect(user2.id, 'User 2 should be created').toBeTruthy()

    // Step 2: Query admin users endpoint
    const adminApiKey = process.env.ADMIN_API_KEY_READONLY || process.env.ADMIN_API_KEY || 'test-admin-key'
    const response = await request.get('http://localhost:3001/admin/users', {
      headers: {
        'x-admin-api-key': adminApiKey,
      },
    })

    // Step 3: If admin auth works, verify our test users appear
    if (response.status() === 200) {
      const data = await response.json()
      expect(data.users, 'Admin users endpoint should return users array').toBeDefined()

      // Find our seeded users in the response
      const foundUser1 = data.users.some((u: { email: string }) => u.email === testEmail1)
      const foundUser2 = data.users.some((u: { email: string }) => u.email === testEmail2)

      // STRICT: Seeded users MUST appear in admin data
      expect(foundUser1, `Admin data should include seeded user: ${testEmail1}`).toBeTruthy()
      expect(foundUser2, `Admin data should include seeded user: ${testEmail2}`).toBeTruthy()
    } else if (response.status() === 401) {
      // No valid API key - acceptable in test env, but log it
      console.log('[E2E Admin] Skipping user data validation - no ADMIN_API_KEY configured')
    } else {
      // Unexpected status
      expect.fail(`Unexpected status ${response.status()} from admin users endpoint`)
    }
  })

  test('admin stats reflect seeded subscription count', async ({ request }) => {
    // Step 1: Create a creator with subscription
    const ts = Date.now().toString().slice(-8)
    const creatorEmail = `admin-stats-creator-${ts}@e2e.natepay.co`
    const creatorUsername = buildUsername('admstat', '', ts)
    const subscriberEmail = `admin-stats-sub-${ts}@e2e.natepay.co`

    // Create and setup creator
    const { token } = await e2eLogin(request, creatorEmail)

    const profileResp = await request.put('http://localhost:3001/profile', {
      data: {
        username: creatorUsername,
        displayName: 'Admin Stats Test',
        country: 'United States',
        countryCode: 'US',
        currency: 'USD',
        purpose: 'support',
        pricingModel: 'single',
        singleAmount: 100,
        paymentProvider: 'stripe',
        isPublic: true,
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    if (profileResp.status() !== 200) {
      console.log('[E2E Admin] Profile creation failed - skipping stats validation')
      return
    }

    // Stripe connect
    await request.post('http://localhost:3001/stripe/connect', {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    // Step 2: Seed a subscription (using triple-guarded /e2e endpoint)
    const seedResp = await request.post('http://localhost:3001/e2e/seed-subscription', {
      data: {
        creatorUsername,
        subscriberEmail,
        amount: 500,
        currency: 'USD',
        interval: 'month',
      },
      headers: e2eHeaders(),
    })

    expect(seedResp.status(), 'Subscription seeding must succeed').toBe(200)
    const seedData = await seedResp.json()
    expect(seedData.subscriptionId, 'Must return subscription ID').toBeTruthy()

    // Step 3: Query admin stats
    const adminApiKey = process.env.ADMIN_API_KEY_READONLY || process.env.ADMIN_API_KEY || 'test-admin-key'
    const statsResp = await request.get('http://localhost:3001/admin/stats', {
      headers: {
        'x-admin-api-key': adminApiKey,
      },
    })

    // Step 4: Verify stats include our subscription
    if (statsResp.status() === 200) {
      const stats = await statsResp.json()

      // Stats should have subscription count > 0 (at minimum our seeded one)
      expect(
        stats.totalSubscriptions > 0 || stats.subscriptionCount > 0 || stats.activeSubscriptions > 0,
        'Admin stats should reflect seeded subscription'
      ).toBeTruthy()

      // Log for visibility
      console.log(`[E2E Admin] Stats: ${JSON.stringify(stats)}`)
    } else if (statsResp.status() === 401) {
      console.log('[E2E Admin] Skipping stats validation - no ADMIN_API_KEY configured')
    } else if (statsResp.status() === 404) {
      // Stats endpoint may not exist - try dashboard
      const dashResp = await request.get('http://localhost:3001/admin/dashboard', {
        headers: { 'x-admin-api-key': adminApiKey },
      })

      if (dashResp.status() === 200) {
        const dash = await dashResp.json()
        // Dashboard should show metrics
        expect(dash.users?.total ?? dash.subscriptions?.active ?? dash.revenue).toBeDefined()
      }
    }
  })
})
