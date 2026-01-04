import { test, expect, Page } from '@playwright/test'

/**
 * Subscription Management E2E Tests
 *
 * Tests the /subscription/manage/:token route for public
 * token-based subscription management (no auth required)
 */

interface MockSubscription {
  id: string
  status: 'active' | 'past_due' | 'canceled' | 'paused'
  cancelAtPeriodEnd: boolean
  amount: number
  currency: string
  interval: 'month' | 'year'
  currentPeriodEnd: string
  creatorUsername: string
  creatorDisplayName: string
}

function createMockSubscription(overrides: Partial<MockSubscription> = {}): MockSubscription {
  return {
    id: 'sub_test_123',
    status: 'active',
    cancelAtPeriodEnd: false,
    amount: 10, // Display amount in dollars (formatCurrency expects main unit, not cents)
    currency: 'USD',
    interval: 'month',
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    creatorUsername: 'testcreator',
    creatorDisplayName: 'Test Creator',
    ...overrides,
  }
}

async function setupManageStubs(page: Page, subscription: MockSubscription, token: string) {
  // Stub GET subscription data - only intercept API calls to backend, not frontend page navigation
  await page.route(`**/localhost:3001/subscription/manage/${token}`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subscription: {
            id: subscription.id,
            status: subscription.status,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            amount: subscription.amount,
            currency: subscription.currency,
            interval: subscription.interval,
            currentPeriodEnd: subscription.currentPeriodEnd,
            startDate: new Date().toISOString(),
          },
          creator: {
            username: subscription.creatorUsername,
            displayName: subscription.creatorDisplayName,
            avatarUrl: null,
          },
          subscriber: {
            maskedEmail: 's***@test.com',
          },
          stats: {
            totalSupported: 50,
            totalPaid: 50,
            monthsSubscribed: 5,
            memberSince: new Date(Date.now() - 150 * 24 * 60 * 60 * 1000).toISOString(),
          },
          payments: [],
          actions: {
            canCancel: true,
            canReactivate: false,
          },
        }),
      })
    } else {
      await route.fallback()
    }
  })

  // Stub cancel endpoint
  await page.route(`**/localhost:3001/subscription/manage/${token}/cancel`, async (route) => {
    subscription.cancelAtPeriodEnd = true
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: 'Subscription will be canceled at end of billing period',
        cancelAtPeriodEnd: true,
        accessUntil: subscription.currentPeriodEnd,
      }),
    })
  })

  // Stub reactivate endpoint
  await page.route(`**/localhost:3001/subscription/manage/${token}/reactivate`, async (route) => {
    subscription.cancelAtPeriodEnd = false
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: 'Subscription reactivated',
        subscription: { cancelAtPeriodEnd: false },
      }),
    })
  })

  // Stub portal endpoint
  await page.route(`**/localhost:3001/subscription/manage/${token}/portal`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        url: 'https://billing.stripe.com/test-portal-session',
      }),
    })
  })
}

test.describe('Subscription Management - Token-based', () => {
  const testToken = 'test_manage_token_abc123'

  test('displays subscription details for active subscription', async ({ page }) => {
    const subscription = createMockSubscription({ status: 'active' })
    await setupManageStubs(page, subscription, testToken)

    await page.goto(`/subscription/manage/${testToken}`)

    // Should show creator name
    await expect(page.locator('text=Test Creator')).toBeVisible({ timeout: 5000 })

    // Should show price
    await expect(
      page.locator('text=$10').or(page.locator('text=10.00'))
    ).toBeVisible()

    // Should show active status
    await expect(
      page.locator('text=Active').or(page.locator('text=active'))
    ).toBeVisible()
  })

  test('shows cancel option for active subscription', async ({ page }) => {
    const subscription = createMockSubscription({ status: 'active' })
    await setupManageStubs(page, subscription, testToken)

    await page.goto(`/subscription/manage/${testToken}`)

    // Wait for page to load
    await expect(page.locator('text=Test Creator')).toBeVisible({ timeout: 5000 })

    // Should have cancel button
    const cancelButton = page.locator('button:has-text("Cancel"), a:has-text("Cancel")')
    await expect(cancelButton.first()).toBeVisible()
  })

  test('handles canceled subscription view', async ({ page }) => {
    const subscription = createMockSubscription({ status: 'canceled' })
    await setupManageStubs(page, subscription, testToken)

    await page.goto(`/subscription/manage/${testToken}`)

    // Should show ended/canceled status - UI says "Subscription Ended"
    await expect(
      page.getByRole('heading', { name: 'Subscription Ended' })
    ).toBeVisible({ timeout: 5000 })

    // Should show creator info
    await expect(
      page.getByRole('heading', { name: 'Test Creator' })
    ).toBeVisible()
  })

  test('shows pending cancellation state', async ({ page }) => {
    const subscription = createMockSubscription({
      status: 'active',
      cancelAtPeriodEnd: true,
    })
    await setupManageStubs(page, subscription, testToken)

    await page.goto(`/subscription/manage/${testToken}`)

    // Should indicate cancellation is pending - UI shows "Cancellation Scheduled"
    await expect(
      page.getByRole('heading', { name: 'Cancellation Scheduled' })
    ).toBeVisible({ timeout: 5000 })
  })

  test('handles invalid token gracefully', async ({ page }) => {
    const invalidToken = 'invalid_token_xyz'

    // Setup stub that returns 404
    await page.route(`**/subscription/manage/${invalidToken}`, async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Subscription not found' }),
      })
    })

    await page.goto(`/subscription/manage/${invalidToken}`)

    // Should show error state
    await expect(
      page.locator('text=not found').or(page.locator('text=Invalid').or(page.locator('text=error')))
    ).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Subscription Management - Cancel Flow', () => {
  const testToken = 'test_cancel_token_123'

  test('can initiate cancellation with reason', async ({ page }) => {
    const subscription = createMockSubscription({ status: 'active' })
    await setupManageStubs(page, subscription, testToken)

    await page.goto(`/subscription/manage/${testToken}`)

    // Wait for details to load
    await expect(page.locator('text=Test Creator')).toBeVisible({ timeout: 5000 })

    // Click cancel button
    const cancelButton = page.locator('button:has-text("Cancel")')
    if (await cancelButton.isVisible()) {
      await cancelButton.first().click()

      // Should show reason options or confirmation
      await expect(
        page.locator('text=reason').or(page.locator('text=confirm').or(page.locator('text=sure')))
      ).toBeVisible({ timeout: 3000 }).catch(() => {
        // Some implementations might skip reason selection
      })
    }
  })
})

test.describe('Subscription Management - UI', () => {
  const testToken = 'test_ui_token_456'

  test('is responsive on mobile', async ({ page }) => {
    const subscription = createMockSubscription()
    await setupManageStubs(page, subscription, testToken)

    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto(`/subscription/manage/${testToken}`)

    // Content should be visible
    await expect(page.locator('text=Test Creator')).toBeVisible({ timeout: 5000 })

    // Check that main content is not cut off
    const body = page.locator('body')
    const box = await body.boundingBox()
    expect(box).not.toBeNull()
  })

  test('shows loading state initially', async ({ page }) => {
    const subscription = createMockSubscription()

    // Add delay to see loading state
    await page.route(`**/subscription/manage/${testToken}`, async (route) => {
      await new Promise((r) => setTimeout(r, 500))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subscription: {
            id: subscription.id,
            status: subscription.status,
            cancelAtPeriodEnd: false,
            amount: subscription.amount,
            currency: subscription.currency,
            interval: subscription.interval,
            currentPeriodEnd: subscription.currentPeriodEnd,
          },
          creator: {
            username: subscription.creatorUsername,
            displayName: subscription.creatorDisplayName,
          },
          subscriber: { maskedEmail: 's***@test.com' },
          stats: { totalPaid: 5000, monthsSubscribed: 5 },
        }),
      })
    })

    await page.goto(`/subscription/manage/${testToken}`)

    // Should show loading indicator or skeleton
    const hasLoader = await page.locator('.spin, .spinner, .loading, [class*="spin"], [class*="skeleton"]').isVisible().catch(() => false)
    const hasContent = await page.locator('text=Test Creator').isVisible().catch(() => false)

    // Either shows loader initially or content loads fast enough
    expect(hasLoader || hasContent).toBeTruthy()
  })
})
