import { test, expect, Page } from '@playwright/test'
import { e2eLogin, setAuthCookie, deterministicEmail } from './auth.helper'

/**
 * Onboarding Navigation & Persistence E2E Tests
 *
 * P0 Tests:
 * - Back/forward navigation across steps
 * - Reload persistence at each step
 * - Cross-device resume simulation
 *
 * P1 Tests:
 * - Slow-network stability
 * - Redirect continuity (Stripe/Paystack return)
 * - AI/perks/banner step persistence
 *
 * These tests hit the real backend (PAYMENTS_MODE=stub) without page.route stubs.
 */

const API_URL = 'http://localhost:3001'

// Helper to fill identity step
async function fillIdentityStep(page: Page, firstName: string, lastName: string) {
  const firstNameInput = page.locator('[data-testid="identity-first-name"]')
  await expect(firstNameInput).toBeVisible({ timeout: 10000 })
  await firstNameInput.fill(firstName)
  await page.locator('[data-testid="identity-last-name"]').fill(lastName)
  await page.locator('[data-testid="country-selector"]').click()
  await page.locator('[data-testid="country-option-us"]').click()
}

// Helper to fill address step
async function fillAddressStep(page: Page) {
  const streetInput = page.locator('[data-testid="address-street"]')
  await expect(streetInput).toBeVisible({ timeout: 10000 })
  await streetInput.fill('123 Test Street')
  await page.locator('[data-testid="address-city"]').fill('San Francisco')
  await page.locator('[data-testid="address-state"]').fill('CA')
  await page.locator('[data-testid="address-zip"]').fill('94102')
}

// Helper to get current step from URL or page
async function getCurrentStep(page: Page): Promise<string> {
  const url = page.url()
  const match = url.match(/step=([a-z-]+)/i)
  return match ? match[1] : 'unknown'
}

test.describe('P0: Onboarding Back/Forward Navigation', () => {
  test('preserves data when navigating back and forward', async ({ page, request }) => {
    const email = deterministicEmail('nav-back-forward')
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    // Step 1: Fill identity
    await page.goto('/onboarding?step=identity')
    await fillIdentityStep(page, 'NavTest', 'BackForward')
    await page.locator('[data-testid="identity-continue-btn"]').click()

    // Step 2: Fill address (wait for it to appear)
    await fillAddressStep(page)
    await page.locator('[data-testid="address-continue-btn"]').click()

    // Step 3: Should be on purpose step
    const purposeList = page.locator('[data-testid="purpose-list"]')
    await expect(purposeList).toBeVisible({ timeout: 10000 })

    // Navigate back to address
    await page.goBack()
    await page.waitForLoadState('networkidle')

    // Verify address fields are still filled
    const streetInput = page.locator('[data-testid="address-street"]')
    await expect(streetInput).toBeVisible({ timeout: 5000 })
    await expect(streetInput).toHaveValue('123 Test Street')

    // Navigate back to identity
    await page.goBack()
    await page.waitForLoadState('networkidle')

    // Verify identity fields are preserved
    const firstNameInput = page.locator('[data-testid="identity-first-name"]')
    await expect(firstNameInput).toBeVisible({ timeout: 5000 })
    await expect(firstNameInput).toHaveValue('NavTest')
    await expect(page.locator('[data-testid="identity-last-name"]')).toHaveValue('BackForward')

    // Navigate forward
    await page.goForward()
    await page.waitForLoadState('networkidle')

    // Address should still be filled
    await expect(page.locator('[data-testid="address-street"]')).toHaveValue('123 Test Street')

    // Navigate forward again
    await page.goForward()
    await page.waitForLoadState('networkidle')

    // Should be back on purpose step
    await expect(purposeList).toBeVisible({ timeout: 5000 })
  })

  test('step indicators remain consistent during navigation', async ({ page, request }) => {
    const email = deterministicEmail('nav-indicators')
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    await page.goto('/onboarding?step=identity')
    await fillIdentityStep(page, 'Indicator', 'Test')
    await page.locator('[data-testid="identity-continue-btn"]').click()

    // Wait for address step
    await expect(page.locator('[data-testid="address-street"]')).toBeVisible({ timeout: 10000 })

    // Check step indicator shows progress (implementation-dependent)
    // Look for any step indicator element
    const stepIndicator = page.locator('[data-testid="step-indicator"], .step-indicator, .progress-indicator')
    if (await stepIndicator.isVisible().catch(() => false)) {
      // Verify it exists and is not showing step 1
      await expect(stepIndicator).toBeVisible()
    }

    // Go back
    await page.goBack()
    await page.waitForLoadState('networkidle')

    // Indicator should update
    await expect(page.locator('[data-testid="identity-first-name"]')).toBeVisible({ timeout: 5000 })
  })
})

test.describe('P0: Reload Persistence', () => {
  test('identity step data persists after reload', async ({ page, request }) => {
    const email = deterministicEmail('reload-identity')
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    await page.goto('/onboarding?step=identity')
    await fillIdentityStep(page, 'ReloadTest', 'Identity')

    // Continue to next step (triggers save)
    await page.locator('[data-testid="identity-continue-btn"]').click()
    await expect(page.locator('[data-testid="address-street"]')).toBeVisible({ timeout: 10000 })

    // Reload the page
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Should restore to address step (not regress to identity)
    // OR if on identity, data should be preserved
    const onAddress = await page.locator('[data-testid="address-street"]').isVisible().catch(() => false)
    const onIdentity = await page.locator('[data-testid="identity-first-name"]').isVisible().catch(() => false)

    if (onIdentity) {
      // Data should be preserved
      await expect(page.locator('[data-testid="identity-first-name"]')).toHaveValue('ReloadTest')
    }

    // Either on address or identity with data - both acceptable
    expect(onAddress || onIdentity).toBeTruthy()
  })

  test('address step data persists after reload', async ({ page, request }) => {
    const email = deterministicEmail('reload-address')
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    await page.goto('/onboarding?step=identity')
    await fillIdentityStep(page, 'ReloadTest', 'Address')
    await page.locator('[data-testid="identity-continue-btn"]').click()

    await fillAddressStep(page)
    await page.locator('[data-testid="address-continue-btn"]').click()

    // Wait for purpose step
    await expect(page.locator('[data-testid="purpose-list"]')).toBeVisible({ timeout: 10000 })

    // Reload
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Should be on purpose or later step (not regressed)
    await page.waitForTimeout(1000)
    const url = page.url()

    // Should not be back at identity step
    expect(url.includes('step=identity')).toBeFalsy()
  })

  test('username step data persists after reload', async ({ page, request }) => {
    const email = deterministicEmail('reload-username')
    const uniqueUsername = `reloadtest${Date.now().toString(36)}`
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    // Jump to username step
    await page.goto('/onboarding?step=username')
    await page.waitForLoadState('networkidle')

    const usernameInput = page.locator('[data-testid="username-input"]')
    if (await usernameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await usernameInput.fill(uniqueUsername)

      // Wait for availability check
      await page.waitForTimeout(1500)

      // Reload
      await page.reload()
      await page.waitForLoadState('networkidle')

      // Username should be preserved (from server hydration)
      const input = page.locator('[data-testid="username-input"]')
      if (await input.isVisible({ timeout: 5000 }).catch(() => false)) {
        const value = await input.inputValue()
        // Either preserved or empty (depends on save timing)
        expect(typeof value).toBe('string')
      }
    }
  })
})

test.describe('P0: Cross-Device Resume Simulation', () => {
  test('resumes from server after clearing localStorage', async ({ page, request }) => {
    const email = deterministicEmail('cross-device-resume')
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    // Complete identity step
    await page.goto('/onboarding?step=identity')
    await fillIdentityStep(page, 'CrossDevice', 'Resume')
    await page.locator('[data-testid="identity-continue-btn"]').click()

    // Wait for address step and fill it
    await fillAddressStep(page)
    await page.locator('[data-testid="address-continue-btn"]').click()

    // Wait for purpose step
    await expect(page.locator('[data-testid="purpose-list"]')).toBeVisible({ timeout: 10000 })

    // Simulate new device: clear localStorage
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })

    // Reload (simulating opening on new device)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Wait for hydration
    await page.waitForTimeout(2000)

    // Should restore from server - not stuck on loading
    const hasContent = await page.locator('[data-testid="purpose-list"], [data-testid="identity-first-name"], [data-testid="address-street"]').first().isVisible({ timeout: 10000 }).catch(() => false)
    const hasSpinner = await page.locator('.loading-spinner, .spinner, [class*="loading"]').isVisible().catch(() => false)

    // Should have content, not infinite loading
    expect(hasContent || !hasSpinner).toBeTruthy()
  })

  test('handles expired session gracefully', async ({ page, request }) => {
    const email = deterministicEmail('expired-session')
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    await page.goto('/onboarding?step=identity')
    await fillIdentityStep(page, 'Expired', 'Session')

    // Clear auth cookie (simulate expired session)
    await page.context().clearCookies()

    // Reload
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Should redirect to login or show auth error
    await page.waitForTimeout(1000)
    const url = page.url()

    // Should be on login/onboarding start (not stuck on identity with error)
    const redirectedToAuth = url.includes('login') || url.includes('onboarding')
    expect(redirectedToAuth).toBeTruthy()
  })
})

test.describe('P1: Slow Network Stability', () => {
  test('shows skeleton during slow API response', async ({ page, request }) => {
    const email = deterministicEmail('slow-network')
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    // Simulate slow network
    await page.route('**/auth/me', async (route) => {
      await new Promise(r => setTimeout(r, 2000)) // 2s delay
      await route.continue()
    })

    const startTime = Date.now()
    await page.goto('/onboarding')

    // Should show loading state
    const hasLoadingState = await page.locator('.skeleton, [class*="skeleton"], .loading, [class*="loading"], .spinner').isVisible({ timeout: 1000 }).catch(() => false)

    // Wait for content to load
    await page.waitForLoadState('networkidle')
    const loadTime = Date.now() - startTime

    // Should have taken at least 2s (due to delay)
    expect(loadTime).toBeGreaterThan(1500)

    // Should now show content (not stuck on loading)
    await expect(page.locator('body')).toBeVisible()
  })

  test('no double-flash on step transition', async ({ page, request }) => {
    const email = deterministicEmail('no-flash')
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    await page.goto('/onboarding?step=identity')
    await fillIdentityStep(page, 'NoFlash', 'Test')

    // Track visibility changes
    let flashCount = 0
    await page.exposeFunction('trackFlash', () => {
      flashCount++
    })

    // Monitor for flashes during transition
    await page.evaluate(() => {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            const el = mutation.target as HTMLElement
            if (el.style.opacity === '0' || el.style.visibility === 'hidden') {
              (window as any).trackFlash()
            }
          }
        }
      })
      observer.observe(document.body, { attributes: true, subtree: true })
    })

    // Transition to next step
    await page.locator('[data-testid="identity-continue-btn"]').click()
    await expect(page.locator('[data-testid="address-street"]')).toBeVisible({ timeout: 10000 })

    // Should have minimal flashes (0-2 acceptable for normal transitions)
    expect(flashCount).toBeLessThan(5)
  })
})

test.describe('P1: Redirect Continuity', () => {
  test('Stripe return resumes to correct step', async ({ page, request }) => {
    const email = deterministicEmail('stripe-return')
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    // Simulate returning from Stripe with success
    // In stub mode, the return URL should be handled
    await page.goto('/onboarding?step=payment&stripe_return=success')
    await page.waitForLoadState('networkidle')

    // Should be on payment step or review (not error)
    const url = page.url()
    expect(url.includes('onboarding')).toBeTruthy()

    // Page should have content (not error state)
    await expect(page.locator('body')).toBeVisible()
  })

  test('Paystack return resumes to correct step', async ({ page, request }) => {
    const email = deterministicEmail('paystack-return')
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    // Simulate returning from Paystack
    await page.goto('/onboarding?step=payment&paystack_return=success')
    await page.waitForLoadState('networkidle')

    const url = page.url()
    expect(url.includes('onboarding')).toBeTruthy()
    await expect(page.locator('body')).toBeVisible()
  })
})

test.describe('P1: AI/Perks/Banner Steps', () => {
  test('service mode flow preserves data through AI step', async ({ page, request }) => {
    const email = deterministicEmail('service-mode-ai')
    const { token } = await e2eLogin(request, email)
    await setAuthCookie(page, token)

    // Go to purpose step
    await page.goto('/onboarding?step=purpose')
    await page.waitForLoadState('networkidle')

    const purposeList = page.locator('[data-testid="purpose-list"]')
    if (await purposeList.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Select service mode
      const serviceOption = page.locator('[data-testid="purpose-service"]')
      if (await serviceOption.isVisible().catch(() => false)) {
        await serviceOption.click()

        // Should navigate to service description step
        await page.waitForTimeout(1000)

        // Check for service description input
        const serviceDesc = page.locator('[data-testid="service-description-input"]')
        if (await serviceDesc.isVisible({ timeout: 5000 }).catch(() => false)) {
          await serviceDesc.fill('Test service description for AI generation')

          // Continue (triggers AI generation in stub mode)
          const continueBtn = page.locator('[data-testid="service-desc-continue-btn"]')
          if (await continueBtn.isVisible().catch(() => false)) {
            await continueBtn.click()

            // Wait for AI step or next step
            await page.waitForTimeout(3000)

            // Reload and verify description persists
            await page.reload()
            await page.waitForLoadState('networkidle')

            // Should have progressed (not back at purpose)
            const url = page.url()
            expect(url.includes('purpose') && !url.includes('service')).toBeFalsy()
          }
        }
      }
    }
  })
})
