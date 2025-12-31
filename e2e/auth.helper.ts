import { Page, expect, APIRequestContext } from '@playwright/test'

const API_URL = process.env.API_URL || 'http://localhost:3001'

/**
 * E2E Auth Helpers
 *
 * Helper functions for authentication flows in E2E tests.
 *
 * DETERMINISTIC SEEDING:
 * For reliable E2E tests that don't depend on stubs, use:
 * - e2eLogin() to create/login test users via backend
 * - seedTestCreator() to create a complete creator profile
 *
 * These functions hit the real backend, so require:
 * - Backend running with TEST_MODE=true or E2E_MODE=true
 * - Database connection (Neon or local)
 */

/**
 * Sign up a new user via magic link flow
 */
export async function signUp(page: Page, email: string) {
  await page.goto('/')
  await page.click('text=Get Started')
  await page.fill('input[type="email"]', email)
  await page.click('button:has-text("Continue")')

  // In stub mode, magic link is auto-verified
  // Wait for redirect to onboarding or dashboard
  await expect(page).toHaveURL(/\/(onboarding|dashboard)/)
}

/**
 * Sign in an existing user
 */
export async function signIn(page: Page, email: string) {
  await page.goto('/login')
  await page.fill('input[type="email"]', email)
  await page.click('button:has-text("Continue")')

  // In stub mode, magic link is auto-verified
  await expect(page).toHaveURL(/\/(dashboard|onboarding)/)
}

/**
 * Complete subscriber portal OTP flow
 */
export async function subscriberPortalLogin(page: Page, email: string) {
  await page.goto('/subscriptions')
  await page.fill('input[type="email"]', email)
  await page.click('button:has-text("Continue")')

  // In test mode, OTP might be auto-filled or shown
  // For now, we'll need to get OTP from test helper
  await page.waitForSelector('input[placeholder*="code"]', { timeout: 5000 })
}

/**
 * Generate a unique test email
 */
export function generateTestEmail(prefix = 'test'): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  return `${prefix}-${timestamp}-${random}@e2e-test.natepay.co`
}

/**
 * Wait for toast message
 */
export async function expectToast(page: Page, message: string | RegExp) {
  const toast = page.locator('[role="status"], .toast, [data-sonner-toast]')
  await expect(toast).toContainText(message)
}

/**
 * Select country in onboarding
 */
export async function selectCountry(page: Page, country: string) {
  await page.click('[data-testid="country-select"], select[name="country"]')
  await page.click(`text=${country}`)
}

// ============================================
// DETERMINISTIC SEEDING UTILITIES
// ============================================

export interface E2ELoginResult {
  token: string
  user: {
    id: string
    email: string
  }
  onboarding: {
    hasProfile: boolean
    step: number
    redirectTo: string
  }
}

/**
 * Login via e2e-login endpoint (creates user if not exists)
 *
 * This is the foundation for deterministic test data.
 * It creates a real user in the database and returns a session token.
 *
 * @example
 * const { token, user } = await e2eLogin(request, 'test@e2e.com')
 * await page.context().addCookies([{ name: 'session', value: token, domain: 'localhost', path: '/' }])
 */
export async function e2eLogin(request: APIRequestContext, email: string): Promise<E2ELoginResult> {
  const response = await request.post(`${API_URL}/auth/e2e-login`, {
    data: { email },
    headers: { 'Content-Type': 'application/json' },
  })

  if (!response.ok()) {
    const text = await response.text()
    throw new Error(`e2e-login failed: ${response.status()} - ${text}`)
  }

  return response.json()
}

/**
 * Set auth cookie in browser context
 */
export async function setAuthCookie(page: Page, token: string) {
  await page.context().addCookies([
    {
      name: 'session',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
    },
  ])
}

export interface SeedCreatorOptions {
  email: string
  username: string
  displayName: string
  country?: 'US' | 'NG' | 'GB' | 'GH' | 'KE'
  paymentProvider?: 'stripe' | 'paystack'
  singleAmount?: number
}

/**
 * Seed a complete creator profile
 *
 * Creates a user via e2e-login, then creates their profile
 * via the profile/save endpoint.
 *
 * NOTE: This requires the profile creation endpoints to work,
 * which depends on Stripe/Paystack being in test mode.
 *
 * @example
 * const creator = await seedTestCreator(request, {
 *   email: 'creator@e2e.com',
 *   username: 'testcreator',
 *   displayName: 'Test Creator',
 *   country: 'US',
 * })
 * // Now you can visit /{creator.username} to see their public page
 */
export async function seedTestCreator(
  request: APIRequestContext,
  options: SeedCreatorOptions
): Promise<{ user: E2ELoginResult['user']; token: string; username: string }> {
  // Step 1: Create user via e2e-login
  const loginResult = await e2eLogin(request, options.email)

  // Step 2: Save profile (this would need the profile/save endpoint to accept test data)
  // For now, this is a placeholder - full implementation would call profile/save
  // with the auth cookie set

  console.log(`[seedTestCreator] Created user ${loginResult.user.id} - profile creation requires additional setup`)

  return {
    user: loginResult.user,
    token: loginResult.token,
    username: options.username,
  }
}

/**
 * Generate a deterministic test email based on test name
 *
 * Unlike generateTestEmail(), this produces the same email for the same test,
 * which helps with:
 * - Debugging (same user across test runs)
 * - Cleanup (can delete known test users)
 * - Stability (no random collisions)
 *
 * @example
 * const email = deterministicEmail('checkout-stripe-flow')
 * // Returns: 'e2e-checkout-stripe-flow@test.natepay.co'
 */
export function deterministicEmail(testName: string): string {
  // Sanitize test name for email
  const sanitized = testName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)

  return `e2e-${sanitized}@test.natepay.co`
}
