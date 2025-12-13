// Job Routes - Protected endpoints for scheduled tasks
// These should be called by cron/scheduler with the JOBS_API_KEY

import { Hono } from 'hono'
import { env } from '../config/env.js'
import { processRecurringBilling, processRetries } from '../jobs/billing.js'
import { generatePayrollPeriods } from '../jobs/payroll.js'
import { sendRenewalReminders, sendDunningEmails, sendCancellationEmails } from '../jobs/notifications.js'

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

// Health check for job system
jobs.get('/health', async (c) => {
  return c.json({
    status: 'ok',
    jobs: ['billing', 'retries', 'payroll', 'reminders', 'dunning', 'cancellations', 'notifications'],
    timestamp: new Date().toISOString(),
  })
})

export default jobs
