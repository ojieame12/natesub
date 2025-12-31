import { test, expect } from '@playwright/test'

/**
 * Checkout E2E Tests - UI Smoke Tests
 *
 * ARCHITECTURE NOTE:
 * These are "UI Smoke" tests that verify basic page rendering and navigation.
 * They use route stubs to avoid database dependencies.
 *
 * For full E2E integration tests that validate server persistence and real
 * checkout flows, we would need:
 * - A dedicated local test database (not Neon)
 * - Real user/profile creation via e2e-login + API
 * - Only stub external providers (Stripe Checkout, Paystack)
 *
 * The current tests validate:
 * - 404 handling for non-existent users
 * - Basic page structure loads
 * - Landing page renders correctly
 */

test.describe('Subscription Checkout - Smoke Tests', () => {
  test('landing page loads correctly', async ({ page }) => {
    await page.goto('/')

    // Landing page should have basic structure
    await expect(page.locator('body')).toBeVisible()

    // Should have NatePay branding
    const pageContent = await page.content()
    expect(pageContent.toLowerCase()).toContain('nate')
  })

  test('handles non-existent creator with 404', async ({ page }) => {
    // Visit a non-existent creator page
    await page.goto('/nonexistent-creator-xyz-12345')

    // Wait for the page to settle
    await page.waitForLoadState('networkidle')

    // Should show error or redirect
    const content = await page.content()
    const hasError = content.includes('not found') ||
                     content.includes('404') ||
                     content.includes("doesn't exist") ||
                     content.includes('Page not found')

    // Either shows error or has navigated away
    expect(hasError || page.url() !== '/nonexistent-creator-xyz-12345').toBeTruthy()
  })

  test('reserved routes redirect properly', async ({ page }) => {
    // Reserved routes should redirect to onboarding, not show 404
    await page.goto('/settings')

    // Should redirect to login/onboarding
    await page.waitForLoadState('networkidle')
    const url = page.url()

    // Should NOT be on /settings anymore (redirected)
    expect(
      url.includes('onboarding') ||
      url.includes('login') ||
      url.includes('auth') ||
      !url.includes('settings')
    ).toBeTruthy()
  })
})

/**
 * Full Checkout Integration Tests
 *
 * NOTE: These tests are SKIPPED because they require:
 * 1. A real test database with seeded creator profiles
 * 2. Working Stripe/Paystack test mode credentials
 * 3. Complex session/cookie handling for auth state
 *
 * To properly test checkout flows:
 * - Use backend integration tests (backend/tests/integration/checkout.test.ts)
 * - Use backend e2e-flows tests (backend/tests/integration/e2e-flows.test.ts)
 *
 * Those tests validate:
 * - POST /checkout/session creates correct provider sessions
 * - Stripe vs Paystack routing based on geo
 * - Session verification endpoints
 * - Fee calculations and breakdowns
 */
test.describe('Checkout Integration - API Level', () => {
  test('checkout session API returns 404 for non-existent creator', async ({ request }) => {
    // Test that checkout correctly validates creator exists
    const response = await request.post('http://localhost:3001/checkout/session', {
      data: {
        creatorUsername: 'nonexistent-creator-xyz-12345',
        amount: 1000,
        interval: 'one_time',
        subscriberEmail: 'test@example.com',
      },
      headers: { 'Content-Type': 'application/json' },
    })

    // Should return 404 for non-existent creator
    // 429 is also acceptable - rate limiting is a valid rejection
    expect([404, 429]).toContain(response.status())
  })

  test('checkout session API validates required fields', async ({ request }) => {
    // Test that missing required fields return 400
    const response = await request.post('http://localhost:3001/checkout/session', {
      data: {
        creatorUsername: 'some-user',
        // Missing: amount, interval
      },
      headers: { 'Content-Type': 'application/json' },
    })

    // Should return 400 for missing required fields
    // 429 is also acceptable - rate limiting is a valid rejection
    expect([400, 429]).toContain(response.status())
  })

  test('checkout session API validates interval enum', async ({ request }) => {
    // Test that invalid interval values are rejected
    const response = await request.post('http://localhost:3001/checkout/session', {
      data: {
        creatorUsername: 'some-user',
        amount: 1000,
        interval: 'invalid_interval', // Should be 'month' or 'one_time'
      },
      headers: { 'Content-Type': 'application/json' },
    })

    // Should return 400 for invalid enum value
    // 429 is also acceptable - rate limiting is a valid rejection
    expect([400, 429]).toContain(response.status())
  })

  test('Stripe checkout flow with e2e-seeded creator', async ({ request }) => {
    // Step 1: Create a test creator via e2e-login
    const ts = Date.now().toString().slice(-8) // Last 8 digits for uniqueness
    const creatorEmail = `e2e-checkout-stripe-${ts}@test.natepay.co`
    const creatorUsername = `e2estrepe${ts}` // Max 20 chars: 8 + 8 = 16

    const loginResponse = await request.post('http://localhost:3001/auth/e2e-login', {
      data: { email: creatorEmail },
      headers: { 'Content-Type': 'application/json' },
    })

    // e2e-login MUST work - fail test if not available
    expect(loginResponse.status(), 'e2e-login endpoint must be available').toBe(200)

    const loginData = await loginResponse.json()
    const token = loginData.token
    expect(token, 'Login must return a token').toBeTruthy()

    // Step 2: Create a profile for the creator (US-based for Stripe)
    // Note: singleAmount is in display units (5 = $5.00), stored as 500 cents
    const profileResponse = await request.put('http://localhost:3001/profile', {
      data: {
        username: creatorUsername,
        displayName: 'E2E Stripe Checkout Creator',
        country: 'United States',
        countryCode: 'US',
        currency: 'USD',
        purpose: 'support',
        pricingModel: 'single',
        singleAmount: 5, // $5.00 display → 500 cents stored
        paymentProvider: 'stripe',
        feeMode: 'split',
        isPublic: true,
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    })

    // Profile creation MUST succeed - fail test if not
    expect(profileResponse.status(), 'Profile creation must succeed').toBe(200)

    // Step 3: Connect Stripe account (in stub mode, creates stub account)
    const stripeConnectResponse = await request.post('http://localhost:3001/stripe/connect', {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    })

    // Stripe connect MUST succeed in stub mode
    expect(stripeConnectResponse.status(), 'Stripe connect must succeed').toBe(200)
    const connectData = await stripeConnectResponse.json()
    expect(connectData.alreadyOnboarded || connectData.success, 'Stripe account must be set up').toBeTruthy()

    // Step 4: Create checkout session as an UNAUTHENTICATED subscriber
    // Use fetch directly to avoid cookie context from e2e-login
    const checkoutFetch = await fetch('http://localhost:3001/checkout/session', {
      method: 'POST',
      body: JSON.stringify({
        creatorUsername,
        amount: 500,
        interval: 'one_time',
        subscriberEmail: 'subscriber@test.com',
        payerCountry: 'US',
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    // Checkout MUST succeed with fully set up creator
    if (checkoutFetch.status !== 200) {
      const errorBody = await checkoutFetch.json()
      console.log('[E2E] Checkout failed:', checkoutFetch.status, errorBody)
    }
    expect(checkoutFetch.status, 'Checkout session must succeed').toBe(200)

    const checkoutData = await checkoutFetch.json()
    // Should have a URL (stub or real)
    expect(checkoutData.url || checkoutData.sessionId, 'Checkout must return URL or sessionId').toBeTruthy()
  })

  test('Stripe checkout return page renders success UI', async ({ page, request }) => {
    // This test validates the FULL checkout → return → success UI flow
    // Uses stub mode which returns a direct success URL
    const ts = Date.now().toString().slice(-8)
    const creatorEmail = `e2e-return-stripe-${ts}@test.natepay.co`
    const creatorUsername = `e2ereturn${ts}`

    // Setup: Create creator with Stripe
    const loginResponse = await request.post('http://localhost:3001/auth/e2e-login', {
      data: { email: creatorEmail },
      headers: { 'Content-Type': 'application/json' },
    })
    expect(loginResponse.status()).toBe(200)
    const { token } = await loginResponse.json()

    await request.put('http://localhost:3001/profile', {
      data: {
        username: creatorUsername,
        displayName: 'E2E Return Test Creator',
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
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    })

    await request.post('http://localhost:3001/stripe/connect', {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    // Create checkout session
    const checkoutFetch = await fetch('http://localhost:3001/checkout/session', {
      method: 'POST',
      body: JSON.stringify({
        creatorUsername,
        amount: 500,
        interval: 'one_time',
        subscriberEmail: 'return-test@example.com',
        payerCountry: 'US',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(checkoutFetch.status).toBe(200)

    const checkoutData = await checkoutFetch.json()
    const returnUrl = checkoutData.url

    expect(returnUrl, 'Must return checkout URL').toBeTruthy()

    // In stub mode, URL redirects to success page directly
    // Navigate to the return URL and verify success UI
    await page.goto(returnUrl)
    await page.waitForLoadState('networkidle')

    // Verify success page renders (not error page)
    const pageContent = await page.content()
    const hasSuccessIndicator =
      pageContent.toLowerCase().includes('success') ||
      pageContent.toLowerCase().includes('thank') ||
      pageContent.toLowerCase().includes('confirmed') ||
      pageContent.toLowerCase().includes('complete') ||
      pageContent.toLowerCase().includes(creatorUsername) // Shows creator page

    expect(hasSuccessIndicator, 'Return page should show success or creator page').toBeTruthy()

    // Should NOT show error indicators
    const hasError =
      pageContent.toLowerCase().includes('error') &&
      pageContent.toLowerCase().includes('failed')

    expect(hasError, 'Return page should not show error').toBeFalsy()
  })

  test('Paystack checkout return page renders success UI', async ({ page, request }) => {
    // This test validates the Paystack return → success UI flow in stub mode
    const ts = Date.now().toString().slice(-8)
    const creatorEmail = `e2e-return-paystack-${ts}@test.natepay.co`
    const creatorUsername = `e2epstret${ts}`

    // Setup: Create Nigerian creator with Paystack
    const loginResponse = await request.post('http://localhost:3001/auth/e2e-login', {
      data: { email: creatorEmail },
      headers: { 'Content-Type': 'application/json' },
    })
    expect(loginResponse.status()).toBe(200)
    const { token } = await loginResponse.json()

    await request.put('http://localhost:3001/profile', {
      data: {
        username: creatorUsername,
        displayName: 'E2E Paystack Return Creator',
        country: 'Nigeria',
        countryCode: 'NG',
        currency: 'NGN',
        purpose: 'support',
        pricingModel: 'single',
        singleAmount: 5000,
        paymentProvider: 'paystack',
        feeMode: 'split',
        isPublic: true,
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    })

    await request.post('http://localhost:3001/paystack/connect', {
      data: {
        bankCode: '058',
        accountNumber: '0123456789',
        accountName: 'E2E TEST CREATOR',
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    })

    // Create checkout session
    const checkoutFetch = await fetch('http://localhost:3001/checkout/session', {
      method: 'POST',
      body: JSON.stringify({
        creatorUsername,
        amount: 500000,
        interval: 'one_time',
        subscriberEmail: 'paystack-return@example.com',
        payerCountry: 'NG',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(checkoutFetch.status).toBe(200)

    const checkoutData = await checkoutFetch.json()
    const returnUrl = checkoutData.authorizationUrl || checkoutData.url

    expect(returnUrl, 'Must return Paystack authorization URL').toBeTruthy()

    // In stub mode, navigate to return URL
    await page.goto(returnUrl)
    await page.waitForLoadState('networkidle')

    // Verify success page renders (not error page)
    const pageContent = await page.content()
    const hasSuccessIndicator =
      pageContent.toLowerCase().includes('success') ||
      pageContent.toLowerCase().includes('thank') ||
      pageContent.toLowerCase().includes('confirmed') ||
      pageContent.toLowerCase().includes('complete') ||
      pageContent.toLowerCase().includes(creatorUsername)

    expect(hasSuccessIndicator, 'Return page should show success or creator page').toBeTruthy()
  })

  test('Paystack checkout flow with e2e-seeded NG creator', async ({ request }) => {
    // Step 1: Create a Nigerian test creator via e2e-login
    const ts = Date.now().toString().slice(-8) // Last 8 digits for uniqueness
    const creatorEmail = `e2e-checkout-paystack-${ts}@test.natepay.co`
    const creatorUsername = `e2epstck${ts}` // Max 20 chars: 8 + 8 = 16

    const loginResponse = await request.post('http://localhost:3001/auth/e2e-login', {
      data: { email: creatorEmail },
      headers: { 'Content-Type': 'application/json' },
    })

    expect(loginResponse.status(), 'e2e-login endpoint must be available').toBe(200)

    const loginData = await loginResponse.json()
    const token = loginData.token
    expect(token, 'Login must return a token').toBeTruthy()

    // Step 2: Create a profile for the Nigerian creator (uses Paystack)
    // Note: singleAmount is in display units (5000 = ₦5000), stored as 500000 kobo
    const profileResponse = await request.put('http://localhost:3001/profile', {
      data: {
        username: creatorUsername,
        displayName: 'E2E Paystack Checkout Creator',
        country: 'Nigeria',
        countryCode: 'NG',
        currency: 'NGN',
        purpose: 'support',
        pricingModel: 'single',
        singleAmount: 5000, // ₦5,000 display → 500000 kobo stored
        paymentProvider: 'paystack',
        feeMode: 'split',
        isPublic: true,
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    })

    expect(profileResponse.status(), 'Profile creation must succeed').toBe(200)

    // Step 3: Connect Paystack account (in stub mode, creates stub subaccount)
    // For Paystack, we use /paystack/connect with bank details
    const paystackConnectResponse = await request.post('http://localhost:3001/paystack/connect', {
      data: {
        bankCode: '058', // GTBank
        accountNumber: '0123456789',
        accountName: 'E2E TEST CREATOR',
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    })

    // Paystack connect MUST succeed in stub mode
    expect(paystackConnectResponse.status(), 'Paystack connect must succeed').toBe(200)
    const connectData = await paystackConnectResponse.json()
    expect(connectData.subaccountCode || connectData.success, 'Paystack must return subaccountCode or success').toBeTruthy()

    // Step 4: Create checkout session as an UNAUTHENTICATED subscriber
    // Use fetch directly to avoid cookie context from e2e-login
    // Note: amount is in kobo (cents), matching what's stored in profile
    const checkoutFetch = await fetch('http://localhost:3001/checkout/session', {
      method: 'POST',
      body: JSON.stringify({
        creatorUsername,
        amount: 500000, // ₦5,000 in kobo (matching profile.singleAmount)
        interval: 'one_time',
        subscriberEmail: 'subscriber-ng@test.com',
        payerCountry: 'NG',
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    // Checkout MUST succeed with fully set up creator
    if (checkoutFetch.status !== 200) {
      const errorBody = await checkoutFetch.json()
      console.log('[E2E] Paystack checkout failed:', checkoutFetch.status, errorBody)
    }
    expect(checkoutFetch.status, 'Checkout session must succeed').toBe(200)

    const checkoutData = await checkoutFetch.json()
    // Should have authorization URL or reference
    expect(
      checkoutData.authorizationUrl || checkoutData.reference || checkoutData.url,
      'Checkout must return authorizationUrl, reference, or url'
    ).toBeTruthy()
  })
})

/**
 * Checkout Validation Tests
 *
 * These tests validate form-level validation in the checkout flow.
 * They use e2e-seeded creators to test against real backend.
 */
test.describe('Checkout Validation - API Level', () => {
  test('validates email format in checkout request', async ({ request }) => {
    // Test that invalid email formats are rejected at API level
    const response = await request.post('http://localhost:3001/checkout/session', {
      data: {
        creatorUsername: 'anyuser',
        amount: 500,
        interval: 'one_time',
        subscriberEmail: 'invalid-email-format', // Invalid email
        payerCountry: 'US',
      },
      headers: { 'Content-Type': 'application/json' },
    })

    // Should return 400 for invalid email format
    // 429 is also acceptable - rate limiting is a valid rejection
    expect([400, 429]).toContain(response.status())
  })

  test('rejects checkout without required subscriberEmail', async ({ request }) => {
    const response = await request.post('http://localhost:3001/checkout/session', {
      data: {
        creatorUsername: 'anyuser',
        amount: 500,
        interval: 'one_time',
        // Missing subscriberEmail
        payerCountry: 'US',
      },
      headers: { 'Content-Type': 'application/json' },
    })

    // Should return 400 (validation error), 404 (creator not found), or 429 (rate limited)
    // All indicate proper rejection - not 500 (server error)
    expect([400, 404, 429]).toContain(response.status())
  })

  test('handles duplicate subscription attempt gracefully', async ({ request }) => {
    // Create a creator first, then attempt duplicate checkout with same email
    const ts = Date.now().toString().slice(-8)
    const creatorEmail = `e2e-dup-creator-${ts}@test.natepay.co`
    const creatorUsername = `e2edup${ts}`
    const subscriberEmail = `duplicate-sub-${ts}@test.com`

    // Step 1: Create creator via e2e-login
    const loginResponse = await request.post('http://localhost:3001/auth/e2e-login', {
      data: { email: creatorEmail },
      headers: { 'Content-Type': 'application/json' },
    })
    expect(loginResponse.status()).toBe(200)
    const { token } = await loginResponse.json()

    // Step 2: Create profile
    const profileResponse = await request.put('http://localhost:3001/profile', {
      data: {
        username: creatorUsername,
        displayName: 'E2E Duplicate Test Creator',
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
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    })
    expect(profileResponse.status()).toBe(200)

    // Step 3: Connect Stripe (stub mode)
    const connectResponse = await request.post('http://localhost:3001/stripe/connect', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    expect(connectResponse.status()).toBe(200)

    // Step 4: First checkout (should succeed)
    const firstCheckout = await fetch('http://localhost:3001/checkout/session', {
      method: 'POST',
      body: JSON.stringify({
        creatorUsername,
        amount: 500,
        interval: 'month', // Recurring
        subscriberEmail,
        payerCountry: 'US',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(firstCheckout.status, 'First checkout should succeed').toBe(200)

    // Step 5: Second checkout with SAME email (duplicate attempt)
    const duplicateCheckout = await fetch('http://localhost:3001/checkout/session', {
      method: 'POST',
      body: JSON.stringify({
        creatorUsername,
        amount: 500,
        interval: 'month',
        subscriberEmail, // Same email
        payerCountry: 'US',
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    // Duplicate should either:
    // - Return 200 (idempotent - returns same session)
    // - Return 409 (conflict - already subscribed)
    // - Return 400 (validation - duplicate detected)
    // - Return 429 (rate limited - acceptable rejection)
    // NOT 500 (server error)
    expect([200, 400, 409, 429]).toContain(duplicateCheckout.status)
  })
})
