/**
 * Admin Routes - Modular Entry Point
 *
 * Combines all admin controller modules into a single router.
 *
 * Controller Files:
 * - users.ts: User management, test cleanup, creator creation
 * - payments.ts: Payments, refunds, disputes, blocked subscribers
 * - subscriptions.ts: Subscription management
 * - stripe.ts: Stripe Connect visibility and payouts
 * - paystack.ts: Paystack bank verification
 * - system.ts: Health, webhooks, transfers, reconciliation, logs, etc.
 * - support.ts: Support ticket management
 *
 * Authentication is handled by centralized middleware in middleware/adminAuth.ts
 */

import { Hono } from 'hono'
import { adminAuth } from '../../middleware/adminAuth.js'

// Import controllers
import users from './users.js'
import payments from './payments.js'
import subscriptions from './subscriptions.js'
import stripeRoutes from './stripe.js'
import paystackRoutes from './paystack.js'
import system from './system.js'
import support from './support.js'
import disputes, { blockedSubscribers, subscribers } from './disputes.js'
import adminRevenue from '../admin-revenue.js'

const admin = new Hono()

// Apply admin auth to all routes except /me (which uses optional auth)
admin.use('*', async (c, next) => {
  const path = c.req.path
  // /admin/me uses optional auth - handled in system.ts
  if (path === '/admin/me' || path === '/me') {
    await next()
    return
  }
  // All other routes require full admin auth
  await adminAuth(c, next)
})

// Mount system routes at root level
// These define: /me, /health, /email/*, /metrics, /dashboard, /webhooks/*,
//               /sync/*, /transfers/*, /reconciliation/*, /activity, /logs/*,
//               /reminders/*, /emails, /invoices
admin.route('/', system)

// Mount user management routes at /users
// These define: /, /:id, /:id/block, /:id/unblock, /test-cleanup/*, /create-creator
admin.route('/users', users)

// Mount Paystack routes at /paystack
// These define: /banks/:country, /resolve-account
admin.route('/paystack', paystackRoutes)

// Mount payment routes at /payments
// These define: /, /:id, /:id/refund
admin.route('/payments', payments)

// Mount dispute routes at /disputes
// These define: /stats, /
admin.route('/disputes', disputes)

// Mount blocked subscriber routes at /blocked-subscribers
// These define: /, /:id/unblock
admin.route('/blocked-subscribers', blockedSubscribers)

// Mount subscriber routes at /subscribers
// These define: /:id/block
admin.route('/subscribers', subscribers)

// Mount subscription routes at /subscriptions
// These define: /, /:id/cancel, /:id/pause, /:id/resume
admin.route('/subscriptions', subscriptions)

// Mount Stripe routes at /stripe
// These define: /accounts, /accounts/:id, /accounts/:id/payout, /accounts/:id/disable-payouts,
//               /accounts/:id/enable-payouts, /transfers, /balance, /events, /customers/:id
admin.route('/stripe', stripeRoutes)

// Mount support routes at /support
// These define: /tickets/stats, /tickets, /tickets/:id, /tickets/:id/reply, /tickets/:id/resolve
admin.route('/support', support)

// Mount revenue routes at /revenue (from existing admin-revenue.ts)
// These define: /overview, /by-provider, /by-currency, /daily, /monthly, /top-creators, /refunds
admin.route('/revenue', adminRevenue)

export default admin
