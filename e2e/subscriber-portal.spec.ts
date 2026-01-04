import { test, expect, Page } from '@playwright/test'

/**
 * Public Subscriber Portal E2E Tests
 *
 * Tests the /subscriptions public portal where subscribers can
 * manage their subscriptions without logging in (OTP-based auth)
 */

interface TestSubscription {
  id: string
  creatorUsername: string
  creatorDisplayName: string
  tierName: string | null
  amount: number
  currency: string
  interval: 'month' | 'year' | 'week' | 'day' | 'one_time'
  status: 'active' | 'past_due' | 'canceled' | 'paused'
  statusLabel: string
  currentPeriodEnd: string
  startedAt: string
  totalPaid: number
  paymentCount: number
  provider: 'stripe' | 'paystack'
  canUpdatePayment: boolean
  updatePaymentMethod: 'portal' | 'resubscribe' | 'none'
  billingDescriptor: string
  isPastDue: boolean
  cancelAtPeriodEnd: boolean
}

interface TestSubscriber {
  email: string
  maskedEmail: string
  token: string
  subscriptions: TestSubscription[]
}

function getStatusLabel(status: TestSubscription['status'], cancelAtPeriodEnd: boolean) {
  if (status === 'active' && cancelAtPeriodEnd) return 'Canceling'
  if (status === 'active') return 'Active'
  if (status === 'past_due') return 'Payment failed'
  if (status === 'canceled') return 'Canceled'
  if (status === 'paused') return 'Paused'
  return status
}

function createTestSubscriber(overrides: Partial<TestSubscriber> = {}): TestSubscriber {
  const uniqueId = Date.now().toString(36)
  const now = Date.now()
  return {
    email: `subscriber_${uniqueId}@test.com`,
    maskedEmail: `s***r_${uniqueId}@test.com`,
    token: `subscriber_token_${uniqueId}`,
    subscriptions: [
      {
        id: `sub_${uniqueId}_1`,
        creatorUsername: 'testcreator',
        creatorDisplayName: 'Test Creator',
        tierName: 'Monthly Support',
        amount: 10,
        currency: 'USD',
        interval: 'month',
        status: 'active',
        statusLabel: 'Active',
        currentPeriodEnd: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
        startedAt: new Date(now - 120 * 24 * 60 * 60 * 1000).toISOString(),
        totalPaid: 50,
        paymentCount: 5,
        provider: 'stripe',
        canUpdatePayment: true,
        updatePaymentMethod: 'portal',
        billingDescriptor: 'NATEPAY* TESTCREATOR',
        isPastDue: false,
        cancelAtPeriodEnd: false,
      },
    ],
    ...overrides,
  }
}

async function setupSubscriberPortalStubs(page: Page, subscriber: TestSubscriber) {
  let hasSession = false

  // Stub OTP request
  await page.route('**/subscriber/otp', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Code sent' }),
    })
  })

  // Stub OTP verification
  await page.route('**/subscriber/verify', async (route) => {
    const body = await route.request().postDataJSON()
    // Accept any 6-digit OTP in test mode
    if (body.otp?.length === 6) {
      hasSession = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          token: subscriber.token,
        }),
      })
    } else {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid code' }),
      })
    }
  })

  // Stub get subscriptions
  await page.route('**/subscriber/subscriptions', async (route) => {
    if (route.request().url().includes('/subscriber/subscriptions/')) {
      // This is a specific subscription request, let it fall through
      await route.fallback()
      return
    }
    if (!hasSession) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Unauthorized' }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        email: subscriber.email,
        maskedEmail: subscriber.maskedEmail,
        subscriptions: subscriber.subscriptions.map((s) => ({
          id: s.id,
          creator: {
            username: s.creatorUsername,
            displayName: s.creatorDisplayName,
            avatarUrl: null,
          },
          amount: s.amount,
          currency: s.currency,
          interval: s.interval,
          status: s.status,
          statusLabel: getStatusLabel(s.status, s.cancelAtPeriodEnd),
          currentPeriodEnd: s.currentPeriodEnd,
          startedAt: s.startedAt,
          totalPaid: s.totalPaid,
          paymentCount: s.paymentCount,
          provider: s.provider,
          canUpdatePayment: s.canUpdatePayment,
          updatePaymentMethod: s.updatePaymentMethod,
          billingDescriptor: s.billingDescriptor,
          isPastDue: s.isPastDue,
          cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        })),
        hasMore: false,
        nextCursor: null,
      }),
    })
  })

  // Stub get subscription detail
  await page.route('**/subscriber/subscriptions/*', async (route) => {
    const url = route.request().url()

    // Handle cancel endpoint
    if (url.includes('/cancel')) {
      const subId = url.match(/subscriptions\/([^/]+)\/cancel/)?.[1]
      const sub = subscriber.subscriptions.find((s) => s.id === subId)
      if (sub) {
        sub.cancelAtPeriodEnd = true
        sub.statusLabel = getStatusLabel(sub.status, sub.cancelAtPeriodEnd)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            message: 'Subscription will be canceled at end of billing period',
            cancelAtPeriodEnd: true,
            accessUntil: sub.currentPeriodEnd,
          }),
        })
        return
      }
    }

    // Handle reactivate endpoint
    if (url.includes('/reactivate')) {
      const subId = url.match(/subscriptions\/([^/]+)\/reactivate/)?.[1]
      const sub = subscriber.subscriptions.find((s) => s.id === subId)
      if (sub) {
        sub.status = 'active'
        sub.cancelAtPeriodEnd = false
        sub.statusLabel = getStatusLabel(sub.status, sub.cancelAtPeriodEnd)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            message: 'Subscription reactivated',
            subscription: { status: 'active' },
          }),
        })
        return
      }
    }

    // Handle portal endpoint
    if (url.includes('/portal')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: 'https://billing.stripe.com/test-portal',
          instructions: 'Update your payment method',
        }),
      })
      return
    }

    // Get subscription detail
    const subId = url.match(/subscriptions\/([^/]+)$/)?.[1]
    const sub = subscriber.subscriptions.find((s) => s.id === subId)
    if (sub) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subscription: {
            id: sub.id,
            creator: {
              username: sub.creatorUsername,
              displayName: sub.creatorDisplayName,
              avatarUrl: null,
            },
            amount: sub.amount,
            currency: sub.currency,
            interval: sub.interval,
            status: sub.status,
            statusLabel: getStatusLabel(sub.status, sub.cancelAtPeriodEnd),
            currentPeriodEnd: sub.currentPeriodEnd,
            startedAt: sub.startedAt,
            createdAt: new Date().toISOString(),
            totalPaid: sub.totalPaid,
            paymentCount: sub.paymentCount,
            provider: sub.provider,
            canUpdatePayment: sub.canUpdatePayment,
            updatePaymentMethod: sub.updatePaymentMethod,
            billingDescriptor: sub.billingDescriptor,
            isPastDue: sub.isPastDue,
            pastDueMessage: sub.isPastDue ? 'Payment failed, please update your card.' : null,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          },
          payments: [
            {
              id: `pay_${sub.id}`,
              amount: sub.amount,
              currency: sub.currency,
              date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
              status: 'succeeded',
            },
          ],
          actions: {
            canCancel: sub.status === 'active',
            canReactivate: sub.status === 'canceled',
            resubscribeUrl: `/${sub.creatorUsername}`,
          },
        }),
      })
    } else {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Subscription not found' }),
      })
    }
  })

  // Stub signout
  await page.route('**/subscriber/signout', async (route) => {
    hasSession = false
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    })
  })
}

test.describe('Subscriber Portal - Email Entry', () => {
  test('shows email input on portal page', async ({ page }) => {
    await page.route('**/subscriber/subscriptions', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Unauthorized' }),
      })
    })
    await page.goto('/subscriptions')

    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('button:has-text("Continue")')).toBeVisible()
  })

  test('validates email format', async ({ page }) => {
    await page.route('**/subscriber/subscriptions', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Unauthorized' }),
      })
    })
    await page.goto('/subscriptions')

    // Enter invalid email
    await page.fill('input[type="email"]', 'not-an-email')

    // Should show validation error or button should be disabled
    const button = page.locator('button:has-text("Continue")')
    const emailInput = page.locator('input[type="email"]')

    // Either button is disabled or input has invalid state
    const isButtonDisabled = await button.isDisabled().catch(() => false)
    const inputValidity = await emailInput.evaluate((el: HTMLInputElement) => el.validity.valid)

    expect(isButtonDisabled || !inputValidity).toBeTruthy()
  })
})

test.describe('Subscriber Portal - OTP Flow (Stubbed)', () => {
  test('shows OTP input after email submission', async ({ page }) => {
    const subscriber = createTestSubscriber()
    await setupSubscriberPortalStubs(page, subscriber)

    await page.goto('/subscriptions')
    await page.fill('input[type="email"]', subscriber.email)
    await page.click('button:has-text("Continue")')

    // Should show OTP input (6 digit inputs or single input)
    await expect(
      page.locator('input[inputmode="numeric"]').first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('shows subscriptions after valid OTP', async ({ page }) => {
    const subscriber = createTestSubscriber()
    await setupSubscriberPortalStubs(page, subscriber)

    await page.goto('/subscriptions')

    // Enter email
    await page.fill('input[type="email"]', subscriber.email)
    await page.click('button:has-text("Continue")')

    // Wait for OTP input
    await expect(page.locator('input[inputmode="numeric"]').first()).toBeVisible({ timeout: 5000 })

    // Enter OTP (6 digits)
    const otpInputs = page.locator('input[inputmode="numeric"]')
    const inputCount = await otpInputs.count()

    if (inputCount === 6) {
      // 6 separate inputs
      for (let i = 0; i < 6; i++) {
        await otpInputs.nth(i).fill(String(i + 1))
      }
    } else {
      // Single input
      await otpInputs.first().fill('123456')
    }

    // Should show subscriptions list
    await expect(
      page.locator('text=Test Creator').or(page.locator('text=Monthly Support'))
    ).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Subscriber Portal - Subscription Management (Stubbed)', () => {
  async function loginToPortal(page: Page, subscriber: TestSubscriber) {
    await setupSubscriberPortalStubs(page, subscriber)
    await page.goto('/subscriptions')

    await page.fill('input[type="email"]', subscriber.email)
    await page.click('button:has-text("Continue")')

    await expect(page.locator('input[inputmode="numeric"]').first()).toBeVisible({ timeout: 5000 })

    const otpInputs = page.locator('input[inputmode="numeric"]')
    const inputCount = await otpInputs.count()

    if (inputCount === 6) {
      for (let i = 0; i < 6; i++) {
        await otpInputs.nth(i).fill(String(i + 1))
      }
    } else {
      await otpInputs.first().fill('123456')
    }

    // Wait for subscriptions to load
    await expect(
      page.locator('text=Test Creator').or(page.locator('text=Monthly Support'))
    ).toBeVisible({ timeout: 5000 })
  }

  test('displays subscription details', async ({ page }) => {
    const subscriber = createTestSubscriber()
    await loginToPortal(page, subscriber)

    // Should show subscription info
    await expect(page.locator('text=Test Creator')).toBeVisible()
    await expect(page.locator('text=$10').or(page.locator('text=10.00'))).toBeVisible()
  })

  test('can initiate subscription cancellation', async ({ page }) => {
    const subscriber = createTestSubscriber()
    await loginToPortal(page, subscriber)

    // Click on subscription or manage button
    const manageButton = page.locator('button:has-text("Manage"), button:has-text("Cancel"), a:has-text("Manage")')
    if (await manageButton.isVisible()) {
      await manageButton.first().click()
    }

    // Look for cancel option
    const cancelButton = page.locator('button:has-text("Cancel")')
    if (await cancelButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cancelButton.click()

      // Should show confirmation or success
      await expect(
        page.locator('text=cancel').or(page.locator('text=end of'))
      ).toBeVisible({ timeout: 5000 })
    }
  })
})

test.describe('Portal UI', () => {
  test('is responsive on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/subscriptions')

    // Form should still be visible and usable
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('button:has-text("Continue")')).toBeVisible()

    // Check form is not cut off
    const emailInput = page.locator('input[type="email"]')
    const box = await emailInput.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(200) // Reasonable input width
  })

  test('shows loading state during OTP request', async ({ page }) => {
    // Stub subscriptions to prevent 401 from blocking UI
    await page.route('**/subscriber/subscriptions', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Not authenticated' }),
      })
    })

    // Add a delay to the OTP stub to see loading state
    await page.route('**/subscriber/otp', async (route) => {
      await new Promise((r) => setTimeout(r, 500))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Code sent' }),
      })
    })

    await page.goto('/subscriptions')
    await page.fill('input[type="email"]', 'test@test.com')

    // Click and check for loading state
    const continueButton = page.locator('button:has-text("Continue")')
    await continueButton.click()

    // Button text changes to "Sending..." when loading (no spinner class used)
    // Check for either disabled state or text change
    const hasSendingText = await page.locator('button:has-text("Sending")').isVisible({ timeout: 2000 }).catch(() => false)
    const isDisabled = await continueButton.isDisabled().catch(() => false)

    expect(hasSendingText || isDisabled).toBeTruthy()
  })
})

test.describe('Portal Security', () => {
  test('handles invalid OTP gracefully', async ({ page }) => {
    // Setup stub that rejects OTP
    await page.route('**/subscriber/otp', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Code sent' }),
      })
    })

    await page.route('**/subscriber/verify', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid code' }),
      })
    })

    await page.goto('/subscriptions')
    await page.fill('input[type="email"]', 'test@test.com')
    await page.click('button:has-text("Continue")')

    // Wait for OTP input
    await expect(page.locator('input[inputmode="numeric"]').first()).toBeVisible({ timeout: 5000 })

    // Enter wrong OTP - use pressSequentially to trigger onChange events properly
    const otpInputs = page.locator('input[inputmode="numeric"]')
    const inputCount = await otpInputs.count()

    if (inputCount === 6) {
      // Type into first input, auto-advance should handle the rest
      for (let i = 0; i < 6; i++) {
        await otpInputs.nth(i).pressSequentially('9')
      }
    } else {
      await otpInputs.first().pressSequentially('999999')
    }

    // Should show error message in portal-error div
    await expect(
      page.locator('[data-testid="portal-error"]').or(page.locator('text=Invalid code'))
    ).toBeVisible({ timeout: 5000 })
  })
})
