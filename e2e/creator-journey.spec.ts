import { test, expect } from '@playwright/test'

/**
 * Creator Journey Smoke Tests
 *
 * Basic smoke tests that verify pages load without requiring auth.
 * For full onboarding journey tests with fixtures, see:
 *   - onboarding.spec.ts (US/Stripe, NG/Paystack, Service mode)
 */

test.describe('Creator Journey - Smoke Tests', () => {
  test('landing page loads', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('body')).toBeVisible()

    // Should have some content (not blank)
    const content = await page.content()
    expect(content.length).toBeGreaterThan(100)
  })

  test('onboarding page loads', async ({ page }) => {
    await page.goto('/onboarding')

    // Should show the start step or redirect based on auth
    await expect(page.locator('body')).toBeVisible()

    // Should have NatePay branding or onboarding content
    const hasLogo = await page.locator('img[alt*="Nate"], img[src*="logo"]').isVisible().catch(() => false)
    const hasContent = await page.locator('.onboarding, [class*="onboarding"]').isVisible().catch(() => false)

    expect(hasLogo || hasContent).toBeTruthy()
  })

  test('login page accessible', async ({ page }) => {
    await page.goto('/login')

    // Should show login form or redirect to onboarding
    await expect(page.locator('body')).toBeVisible()
  })
})
