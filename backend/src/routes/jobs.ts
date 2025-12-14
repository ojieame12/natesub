// Job Routes - Protected endpoints for scheduled tasks
// These should be called by cron/scheduler with the JOBS_API_KEY

import { Hono } from 'hono'
import { env } from '../config/env.js'
import { processRecurringBilling, processRetries } from '../jobs/billing.js'
import { generatePayrollPeriods } from '../jobs/payroll.js'
import { sendRenewalReminders, sendDunningEmails, sendCancellationEmails } from '../jobs/notifications.js'
import { monitorStuckTransfers } from '../jobs/transfers.js'
import { reconcilePaystackTransactions } from '../jobs/reconciliation.js'
import { processDueReminders, scanAndScheduleMissedReminders } from '../jobs/reminders.js'

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
  console.log('[jobs] Starting recurring billing job')

  try {
    const result = await processRecurringBilling()

    console.log(`[jobs] Billing complete: ${result.succeeded}/${result.processed} succeeded`)

    return c.json({
      success: true,
      ...result,
    })
  } catch (error: any) {
    console.error('[jobs] Billing job failed:', error.message)
    return c.json({ error: 'Billing job failed', message: error.message }, 500)
  }
})

// Process retry queue (run hourly)
jobs.post('/retries', async (c) => {
  console.log('[jobs] Starting retry job')

  try {
    const result = await processRetries()

    console.log(`[jobs] Retries complete: ${result.succeeded}/${result.processed} succeeded`)

    return c.json({
      success: true,
      ...result,
    })
  } catch (error: any) {
    console.error('[jobs] Retry job failed:', error.message)
    return c.json({ error: 'Retry job failed', message: error.message }, 500)
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

// Health check for job system
jobs.get('/health', async (c) => {
  return c.json({
    status: 'ok',
    jobs: ['billing', 'retries', 'payroll', 'reminders', 'dunning', 'cancellations', 'notifications', 'transfers', 'reconciliation', 'scheduled-reminders', 'scan-missed-reminders'],
    timestamp: new Date().toISOString(),
  })
})

export default jobs
