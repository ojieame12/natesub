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
import { adminAuth, requireValidAdminOrigin, requireAllowedIp } from '../../middleware/adminAuth.js'
import { adminReadRateLimit } from '../../middleware/rateLimit.js'

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
import apiKeys from './api-keys.js'
import admins from './admins.js'
import financials from './financials.js'
import tax from './tax.js'
import analytics from './analytics.js'
import creators from './creators.js'
import refundsRoutes from './refunds.js'
import bulk from './bulk.js'
import exportRoutes from './export.js'

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

// Apply IP allowlist for API key auth (when ADMIN_IP_ALLOWLIST is configured)
// Must run after adminAuth so we know the auth method
admin.use('*', requireAllowedIp)

// Apply CSRF protection for session-based state-changing requests
// API key auth bypasses this (used in trusted automated contexts)
admin.use('*', requireValidAdminOrigin)

// Apply rate limiting to all admin routes (100 req/min per admin)
// Prevents bulk scraping if admin credentials are compromised
admin.use('*', adminReadRateLimit)

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

// Mount API key management routes at /api-keys
// These define: /, /:id, /:id/usage (CRUD + usage audit)
// Requires super_admin role
admin.route('/api-keys', apiKeys)

// Mount admin user management routes at /admins
// These define: /, /users/:id/promote, /users/:id/demote, /audit
// Requires super_admin role
admin.route('/admins', admins)

// Mount financial tools at /financials
// These define: /reconciliation, /fee-audit, /balance-sheet, /daily/:date
// Requires super_admin role
admin.route('/financials', financials)

// Mount tax reporting at /tax
// These define: /summary/:year, /creator-earnings/:year, /export-1099
// Requires super_admin role
admin.route('/tax', tax)

// Mount analytics at /analytics
// These define: /churn, /ltv, /at-risk, /cohort/:month, /mrr
// Requires admin role
admin.route('/analytics', analytics)

// Mount creator management at /creators
// These define: /, /:id, /:id/restrict, /:id/unrestrict, /stats/overview
// Requires admin role (restrict/unrestrict require fresh session)
admin.route('/creators', creators)

// Mount refund management at /refunds
// These define: /, /eligible/:paymentId, /:paymentId/process, /stats, /policy
// Requires admin role (process requires fresh session)
admin.route('/refunds', refundsRoutes)

// Mount bulk operations at /bulk
// These define: /cancel-subscriptions/preview, /cancel-subscriptions,
//               /block-users/preview, /block-users, /unblock-users
// Requires super_admin role and fresh session
admin.route('/bulk', bulk)

// Mount data export at /export
// These define: /payments, /subscriptions, /creators, /users, /disputes
// Requires admin role
admin.route('/export', exportRoutes)

export default admin
