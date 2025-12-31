import { expect, test } from '@playwright/test'

function json(data: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(data),
  }
}

test.describe('Admin smoke', () => {
  test.beforeEach(async ({ page }) => {
    const now = new Date().toISOString()

    await page.addInitScript(() => {
      // Make `useAuthState()` treat the user as having a cookie session.
      localStorage.setItem('nate_has_session', 'true')
    })

    // Auth bootstrap (backend) - use flexible pattern to match any host/port
    await page.route('**/auth/me', async (route) => {
      await route.fulfill(
        json({
          id: 'user_admin_1',
          email: 'admin@test.com',
          createdAt: now,
          profile: {
            id: 'profile_admin_1',
            userId: 'user_admin_1',
            username: 'admin',
            displayName: 'Admin User',
            bio: null,
            avatarUrl: null,
            paymentProvider: 'stripe',
            stripeAccountId: 'acct_admin',
            country: 'US',
            currency: 'USD',
            isAdmin: true,
          },
          onboarding: {
            hasProfile: true,
            hasActivePayment: true,
            step: 0,
            branch: 'personal',
            data: null,
            redirectTo: '/dashboard',
          },
        })
      )
    })

    // Admin API stubs (UI smoke only; avoids hitting real Stripe/Paystack)
    await page.route('**/admin/**', async (route) => {
      const url = new URL(route.request().url())
      const path = url.pathname

      // Admin guard
      if (path === '/admin/me') {
        return route.fulfill(
          json({
            isAdmin: true,
            email: 'admin@test.com',
            role: 'super_admin',
          })
        )
      }

      // Revenue
      if (path === '/admin/revenue/overview') {
        return route.fulfill(
          json({
            allTime: { totalVolumeCents: 100000, platformFeeCents: 8000, creatorPayoutsCents: 92000, paymentCount: 50 },
            thisMonth: { totalVolumeCents: 25000, platformFeeCents: 2000, creatorPayoutsCents: 23000, paymentCount: 12 },
            lastMonth: { totalVolumeCents: 30000, platformFeeCents: 2400, creatorPayoutsCents: 27600, paymentCount: 15 },
            today: { totalVolumeCents: 1500, platformFeeCents: 120, creatorPayoutsCents: 1380, paymentCount: 1 },
            paymentsByStatus: { succeeded: 50, failed: 2 },
            freshness: {
              businessTimezone: 'UTC',
              lastPaymentAt: now,
              lastWebhookProcessedAt: now,
              lastWebhookProvider: 'stripe',
              lastWebhookType: 'invoice.paid',
            },
          })
        )
      }

      if (path === '/admin/revenue/by-provider') {
        const period = url.searchParams.get('period') || 'month'
        return route.fulfill(
          json({
            period,
            stripe: { totalVolumeCents: 12000, platformFeeCents: 960, creatorPayoutsCents: 11040, paymentCount: 6 },
            paystack: { totalVolumeCents: 13000, platformFeeCents: 1040, creatorPayoutsCents: 11960, paymentCount: 6 },
          })
        )
      }

      if (path === '/admin/revenue/by-currency') {
        const period = url.searchParams.get('period') || 'month'
        return route.fulfill(
          json({
            period,
            currencies: [
              { currency: 'USD', totalVolumeCents: 20000, platformFeeCents: 1600, creatorPayoutsCents: 18400, paymentCount: 10 },
              { currency: 'NGN', totalVolumeCents: 15000, platformFeeCents: 1200, creatorPayoutsCents: 13800, paymentCount: 8 },
            ],
          })
        )
      }

      if (path === '/admin/revenue/daily') {
        return route.fulfill(
          json({
            days: [
              { date: now.slice(0, 10), volumeCents: 1500, feesCents: 120, payoutsCents: 1380, count: 1 },
            ],
          })
        )
      }

      if (path === '/admin/revenue/monthly') {
        return route.fulfill(
          json({
            months: [
              { month: now.slice(0, 7), volumeCents: 25000, feesCents: 2000, payoutsCents: 23000, count: 12 },
            ],
          })
        )
      }

      if (path === '/admin/revenue/top-creators') {
        const period = url.searchParams.get('period') || 'month'
        return route.fulfill(
          json({
            period,
            creators: [
              {
                creatorId: 'creator_1',
                email: 'creator@example.com',
                username: 'creator',
                displayName: 'Creator',
                country: 'US',
                totalVolumeCents: 12000,
                platformFeeCents: 960,
                creatorEarningsCents: 11040,
                paymentCount: 6,
              },
            ],
          })
        )
      }

      if (path === '/admin/revenue/refunds') {
        const period = url.searchParams.get('period') || 'month'
        return route.fulfill(
          json({
            period,
            refunds: { totalCents: 0, count: 0 },
            disputes: { totalCents: 0, count: 0 },
            chargebacks: { totalCents: 0, count: 0 },
          })
        )
      }

      // Dashboard / Activity
      if (path === '/admin/dashboard') {
        return route.fulfill(
          json({
            users: { total: 100, newToday: 2, newThisMonth: 12 },
            subscriptions: { active: 40 },
            revenue: { totalCents: 8000, thisMonthCents: 2000 },
            flags: { disputedPayments: 0, failedPaymentsToday: 0 },
          })
        )
      }

      if (path === '/admin/activity') {
        return route.fulfill(json({ activities: [], total: 0, page: 1, totalPages: 1 }))
      }

      // Users / Payments / Subs
      if (path === '/admin/users') {
        return route.fulfill(
          json({
            users: [
              {
                id: 'user_1',
                email: 'creator@example.com',
                profile: {
                  username: 'creator',
                  displayName: 'Creator',
                  country: 'US',
                  paymentProvider: 'stripe',
                  payoutStatus: 'active',
                },
                status: 'active',
                revenueTotal: 11040,
                subscriberCount: 12,
                createdAt: now,
              },
            ],
            total: 1,
            page: 1,
            totalPages: 1,
          })
        )
      }

      if (path === '/admin/payments') {
        return route.fulfill(
          json({
            payments: [
              {
                id: 'payment_1',
                creator: { id: 'creator_1', email: 'creator@example.com', username: 'creator' },
                subscriber: { id: 'sub_1', email: 'sub@example.com' },
                grossCents: 1500,
                feeCents: 120,
                netCents: 1380,
                currency: 'USD',
                status: 'succeeded',
                type: 'recurring',
                provider: 'stripe',
                stripePaymentIntentId: 'pi_test',
                createdAt: now,
              },
            ],
            total: 1,
            page: 1,
            totalPages: 1,
          })
        )
      }

      if (path === '/admin/subscriptions') {
        return route.fulfill(
          json({
            subscriptions: [
              {
                id: 'sub_1',
                creator: { id: 'creator_1', email: 'creator@example.com', username: 'creator' },
                subscriber: { id: 'sub_1', email: 'sub@example.com' },
                amount: 1200,
                currency: 'USD',
                interval: 'month',
                status: 'active',
                ltvCents: 1200,
                currentPeriodEnd: now,
                createdAt: now,
              },
            ],
            total: 1,
            page: 1,
            totalPages: 1,
          })
        )
      }

      // Logs / Emails / Reminders / Invoices
      if (path === '/admin/logs/stats') {
        return route.fulfill(
          json({
            last24h: { emailsSent: 5, emailsFailed: 0, remindersSent: 1, totalErrors: 0 },
            errorsByType: [],
          })
        )
      }

      if (path === '/admin/logs') {
        return route.fulfill(
          json({
            logs: [
              {
                id: 'log_1',
                type: 'email_sent',
                level: 'info',
                userId: null,
                entityType: null,
                entityId: null,
                message: 'Sent email',
                metadata: null,
                errorMessage: null,
                createdAt: now,
              },
            ],
            total: 1,
            page: 1,
            totalPages: 1,
          })
        )
      }

      if (path === '/admin/emails') {
        return route.fulfill(
          json({
            emails: [
              {
                id: 'email_1',
                status: 'sent',
                to: 'sub@example.com',
                subject: 'Welcome',
                template: 'welcome',
                messageId: 'msg_1234567890',
                createdAt: now,
              },
            ],
            total: 1,
            page: 1,
            totalPages: 1,
          })
        )
      }

      if (path === '/admin/reminders/stats') {
        return route.fulfill(json({ scheduled: 0, sentToday: 0, failed: 0, upcomingNext24h: 0 }))
      }

      if (path === '/admin/reminders') {
        return route.fulfill(json({ reminders: [], total: 0, page: 1, totalPages: 1 }))
      }

      if (path === '/admin/invoices') {
        return route.fulfill(
          json({
            invoices: [
              {
                id: 'inv_1',
                creator: { id: 'creator_1', email: 'creator@example.com', username: 'creator' },
                recipientName: 'Client',
                recipientEmail: 'client@example.com',
                amountCents: 2500,
                currency: 'USD',
                status: 'sent',
                dueDate: now,
                createdAt: now,
              },
            ],
            total: 1,
            page: 1,
            totalPages: 1,
          })
        )
      }

      // Operations
      if (path === '/admin/health') {
        return route.fulfill(json({ status: 'healthy', timestamp: now }))
      }
      if (path === '/admin/webhooks/stats') {
        return route.fulfill(json({ failed: { stripe: 0, paystack: 0, total: 0 }, deadLetter: 0, processedLast24h: 0 }))
      }
      if (path === '/admin/webhooks/failed') {
        return route.fulfill(json({ events: [] }))
      }
      if (path === '/admin/disputes/stats') {
        return route.fulfill(
          json({
            current: { open: 0, blockedSubscribers: 0 },
            thisMonth: { won: 0, lost: 0 },
            allTime: { total: 0, winRate: '0%' },
          })
        )
      }
      if (path === '/admin/blocked-subscribers') {
        return route.fulfill(json({ blockedSubscribers: [], total: 0, page: 1, totalPages: 1 }))
      }

      // Operations: reconciliation tab
      if (path === '/admin/reconciliation/missing') {
        return route.fulfill(
          json({
            periodHours: 48,
            count: 0,
            windowStart: now,
            windowEnd: now,
            transactions: [],
            warning: null,
          })
        )
      }
      if (path === '/admin/sync/stripe-missing') {
        return route.fulfill(json({ missing: [], total: 0, checked: 0 }))
      }

      // Support
      if (path === '/admin/support/tickets/stats') {
        return route.fulfill(
          json({
            current: { open: 0, inProgress: 0, total: 0 },
            newLast24h: 0,
            resolvedLast7d: 0,
            byCategory: [],
            byPriority: [],
          })
        )
      }
      if (path === '/admin/support/tickets') {
        return route.fulfill(json({ tickets: [], pagination: { total: 0 } }))
      }

      // Stripe page
      if (path === '/admin/stripe/accounts') {
        return route.fulfill(
          json({
            accounts: [
              {
                userId: 'creator_1',
                email: 'creator@example.com',
                username: 'creator',
                displayName: 'Creator',
                country: 'US',
                currency: 'USD',
                localPayoutStatus: 'active',
                createdAt: now,
                stripeAccountId: 'acct_test',
                stripeStatus: {
                  chargesEnabled: true,
                  payoutsEnabled: true,
                  detailsSubmitted: true,
                  type: 'express',
                  country: 'US',
                  defaultCurrency: 'USD',
                  capabilities: {},
                  requirements: {
                    currentlyDue: [],
                    eventuallyDue: [],
                    pastDue: [],
                    pendingVerification: [],
                    disabledReason: null,
                  },
                },
              },
            ],
            total: 1,
            page: 1,
            totalPages: 1,
          })
        )
      }

      // Create Creator page
      if (path.startsWith('/admin/paystack/banks/')) {
        return route.fulfill(json({ banks: [{ code: '001', name: 'Test Bank' }] }))
      }

      // Default fallback: return 200 with empty payload to avoid unhandled 404s
      return route.fulfill(json({}))
    })
  })

  test('navigates all admin pages without runtime errors', async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    const routes: Array<{ path: string; title: string }> = [
      { path: '/admin', title: 'Overview' },
      { path: '/admin/revenue', title: 'Revenue Analytics' },
      { path: '/admin/users', title: 'Users' },
      { path: '/admin/create-creator', title: 'Create Creator Account' },
      { path: '/admin/payments', title: 'Payments' },
      { path: '/admin/subscriptions', title: 'Subscriptions' },
      { path: '/admin/stripe', title: 'Stripe' },
      { path: '/admin/emails', title: 'Email Logs' },
      { path: '/admin/reminders', title: 'Reminders' },
      { path: '/admin/logs', title: 'System Logs' },
      { path: '/admin/invoices', title: 'Invoices' },
      { path: '/admin/ops', title: 'Operations' },
      { path: '/admin/support', title: 'Support Tickets' },
    ]

    for (const r of routes) {
      await page.goto(r.path)
      await expect(page.locator('h1.admin-page-title')).toHaveText(r.title)
    }

    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })
})
