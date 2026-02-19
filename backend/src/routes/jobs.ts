import { Hono } from 'hono'
import { env } from '../config/env.js'
import { db } from '../db/client.js'
import { billingQueue } from '../lib/queue.js'
import { recordJobRun } from '../lib/jobHealth.js'
import { generatePayrollPeriods } from '../jobs/payroll.js'
import { sendDunningEmails, sendCancellationEmails } from '../jobs/notifications.js'
import { monitorStuckTransfers } from '../jobs/transfers.js'
import { reconcilePaystackTransactions } from '../jobs/reconciliation.js'
import { processDueReminders, scanAndScheduleMissedReminders } from '../jobs/reminders.js'
import { cleanupOldPageViews } from '../jobs/cleanup.js'
import { syncAllActiveBalances } from '../services/balanceSync.js'
import { safeError, ErrorCodes } from '../utils/logger.js'
import {
  monitorDisputeRatio,
  monitorFirstPaymentDisputes,
  monitorRefundRate,
  monitorFraudRate,
  monitorCreatorDisputeRates,
} from '../jobs/dispute-monitoring.js'

// Helper to track job execution time and record health
async function runTrackedJob<T>(
  jobName: string,
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const startTime = Date.now()
  try {
    const result = await fn()
    const durationMs = Date.now() - startTime
    await recordJobRun(jobName, durationMs, true)
    return { result, durationMs }
  } catch (err: any) {
    const durationMs = Date.now() - startTime
    await recordJobRun(jobName, durationMs, false, err.message)
    throw err
  }
}

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

  if (env.E2E_MODE === 'true') {
    const e2eKey = c.req.header('x-e2e-api-key')
    if (e2eKey && e2eKey === env.E2E_API_KEY) {
      await next()
      return
    }
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
    const { durationMs } = await runTrackedJob('billing', async () => {
      await billingQueue.add('recurring-billing', { type: 'recurring' })
      return { queued: true }
    })
    return c.json({ success: true, message: 'Billing job queued', durationMs })
  } catch (error: any) {
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/billing'), 500)
  }
})

// Process retry queue (run hourly)
jobs.post('/retries', async (c) => {
  console.log('[jobs] Queuing retry job')

  try {
    const { durationMs } = await runTrackedJob('retries', async () => {
      await billingQueue.add('retry-billing', { type: 'retry' })
      return { queued: true }
    })
    return c.json({ success: true, message: 'Retry job queued', durationMs })
  } catch (error: any) {
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/retries'), 500)
  }
})

// Generate payroll periods (run on 1st and 16th of month)
jobs.post('/payroll', async (c) => {
  console.log('[jobs] Starting payroll generation job')

  try {
    const { result, durationMs } = await runTrackedJob('payroll', generatePayrollPeriods)

    console.log(`[jobs] Payroll complete: ${result.generated} periods, ${result.pdfsGenerated} PDFs`)

    return c.json({
      success: true,
      ...result,
      durationMs,
    })
  } catch (error: any) {
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/payroll'), 500)
  }
})

// NOTE: Legacy /reminders endpoint removed - renewal reminders are now scheduled
// per-subscription via scheduleSubscriptionRenewalReminders() in jobs/reminders.ts
// Use /scheduled-reminders to process due reminders

// Send dunning emails for failed payments (run daily, after billing)
jobs.post('/dunning', async (c) => {
  console.log('[jobs] Starting dunning emails job')

  try {
    const { result, durationMs } = await runTrackedJob('dunning', sendDunningEmails)

    console.log(`[jobs] Dunning complete: ${result.sent}/${result.processed} sent`)

    return c.json({
      success: true,
      ...result,
      durationMs,
    })
  } catch (error: any) {
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/dunning'), 500)
  }
})

// Send cancellation notifications (run daily)
jobs.post('/cancellations', async (c) => {
  console.log('[jobs] Starting cancellation emails job')

  try {
    const { result, durationMs } = await runTrackedJob('cancellations', sendCancellationEmails)

    console.log(`[jobs] Cancellations complete: ${result.sent}/${result.processed} sent`)

    return c.json({
      success: true,
      ...result,
      durationMs,
    })
  } catch (error: any) {
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/cancellations'), 500)
  }
})

// Run all notification jobs (convenience endpoint)
// NOTE: renewal reminders removed - now handled via scheduled-reminders
jobs.post('/notifications', async (c) => {
  console.log('[jobs] Starting all notification jobs')

  try {
    const startTime = Date.now()
    const [dunning, cancellations] = await Promise.all([
      sendDunningEmails(),
      sendCancellationEmails(),
    ])
    const durationMs = Date.now() - startTime

    // Record sub-job health so JOB_SCHEDULES staleness tracking works
    await Promise.all([
      recordJobRun('dunning', durationMs, true),
      recordJobRun('cancellations', durationMs, true),
    ]).catch(() => {}) // Non-critical — don't fail the endpoint

    return c.json({
      success: true,
      dunning,
      cancellations,
      durationMs,
    })
  } catch (error: any) {
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/notifications'), 500)
  }
})

// Monitor stuck transfers (run hourly)
jobs.post('/transfers', async (c) => {
  console.log('[jobs] Starting transfer monitoring job')

  try {
    const { result, durationMs } = await runTrackedJob('transfers', monitorStuckTransfers)

    console.log(`[jobs] Transfer monitoring complete: ${result.stuckTransfers} stuck, ${result.alertsSent} alerts sent`)

    return c.json({
      success: true,
      ...result,
      durationMs,
    })
  } catch (error: any) {
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/transfers'), 500)
  }
})

// Reconcile Paystack transactions (run nightly)
jobs.post('/reconciliation', async (c) => {
  console.log('[jobs] Starting Paystack reconciliation job')

  try {
    const { result, durationMs } = await runTrackedJob('reconciliation', () =>
      reconcilePaystackTransactions({
        periodHours: 48,       // Look back 48 hours
        autoFix: false,        // Don't auto-fix, just alert
        alertOnDiscrepancy: true,
      })
    )

    console.log(`[jobs] Reconciliation complete: ${result.missingInDb.length} missing, ${result.statusMismatches.length} mismatched`)

    return c.json({
      success: true,
      ...result,
      durationMs,
    })
  } catch (error: any) {
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/reconciliation'), 500)
  }
})

// Process scheduled reminders (run hourly)
// This handles request/invoice/payout/payroll/onboarding reminders
// Supports ?now=ISO_DATE for E2E testing (only in E2E_MODE with valid API key)
jobs.post('/scheduled-reminders', async (c) => {
  // Support time override for E2E testing with strict validation
  const nowParam = c.req.query('now')
  let effectiveNow: Date | undefined

  if (nowParam && env.E2E_MODE === 'true') {
    // Require E2E API key for time override (prevents abuse)
    const e2eApiKey = c.req.header('x-e2e-api-key')
    if (!env.E2E_API_KEY || e2eApiKey !== env.E2E_API_KEY) {
      console.warn('[jobs] Time override rejected: invalid E2E API key')
      // Silently ignore invalid override attempt
    } else {
      // Validate ISO format (strict: must be valid ISO 8601)
      const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/
      if (!isoRegex.test(nowParam)) {
        console.warn(`[jobs] Time override rejected: invalid ISO format: ${nowParam}`)
      } else {
        const parsedDate = new Date(nowParam)

        // Validate date is valid and within bounds (±30 days)
        const now = new Date()
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
        const minDate = new Date(now.getTime() - thirtyDaysMs)
        const maxDate = new Date(now.getTime() + thirtyDaysMs)

        if (isNaN(parsedDate.getTime())) {
          console.warn(`[jobs] Time override rejected: invalid date: ${nowParam}`)
        } else if (parsedDate < minDate || parsedDate > maxDate) {
          console.warn(`[jobs] Time override rejected: out of bounds (±30 days): ${nowParam}`)
        } else {
          effectiveNow = parsedDate
          console.log(`[jobs] E2E time override: ${effectiveNow.toISOString()}`)
        }
      }
    }
  }

  console.log('[jobs] Starting scheduled reminders job')

  try {
    const { result, durationMs } = await runTrackedJob('scheduled-reminders', () =>
      processDueReminders(effectiveNow)
    )

    console.log(`[jobs] Scheduled reminders complete: ${result.sent}/${result.processed} sent, ${result.failed} failed`)

    return c.json({
      success: true,
      ...result,
      durationMs,
    })
  } catch (error: any) {
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/reminders'), 500)
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
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/scan-reminders'), 500)
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
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/cleanup-sessions'), 500)
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
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/cleanup-otps'), 500)
  }
})

// Combined auth cleanup (convenience endpoint - run daily)
jobs.post('/cleanup-auth', async (c) => {
  console.log('[jobs] Starting combined auth cleanup job')

  try {
    const { result, durationMs } = await runTrackedJob('cleanup-auth', async () => {
      const [sessions, otps] = await Promise.all([
        db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
        db.magicLinkToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
      ])
      return { sessions: sessions.count, otps: otps.count }
    })

    console.log(`[jobs] Auth cleanup complete: ${result.sessions} sessions, ${result.otps} OTPs deleted`)

    return c.json({
      success: true,
      sessions: { deleted: result.sessions },
      otps: { deleted: result.otps },
      durationMs,
    })
  } catch (error: any) {
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/cleanup-auth'), 500)
  }
})

// Clean up old page views (run weekly)
jobs.post('/cleanup-pageviews', async (c) => {
  console.log('[jobs] Starting page views cleanup job')

  try {
    const { result: deleted, durationMs } = await runTrackedJob('cleanup-pageviews', cleanupOldPageViews)

    console.log(`[jobs] Page views cleanup complete: ${deleted} deleted`)

    return c.json({
      success: true,
      deleted,
      durationMs,
    })
  } catch (error: any) {
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/cleanup-pageviews'), 500)
  }
})

// Aggregate daily stats (run daily at midnight UTC)
jobs.post('/stats-aggregate', async (c) => {
  console.log('[jobs] Starting stats aggregation job')

  try {
    const { durationMs } = await runTrackedJob('stats-aggregate', async () => {
      const { aggregateToday, aggregateYesterday } = await import('../jobs/stats-aggregation.js')

      // Aggregate both today (partial) and yesterday (final)
      await Promise.all([
        aggregateToday(),
        aggregateYesterday(),
      ])

      return { aggregated: true }
    })

    console.log('[jobs] Stats aggregation complete')

    return c.json({
      success: true,
      message: 'Stats aggregated for today and yesterday',
      durationMs,
    })
  } catch (error: any) {
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/stats-aggregate'), 500)
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
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/stats-backfill'), 500)
  }
})

// Monitor dispute rates for Visa VAMP compliance (run daily)
// Tracks: platform dispute ratio, first-payment disputes, refund rate, fraud rate, per-creator rates
jobs.post('/dispute-monitoring', async (c) => {
  console.log('[jobs] Starting dispute monitoring job')

  try {
    const { result, durationMs } = await runTrackedJob('dispute-monitoring', async () => {
      const [disputeRatio, firstPayment, refundRate, fraudRate, creatorRates] = await Promise.all([
        monitorDisputeRatio(),
        monitorFirstPaymentDisputes(),
        monitorRefundRate(),
        monitorFraudRate(),
        monitorCreatorDisputeRates(),
      ])
      return { disputeRatio, firstPayment, refundRate, fraudRate, creatorRates }
    })

    console.log(`[jobs] Dispute monitoring complete: ${result.disputeRatio.disputeRatio.toFixed(4)}% dispute rate, ${result.fraudRate.fraudRate.toFixed(4)}% fraud rate`)

    return c.json({
      success: true,
      ...result,
      durationMs,
    })
  } catch (error: any) {
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/dispute-monitoring'), 500)
  }
})

// Sync creator balances from Stripe/Paystack (run every 15-30 minutes)
// This keeps dashboard balance data fresh even for inactive users
jobs.post('/sync-balances', async (c) => {
  console.log('[jobs] Starting balance sync for all active creators...')

  try {
    const { result, durationMs } = await runTrackedJob('sync-balances', syncAllActiveBalances)

    console.log(`[jobs] Balance sync complete: synced=${result.synced}, failed=${result.failed}, skipped=${result.skipped}, duration=${durationMs}ms`)

    return c.json({
      success: true,
      ...result,
      durationMs,
    })
  } catch (error: any) {
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/balance-sync'), 500)
  }
})

// Retry failed/pending_retry webhooks (run every 5-15 minutes)
// Picks up events that failed queue-dispatch and got status 'pending_retry'
jobs.post('/webhook-retries', async (c) => {
  console.log('[jobs] Starting webhook retry job')

  try {
    const { getFailedWebhooksForRetry, retryWebhook } = await import('../services/dlq.js')

    const { result, durationMs } = await runTrackedJob('webhook-retries', async () => {
      const events = await getFailedWebhooksForRetry()
      let retried = 0
      let failed = 0

      for (const event of events) {
        const { success } = await retryWebhook(event.id)
        if (success) {
          retried++
        } else {
          failed++
        }
      }

      return { found: events.length, retried, failed }
    })

    console.log(`[jobs] Webhook retries complete: ${result.retried}/${result.found} retried, ${result.failed} failed`)

    return c.json({
      success: true,
      ...result,
      durationMs,
    })
  } catch (error: any) {
    return c.json(safeError(ErrorCodes.JOB_FAILED, error, 'jobs/webhook-retries'), 500)
  }
})

// Health check for job system - reports last run times, staleness, and queue depths
jobs.get('/health', async (c) => {
  const { getJobsHealth } = await import('../lib/jobHealth.js')
  const { getQueueDepths } = await import('../lib/queue.js')

  const [health, queueDepths] = await Promise.all([
    getJobsHealth(),
    getQueueDepths(),
  ])

  // Return 503 if critical jobs are stale
  const statusCode = health.status === 'critical' ? 503 : 200

  return c.json({
    ...health,
    queues: queueDepths,
    timestamp: new Date().toISOString(),
  }, statusCode)
})

/**
 * Monitor health and send alerts on degraded/critical status
 *
 * Called by external cron (Railway cron, etc.) every 15 minutes.
 * Sends email alerts on degraded, Slack + email on critical.
 * Uses deduplication to avoid spam (alerts on state transitions, 1hr cooldown).
 */
jobs.post('/monitor-health', async (c) => {
  const { getJobsHealth, shouldSendAlert, recordAlertSent, clearAlertState } = await import('../lib/jobHealth.js')
  const { sendJobHealthAlert } = await import('../services/alerts.js')
  const { alertJobHealthCritical } = await import('../services/slack.js')

  const health = await getJobsHealth()

  // Clear alert state if healthy (resets cooldown for next degradation)
  if (health.status === 'healthy') {
    await clearAlertState()
    return c.json({
      status: health.status,
      alertSent: false,
      message: 'All jobs healthy',
    })
  }

  // Check if we should send an alert (state transition or cooldown expired)
  const shouldAlert = await shouldSendAlert(health.status)

  if (shouldAlert) {
    // Build job details for alert
    const details = health.jobs
      .filter(j => j.isStale || j.lastRunSuccess === false)
      .map(j => ({
        name: j.name,
        staleSinceMinutes: j.staleSinceMinutes,
        lastError: (j as any).lastRunError || null,
      }))

    try {
      // Always send email alert
      await sendJobHealthAlert(
        health.status as 'degraded' | 'critical',
        health.staleJobs,
        health.failedJobs,
        details
      )

      // Send Slack only for critical
      if (health.status === 'critical') {
        await alertJobHealthCritical(health.staleJobs, health.failedJobs)
      }

      await recordAlertSent(health.status)

      console.log(`[jobs] Health alert sent: ${health.status}, stale=[${health.staleJobs.join(',')}], failed=[${health.failedJobs.join(',')}]`)
    } catch (err: any) {
      console.error('[jobs] Failed to send health alert:', err.message)
    }
  }

  // Return 503 for critical (useful for external uptime monitoring)
  const statusCode = health.status === 'critical' ? 503 : 200

  return c.json({
    status: health.status,
    staleJobs: health.staleJobs,
    failedJobs: health.failedJobs,
    alertSent: shouldAlert,
    timestamp: new Date().toISOString(),
  }, statusCode)
})

export default jobs
