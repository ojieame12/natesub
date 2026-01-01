import { test, expect } from '@playwright/test'
import { createTestUser, setupOnboardingStubs, setAuthToken } from './fixtures'

/**
 * Onboarding E2E Tests
 *
 * Tests validate UI rendering and client-side logic with route stubs.
 * For full backend integration, see real-backend.spec.ts
 */

test.describe('Creator Onboarding (Stubbed)', () => {
  test('identity step renders and accepts input (US/Stripe)', async ({ page }) => {
    const user = createTestUser({
      country: 'US',
      paymentProvider: 'stripe',
      hasProfile: false,
    })

    await setupOnboardingStubs(page, user)
    await page.goto('/onboarding')
    await setAuthToken(page, user.token)

    // Navigate to identity step
    await page.goto('/onboarding?step=identity')
    await page.waitForLoadState('networkidle')

    // Identity step should render
    const firstNameInput = page.getByTestId('identity-first-name')
    await expect(firstNameInput).toBeVisible({ timeout: 5000 })

    // Fill form
    await firstNameInput.fill('John')
    await page.getByTestId('identity-last-name').fill('Creator')

    // Country selector should work
    await page.getByTestId('country-selector').click()
    await page.getByTestId('country-option-us').click()

    // Continue button should be enabled
    const continueBtn = page.getByTestId('identity-continue-btn')
    await expect(continueBtn).toBeEnabled()
  })

  test('identity step renders for Nigerian user (NG/Paystack)', async ({ page }) => {
    const user = createTestUser({
      country: 'NG',
      paymentProvider: 'paystack',
      hasProfile: false,
      paystackSubaccountCode: 'ACCT_test_ng',
    })

    await setupOnboardingStubs(page, user)
    await page.goto('/onboarding')
    await setAuthToken(page, user.token)

    // Navigate to identity step
    await page.goto('/onboarding?step=identity')
    await page.waitForLoadState('networkidle')

    // Identity step should render - increased timeout for CI
    const firstNameInput = page.getByTestId('identity-first-name')
    await expect(firstNameInput).toBeVisible({ timeout: 10000 })

    // Fill form
    await firstNameInput.fill('Adebayo')
    await page.getByTestId('identity-last-name').fill('Creator')

    // Select Nigeria - wait for selector to be visible first
    const countrySelector = page.getByTestId('country-selector')
    await expect(countrySelector).toBeVisible({ timeout: 5000 })
    await countrySelector.click()
    await page.getByTestId('country-option-ng').click()

    // Continue button should be enabled
    await expect(page.getByTestId('identity-continue-btn')).toBeEnabled()
  })

  test('username step validates availability', async ({ page }) => {
    const user = createTestUser({ country: 'US', hasProfile: false })
    await setupOnboardingStubs(page, user)
    await page.goto('/onboarding')
    await setAuthToken(page, user.token)

    // Jump to username step
    await page.goto('/onboarding?step=username')
    await page.waitForLoadState('networkidle')

    const usernameInput = page.getByTestId('username-input')
    await expect(usernameInput).toBeVisible({ timeout: 5000 })

    // Fill username
    await usernameInput.fill(user.username || 'testuser')

    // Wait for availability check (stub returns available: true)
    await expect(page.getByTestId('username-available')).toBeVisible({ timeout: 5000 })

    // Continue button should be enabled
    await expect(page.getByTestId('username-continue-btn')).toBeEnabled()
  })
})

/**
 * Service Mode Journey
 *
 * Tests the service/retainer onboarding path with AI generation
 */
test.describe('Service Mode Onboarding (Stubbed)', () => {
  test('purpose step shows service option', async ({ page }) => {
    const user = createTestUser({
      country: 'US',
      paymentProvider: 'stripe',
      hasProfile: false,
    })

    await setupOnboardingStubs(page, user)
    await page.goto('/onboarding')
    await setAuthToken(page, user.token)

    // Go to purpose step
    await page.goto('/onboarding?step=purpose')
    await page.waitForLoadState('networkidle')

    // Purpose list should render with both options
    const purposeList = page.getByTestId('purpose-list')
    await expect(purposeList).toBeVisible({ timeout: 5000 })

    // Service option should be clickable
    const serviceOption = page.getByTestId('purpose-service')
    await expect(serviceOption).toBeVisible()
  })
})
