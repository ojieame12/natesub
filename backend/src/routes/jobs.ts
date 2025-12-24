import { Hono } from 'hono'
import { env } from '../config/env.js'
import { db } from '../db/client.js'
import { billingQueue } from '../lib/queue.js'
import { generatePayrollPeriods } from '../jobs/payroll.js'
import { sendRenewalReminders, sendDunningEmails, sendCancellationEmails } from '../jobs/notifications.js'
import { monitorStuckTransfers } from '../jobs/transfers.js'
import { reconcilePaystackTransactions } from '../jobs/reconciliation.js'
import { processDueReminders, scanAndScheduleMissedReminders } from '../jobs/reminders.js'
import { cleanupOldPageViews } from '../jobs/cleanup.js'
import { syncAllActiveBalances } from '../services/balanceSync.js'
import {
  monitorDisputeRatio,
  monitorFirstPaymentDisputes,
  monitorRefundRate,
  monitorFraudRate,
  monitorCreatorDisputeRates,
} from '../jobs/dispute-monitoring.js'

const jobs = new Hono()

// Simple API key auth for job endpoints
// SECURITY: Only accept API key via header (not query params) to prevent key leakage in logs
const requireJobsAuth = async (c: any, next: () => Promise<void>) => {
  const apiKey = c.req.header('x-jobs-api-key')
  const expectedKey = env.JOBS_API_KEY

  if (!expectedKey) {
    console.warn('[jobs] JOBS_API_KEY not configured, jobs endpoint disabled')
    return c.json({ error: 'Jobs endpoint not configured' }, 503)
  }

  if (!apiKey || apiKey !== expectedKey) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
}

// Apply auth to all job routes
jobs.use('*', requireJobsAuth)

// Process recurring billing (run daily)
jobs.post('/billing', async (c) => {
  console.log('[jobs] Queuing recurring billing job')

  try {
    await billingQueue.add('recurring-billing', { type: 'recurring' })
    return c.json({ success: true, message: 'Billing job queued' })
  } catch (error: any) {
    console.error('[jobs] Failed to queue billing job:', error.message)
    return c.json({ error: 'Failed to queue billing job', message: error.message }, 500)
  }
})

// Process retry queue (run hourly)
jobs.post('/retries', async (c) => {
  console.log('[jobs] Queuing retry job')

  try {
    await billingQueue.add('retry-billing', { type: 'retry' })
    return c.json({ success: true, message: 'Retry job queued' })
  } catch (error: any) {
    console.error('[jobs] Failed to queue retry job:', error.message)
    return c.json({ error: 'Failed to queue retry job', message: error.message }, 500)
  }
})

// Generate payroll periods (run on 1st and 16th of month)
jobs.post('/payroll', async (c) => {
  console.log('[jobs] Starting payroll generation job')

  try {
    const result = await generatePayrollPeriods()

    console.log(`[jobs] Payroll complete: ${result.generated} periods, ${result.pdfsGenerated} PDFs`)

    return c.json({
      success: true,
      ...result,
    })
  } catch (error: any) {
    console.error('[jobs] Payroll job failed:', error.message)
    return c.json({ error: 'Payroll job failed', message: error.message }, 500)
  }
})

// Send renewal reminders (run daily, morning)
jobs.post('/reminders', async (c) => {
  console.log('[jobs] Starting renewal reminders job')

  try {
    const result = await sendRenewalReminders()

    console.log(`[jobs] Reminders complete: ${result.sent}/${result.processed} sent`)

    return c.json({
      success: true,
      ...result,
    })
  } catch (error: any) {
    console.error('[jobs] Reminders job failed:', error.message)
    return c.json({ error: 'Reminders job failed', message: error.message }, 500)
  }
})

// Send dunning emails for failed payments (run daily, after billing)
jobs.post('/dunning', async (c) => {
  console.log('[jobs] Starting dunning emails job')

  try {
    const result = await sendDunningEmails()

    console.log(`[jobs] Dunning complete: ${result.sent}/${result.processed} sent`)

    return c.json({
      success: true,
      ...result,
    })
  } catch (error: any) {
    console.error('[jobs] Dunning job failed:', error.message)
    return c.json({ error: 'Dunning job failed', message: error.message }, 500)
  }
})

// Send cancellation notifications (run daily)
jobs.post('/cancellations', async (c) => {
  console.log('[jobs] Starting cancellation emails job')

  try {
    const result = await sendCancellationEmails()

    console.log(`[jobs] Cancellations complete: ${result.sent}/${result.processed} sent`)

    return c.json({
      success: true,
      ...result,
    })
  } catch (error: any) {
    console.error('[jobs] Cancellations job failed:', error.message)
    return c.json({ error: 'Cancellations job failed', message: error.message }, 500)
  }
})

// Run all notification jobs (convenience endpoint)
jobs.post('/notifications', async (c) => {
  console.log('[jobs] Starting all notification jobs')

  try {
    const [reminders, dunning, cancellations] = await Promise.all([
      sendRenewalReminders(),
      sendDunningEmails(),
      sendCancellationEmails(),
    ])

    return c.json({
      success: true,
      reminders,
      dunning,
      cancellations,
    })
  } catch (error: any) {
    console.error('[jobs] Notifications job failed:', error.message)
    return c.json({ error: 'Notifications job failed', message: error.message }, 500)
  }
})

// Monitor stuck transfers (run hourly)
jobs.post('/transfers', async (c) => {
  console.log('[jobs] Starting transfer monitoring job')

  try {
    const result = await monitorStuckTransfers()

    console.log(`[jobs] Transfer monitoring complete: ${result.stuckTransfers} stuck, ${result.alertsSent} alerts sent`)

    return c.json({
      success: true,
      ...result,
    })
  } catch (error: any) {
    console.error('[jobs] Transfer monitoring job failed:', error.message)
    return c.json({ error: 'Transfer monitoring job failed', message: error.message }, 500)
  }
})

// Reconcile Paystack transactions (run nightly)
jobs.post('/reconciliation', async (c) => {
  console.log('[jobs] Starting Paystack reconciliation job')

  try {
    const result = await reconcilePaystackTransactions({
      periodHours: 48,       // Look back 48 hours
      autoFix: false,        // Don't auto-fix, just alert
      alertOnDiscrepancy: true,
    })

    console.log(`[jobs] Reconciliation complete: ${result.missingInDb.length} missing, ${result.statusMismatches.length} mismatched`)

    return c.json({
      success: true,
      ...result,
    })
  } catch (error: any) {
    console.error('[jobs] Reconciliation job failed:', error.message)
    return c.json({ error: 'Reconciliation job failed', message: error.message }, 500)
  }
})

// Process scheduled reminders (run hourly)
// This handles request/invoice/payout/payroll/onboarding reminders
jobs.post('/scheduled-reminders', async (c) => {
  console.log('[jobs] Starting scheduled reminders job')

  try {
    const result = await processDueReminders()

    console.log(`[jobs] Scheduled reminders complete: ${result.sent}/${result.processed} sent, ${result.failed} failed`)

    return c.json({
      success: true,
      ...result,
    })
  } catch (error: any) {
    console.error('[jobs] Scheduled reminders job failed:', error.message)
    return c.json({ error: 'Scheduled reminders job failed', message: error.message }, 500)
  }
})

// Scan for missed reminders (run once on deploy or weekly)
jobs.post('/scan-missed-reminders', async (c) => {
  console.log('[jobs] Starting scan for missed reminders')

  try {
    const scheduled = await scanAndScheduleMissedReminders()

    console.log(`[jobs] Scan complete: ${scheduled} reminders scheduled`)

    return c.json({
      success: true,
      scheduled,
    })
  } catch (error: any) {
    console.error('[jobs] Scan missed reminders job failed:', error.message)
    return c.json({ error: 'Scan missed reminders job failed', message: error.message }, 500)
  }
})

// Clean up expired sessions (run daily)
jobs.post('/cleanup-sessions', async (c) => {
  console.log('[jobs] Starting session cleanup job')

  try {
    const result = await db.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })

    console.log(`[jobs] Session cleanup complete: ${result.count} expired sessions deleted`)

    return c.json({
      success: true,
      deleted: result.count,
    })
  } catch (error: any) {
    console.error('[jobs] Session cleanup job failed:', error.message)
    return c.json({ error: 'Session cleanup job failed', message: error.message }, 500)
  }
})

// Clean up expired OTPs (run daily)
jobs.post('/cleanup-otps', async (c) => {
  console.log('[jobs] Starting OTP cleanup job')

  try {
    const result = await db.magicLinkToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })

    console.log(`[jobs] OTP cleanup complete: ${result.count} expired OTPs deleted`)

    return c.json({
      success: true,
      deleted: result.count,
    })
  } catch (error: any) {
    console.error('[jobs] OTP cleanup job failed:', error.message)
    return c.json({ error: 'OTP cleanup job failed', message: error.message }, 500)
  }
})

// Combined auth cleanup (convenience endpoint - run daily)
jobs.post('/cleanup-auth', async (c) => {
  console.log('[jobs] Starting combined auth cleanup job')

  try {
    const [sessions, otps] = await Promise.all([
      db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
      db.magicLinkToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    ])

    console.log(`[jobs] Auth cleanup complete: ${sessions.count} sessions, ${otps.count} OTPs deleted`)

    return c.json({
      success: true,
      sessions: { deleted: sessions.count },
      otps: { deleted: otps.count },
    })
  } catch (error: any) {
    console.error('[jobs] Auth cleanup job failed:', error.message)
    return c.json({ error: 'Auth cleanup job failed', message: error.message }, 500)
  }
})

// Clean up old page views (run weekly)
jobs.post('/cleanup-pageviews', async (c) => {
  console.log('[jobs] Starting page views cleanup job')

  try {
    const deleted = await cleanupOldPageViews()

    console.log(`[jobs] Page views cleanup complete: ${deleted} deleted`)

    return c.json({
      success: true,
      deleted,
    })
  } catch (error: any) {
    console.error('[jobs] Page views cleanup job failed:', error.message)
    return c.json({ error: 'Page views cleanup job failed', message: error.message }, 500)
  }
})

// Aggregate daily stats (run daily at midnight UTC)
jobs.post('/stats-aggregate', async (c) => {
  console.log('[jobs] Starting stats aggregation job')

  try {
    const { aggregateToday, aggregateYesterday } = await import('../jobs/stats-aggregation.js')

    // Aggregate both today (partial) and yesterday (final)
    await Promise.all([
      aggregateToday(),
      aggregateYesterday(),
    ])

    console.log('[jobs] Stats aggregation complete')

    return c.json({
      success: true,
      message: 'Stats aggregated for today and yesterday',
    })
  } catch (error: any) {
    console.error('[jobs] Stats aggregation job failed:', error.message)
    return c.json({ error: 'Stats aggregation job failed', message: error.message }, 500)
  }
})

// Backfill historical stats (run once, or when needed)
jobs.post('/stats-backfill', async (c) => {
  const { days = 30 } = c.req.query()
  const numDays = Math.min(parseInt(days as string) || 30, 365)

  console.log(`[jobs] Starting stats backfill for ${numDays} days`)

  try {
    const { backfillStats } = await import('../jobs/stats-aggregation.js')
    await backfillStats(numDays)

    console.log(`[jobs] Stats backfill complete for ${numDays} days`)

    return c.json({
      success: true,
      message: `Stats backfilled for ${numDays} days`,
    })
  } catch (error: any) {
    console.error('[jobs] Stats backfill job failed:', error.message)
    return c.json({ error: 'Stats backfill job failed', message: error.message }, 500)
  }
})

// Monitor dispute rates for Visa VAMP compliance (run daily)
// Tracks: platform dispute ratio, first-payment disputes, refund rate, fraud rate, per-creator rates
jobs.post('/dispute-monitoring', async (c) => {
  console.log('[jobs] Starting dispute monitoring job')

  try {
    const [disputeRatio, firstPayment, refundRate, fraudRate, creatorRates] = await Promise.all([
      monitorDisputeRatio(),
      monitorFirstPaymentDisputes(),
      monitorRefundRate(),
      monitorFraudRate(),
      monitorCreatorDisputeRates(),
    ])

    console.log(`[jobs] Dispute monitoring complete: ${disputeRatio.disputeRatio.toFixed(4)}% dispute rate, ${fraudRate.fraudRate.toFixed(4)}% fraud rate`)

    return c.json({
      success: true,
      disputeRatio,
      firstPayment,
      refundRate,
      fraudRate,
      creatorRates,
    })
  } catch (error: any) {
    console.error('[jobs] Dispute monitoring job failed:', error.message)
    return c.json({ error: 'Dispute monitoring job failed', message: error.message }, 500)
  }
})

// Sync creator balances from Stripe/Paystack (run every 15-30 minutes)
// This keeps dashboard balance data fresh even for inactive users
jobs.post('/sync-balances', async (c) => {
  console.log('[jobs] Starting balance sync for all active creators...')
  const startTime = Date.now()

  try {
    const result = await syncAllActiveBalances()
    const durationMs = Date.now() - startTime

    console.log(`[jobs] Balance sync complete: synced=${result.synced}, failed=${result.failed}, skipped=${result.skipped}, duration=${durationMs}ms`)

    return c.json({
      success: true,
      ...result,
      durationMs,
    })
  } catch (error: any) {
    console.error('[jobs] Balance sync job failed:', error.message)
    return c.json({ error: 'Balance sync job failed', message: error.message }, 500)
  }
})

// Health check for job system
jobs.get('/health', async (c) => {
  return c.json({
    status: 'ok',
    jobs: ['billing', 'retries', 'payroll', 'reminders', 'dunning', 'cancellations', 'notifications', 'transfers', 'reconciliation', 'scheduled-reminders', 'scan-missed-reminders', 'cleanup-sessions', 'cleanup-otps', 'cleanup-auth', 'cleanup-pageviews', 'stats-aggregate', 'stats-backfill', 'dispute-monitoring', 'sync-balances'],
    timestamp: new Date().toISOString(),
  })
})

export default jobs
