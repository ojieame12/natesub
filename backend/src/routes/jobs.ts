// Job Routes - Protected endpoints for scheduled tasks
// These should be called by cron/scheduler with the JOBS_API_KEY

import { Hono } from 'hono'
import { env } from '../config/env.js'
import { processRecurringBilling, processRetries } from '../jobs/billing.js'
import { generatePayrollPeriods } from '../jobs/payroll.js'

const jobs = new Hono()

// Simple API key auth for job endpoints
const requireJobsAuth = async (c: any, next: () => Promise<void>) => {
  const apiKey = c.req.header('x-jobs-api-key') || c.req.query('key')
  const expectedKey = env.JOBS_API_KEY

  if (!expectedKey) {
    console.warn('[jobs] JOBS_API_KEY not configured, jobs endpoint disabled')
    return c.json({ error: 'Jobs endpoint not configured' }, 503)
  }

  if (apiKey !== expectedKey) {
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

// Health check for job system
jobs.get('/health', async (c) => {
  return c.json({
    status: 'ok',
    jobs: ['billing', 'retries', 'payroll'],
    timestamp: new Date().toISOString(),
  })
})

export default jobs
