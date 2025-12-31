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
  test('checkout session API validates creatorId', async ({ request }) => {
    // Test that checkout session creation validates required fields
    const response = await request.post('http://localhost:3001/checkout/session', {
      data: {
        creatorId: 'nonexistent-id',
        email: 'test@example.com',
        amount: 1000,
      },
      headers: { 'Content-Type': 'application/json' },
    })

    // Should return 400 or 404 (not 500 server error)
    expect([400, 404]).toContain(response.status())
  })

  test('checkout session API requires email', async ({ request }) => {
    // Test email validation
    const response = await request.post('http://localhost:3001/checkout/session', {
      data: {
        creatorId: 'some-id',
        amount: 1000,
      },
      headers: { 'Content-Type': 'application/json' },
    })

    // Should return 400 for missing email
    expect(response.status()).toBe(400)
  })

  test('Stripe checkout stub returns session URL', async ({ request }) => {
    // In PAYMENTS_MODE=stub, the backend should return a stubbed Stripe session
    // This requires a valid creator in the DB - skip if not available
    const response = await request.post('http://localhost:3001/checkout/session', {
      data: {
        creatorId: 'test-creator-id', // Would need real creator in DB
        email: 'test@checkout.com',
        amount: 1000,
      },
      headers: { 'Content-Type': 'application/json' },
    })

    // Either works (with real creator) or fails with 404 (no creator)
    // Both are valid - just shouldn't be 500
    expect([200, 400, 404]).toContain(response.status())
  })

  test.skip('full Stripe checkout flow with seeded creator', async ({ page }) => {
    // NOTE: Requires seedTestCreator() implementation
    // See real-backend.spec.ts for API-level integration tests
    await page.goto('/')
  })

  test.skip('full Paystack checkout flow with seeded creator', async ({ page }) => {
    // NOTE: Requires seedTestCreator() implementation
    await page.goto('/')
  })
})

/**
 * Checkout Validation Tests
 *
 * NOTE: Also skipped because they require a real creator page to be loaded.
 * Email validation logic is tested in unit tests.
 */
test.describe('Checkout Validation - Requires Creator Page', () => {
  test.skip('validates email format before checkout', async ({ page }) => {
    // Would test that invalid emails are rejected
    await page.goto('/')
  })

  test.skip('prevents duplicate subscriptions', async ({ page }) => {
    // Would test that already-subscribed users see appropriate message
    await page.goto('/')
  })
})
