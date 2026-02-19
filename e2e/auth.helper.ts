import { Page, expect, APIRequestContext } from '@playwright/test'

// E2E tests always run against local backend - hardcode to avoid CI env var conflicts
// (CI may have API_URL set to production, but E2E tests need the local stub server)
const API_URL = 'http://localhost:3001'

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
  const normalized = country.trim().toLowerCase()
  const codeMap: Record<string, string> = {
    us: 'us',
    usa: 'us',
    'united states': 'us',
    ng: 'ng',
    nigeria: 'ng',
    gh: 'gh',
    ghana: 'gh',
    ke: 'ke',
    kenya: 'ke',
    za: 'za',
    'south africa': 'za',
    gb: 'gb',
    uk: 'gb',
    'united kingdom': 'gb',
  }

  const code = codeMap[normalized] || (normalized.length === 2 ? normalized : '')

  // Wait for animations/loading
  await page.waitForTimeout(1000)

  const selector = page.getByTestId('country-selector')
  const selectorVisible = await selector.isVisible({ timeout: 10000 }).catch(() => false)

  // Fallback: native select (if the UI changes or test IDs are stripped)
  if (!selectorVisible) {
    const nativeSelect = page.locator('select[name="country"], select[data-testid="country-select"]')
    if (await nativeSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nativeSelect.selectOption({ label: country }).catch(async () => {
        if (code) {
          await nativeSelect.selectOption(code)
        }
      })
      return
    }

    // If country is already set and continue is enabled, skip selection
    const continueBtn = page.getByTestId('identity-continue-btn')
    if (await continueBtn.isEnabled().catch(() => false)) {
      return
    }

    // Last-resort: wait longer for selector to appear
    await page.waitForSelector('[data-testid="country-selector"]', { state: 'visible', timeout: 30000 })
  }

  await expect(selector).toBeVisible({ timeout: 30000 })
  await selector.click()

  const list = page.getByTestId('country-list')
  await expect(list).toBeVisible({ timeout: 30000 })

  if (code) {
    const option = page.getByTestId(`country-option-${code}`)
    await expect(option).toBeVisible({ timeout: 30000 })
    await option.click()
    await expect(selector).toContainText(country, { timeout: 10000 })
    return
  }

  // Fallback: click by visible text
  await page.getByText(country, { exact: false }).first().click()
  await expect(selector).toContainText(country, { timeout: 10000 })
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

  const setStorageScript = (sessionToken: string) => {
    localStorage.setItem('nate_auth_token', sessionToken)
    localStorage.setItem('nate_has_session', 'true')
    sessionStorage.setItem('nate_has_session', 'true')
  }

  // Ensure storage is set before any app scripts run
  await page.addInitScript(setStorageScript, token)

  // Also set immediately if page is already loaded
  try {
    await page.evaluate(setStorageScript, token)
  } catch {
    // Ignore if page not ready; init script covers next navigation
  }
}

/**
 * Wait for auth state to be ready before interacting with protected pages
 */
export async function waitForAuthReady(page: Page) {
  await page.waitForSelector('.onboarding-resuming', {
    state: 'hidden',
    timeout: 3000
  }).catch(() => {})

  await page.waitForTimeout(300)
}

export interface SeedCreatorOptions {
  email: string
  username: string
  displayName: string
  country?: 'US' | 'NG' | 'GB' | 'GH' | 'KE'
  paymentProvider?: 'stripe' | 'paystack'
  singleAmount?: number
  purpose?: 'support' | 'service'
  isPublic?: boolean
}

// Country code to full name mapping
const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States',
  NG: 'Nigeria',
  GB: 'United Kingdom',
  GH: 'Ghana',
  KE: 'Kenya',
}

// Country code to currency mapping
const COUNTRY_CURRENCIES: Record<string, string> = {
  US: 'USD',
  NG: 'NGN',
  GB: 'GBP',
  GH: 'GHS',
  KE: 'KES',
}

// E2E tests run in stub mode which skips minimum validation
// Using reasonable test amounts (domestic math works at $50)
// Cross-border countries (NG, GH, KE, ZA) have $45 USD minimum
const MIN_SAFE_SINGLE_AMOUNT: Record<string, number> = {
  USD: 50,
  GBP: 40,
  EUR: 50,
  NGN: 76000,   // $45 * 1600 = 72,000 + buffer
  KES: 6200,    // $45 * 130 = 5,850 + buffer
  GHS: 750,     // $45 * 16.1 = 725 + buffer
  ZAR: 850,     // $45 * 18.2 = 819 + buffer
}

function getSafeSingleAmount(currency: string, fallback: number): number {
  return MIN_SAFE_SINGLE_AMOUNT[currency] ?? fallback
}

/**
 * Seed a complete creator profile
 *
 * Creates a user via e2e-login, then creates their profile
 * via the PUT /profile endpoint.
 *
 * NOTE: In PAYMENTS_MODE=stub, Stripe/Paystack account creation is stubbed.
 * The profile will be created but may not have payment capabilities
 * until the payment provider flow is completed.
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
): Promise<{ user: E2ELoginResult['user']; token: string; username: string; profileCreated: boolean }> {
  const countryCode = options.country || 'US'
  const country = COUNTRY_NAMES[countryCode] || 'United States'
  const currency = COUNTRY_CURRENCIES[countryCode] || 'USD'
  const paymentProvider = options.paymentProvider || (countryCode === 'NG' ? 'paystack' : 'stripe')
  const singleAmount = options.singleAmount ?? getSafeSingleAmount(currency, 100)
  const purpose = options.purpose || 'support'
  const isPublic = options.isPublic ?? false

  // Step 1: Create user via e2e-login
  const loginResult = await e2eLogin(request, options.email)

  // Step 2: Create profile via PUT /profile
  const profileResponse = await request.put(`${API_URL}/profile`, {
    data: {
      username: options.username.toLowerCase(),
      displayName: options.displayName,
      country,
      countryCode,
      currency,
      purpose,
      pricingModel: 'single',
      singleAmount,
      paymentProvider,
      isPublic, // Start as private, can be made public later
    },
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${loginResult.token}`,
    },
  })

  const profileCreated = profileResponse.ok()

  if (!profileCreated) {
    const errorText = await profileResponse.text()
    console.warn(`[seedTestCreator] Profile creation failed: ${profileResponse.status()} - ${errorText}`)
  }

  return {
    user: loginResult.user,
    token: loginResult.token,
    username: options.username.toLowerCase(),
    profileCreated,
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

/**
 * Build a safe username (<=20 chars, lowercase, [a-z0-9_])
 * Adds a short random suffix to prevent shard collisions.
 */
export function buildUsername(prefix: string, suffix: string, ts: string): string {
  const base = `${prefix}${suffix}`.toLowerCase().replace(/[^a-z0-9_]/g, '')
  const safePrefix = base.slice(0, 10) // leave room for 6-char ts + 4-char rand
  const tsSuffix = ts.slice(-6)
  const rand = Math.random().toString(36).slice(2, 6)
  return `${safePrefix}${tsSuffix}${rand}`
}
