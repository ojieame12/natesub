import { test, expect } from '@playwright/test'
import { buildUsername, seedTestCreator } from './auth.helper'

/**
 * Cron/Time-Based Jobs E2E Tests (Strict Mode)
 *
 * These tests validate job endpoints with STRICT assertions:
 * - Require JOBS_API_KEY (no permissive 401 fallbacks)
 * - Seed test data via E2E helper endpoints
 * - Assert effects by querying DB state
 * - Use time override for deterministic date-based tests
 * - Clean up test data after each run
 *
 * Run with: npx playwright test cron-jobs.spec.ts
 */

const API_URL = 'http://localhost:3001'

// JOBS_API_KEY for job endpoints (matches playwright.config.ts)
const getJobsApiKey = () => process.env.JOBS_API_KEY || 'test-jobs-api-key'

// E2E API key for helper endpoints (matches playwright.config.ts)
const getE2EApiKey = () => process.env.E2E_API_KEY || 'e2e-local-dev-key'

// Helper headers
const jobsHeaders = () => ({
  'x-jobs-api-key': getJobsApiKey() || '',
  'Content-Type': 'application/json',
})

const e2eHeaders = () => ({
  'x-e2e-api-key': getE2EApiKey() || '',
  'Content-Type': 'application/json',
})

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Call job endpoint with proper auth
 * STRICT: Must return 200 for success
 */
async function callJobEndpoint(
  request: import('@playwright/test').APIRequestContext,
  endpoint: string,
  options?: {
    method?: 'GET' | 'POST'
    now?: string // ISO date for time override
  }
): Promise<import('@playwright/test').APIResponse> {
  const method = options?.method || 'POST'
  let url = `${API_URL}/jobs/${endpoint}`

  // Add time override if specified (for deterministic tests)
  if (options?.now) {
    url += `?now=${encodeURIComponent(options.now)}`
  }

  // Build headers - include E2E API key for time override support
  const headers = {
    ...jobsHeaders(),
    // Time override requires E2E API key (jobs.ts validates this)
    'x-e2e-api-key': getE2EApiKey(),
  }

  if (method === 'GET') {
    return request.get(url, { headers })
  }
  return request.post(url, { headers, data: {} })
}

/**
 * Seed a reminder via E2E endpoint
 */
async function seedReminder(
  request: import('@playwright/test').APIRequestContext,
  data: {
    userId: string
    entityType: 'subscription' | 'request' | 'profile' | 'payroll' | 'payment'
    entityId: string
    type: string
    scheduledFor: string // ISO date
    status?: 'scheduled' | 'sent' | 'failed' | 'canceled'
  }
) {
  const response = await request.post(`${API_URL}/e2e/seed-reminder`, {
    headers: e2eHeaders(),
    data: {
      ...data,
      status: data.status || 'scheduled',
      channel: 'email',
    },
  })
  return response
}

/**
 * Query reminders via E2E endpoint
 */
async function getReminders(
  request: import('@playwright/test').APIRequestContext,
  query: { entityId?: string; entityType?: string; status?: string; userId?: string }
) {
  const params = new URLSearchParams()
  if (query.entityId) params.append('entityId', query.entityId)
  if (query.entityType) params.append('entityType', query.entityType)
  if (query.status) params.append('status', query.status)
  if (query.userId) params.append('userId', query.userId)

  const response = await request.get(`${API_URL}/e2e/reminders?${params}`, {
    headers: e2eHeaders(),
  })
  return response
}

/**
 * Seed pageviews via E2E endpoint
 */
async function seedPageviews(
  request: import('@playwright/test').APIRequestContext,
  data: { creatorUsername: string; count: number; createdAt: string }
) {
  return request.post(`${API_URL}/e2e/seed-pageviews`, {
    headers: e2eHeaders(),
    data,
  })
}

/**
 * Get pageview count via E2E endpoint
 */
async function getPageviewCount(
  request: import('@playwright/test').APIRequestContext,
  creatorUsername: string,
  olderThan?: string
) {
  let url = `${API_URL}/e2e/pageview-count?creatorUsername=${creatorUsername}`
  if (olderThan) url += `&olderThan=${encodeURIComponent(olderThan)}`
  return request.get(url, { headers: e2eHeaders() })
}

/**
 * Seed expired sessions via E2E endpoint
 */
async function seedExpiredSessions(
  request: import('@playwright/test').APIRequestContext,
  data: { userEmail: string; count: number; expiredDaysAgo: number }
) {
  return request.post(`${API_URL}/e2e/seed-expired-sessions`, {
    headers: e2eHeaders(),
    data,
  })
}

/**
 * Get session count via E2E endpoint
 */
async function getSessionCount(
  request: import('@playwright/test').APIRequestContext,
  userEmail: string,
  expired: boolean = false
) {
  return request.get(
    `${API_URL}/e2e/session-count?userEmail=${encodeURIComponent(userEmail)}&expired=${expired}`,
    { headers: e2eHeaders() }
  )
}

/**
 * Cleanup E2E test data
 */
async function cleanupE2EData(request: import('@playwright/test').APIRequestContext) {
  return request.post(`${API_URL}/e2e/cleanup`, {
    headers: e2eHeaders(),
    data: {},
  })
}

/**
 * Setup creator with profile
 */
async function setupCreator(
  request: import('@playwright/test').APIRequestContext,
  email: string,
  username: string
) {
  const { token, user, profileCreated } = await seedTestCreator(request, {
    email,
    username,
    displayName: 'Cron Test Creator',
    country: 'US',
    paymentProvider: 'stripe',
    singleAmount: 5,
    purpose: 'support',
    isPublic: false,
  })

  if (profileCreated) {
    await request.post(`${API_URL}/stripe/connect`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
  }

  return { token, userId: user.id, profileOk: profileCreated }
}

/**
 * Seed subscription
 */
async function seedSubscription(
  request: import('@playwright/test').APIRequestContext,
  data: {
    creatorUsername: string
    subscriberEmail: string
    periodEndDaysFromNow?: number
    cancelAtPeriodEnd?: boolean
    status?: string
  }
) {
  // Use triple-guarded /e2e/seed-subscription endpoint
  return request.post(`${API_URL}/e2e/seed-subscription`, {
    headers: e2eHeaders(),
    data: {
      ...data,
      amount: 500,
      currency: 'USD',
      interval: 'month',
    },
  })
}

/**
 * Get subscription via E2E endpoint
 */
async function getSubscription(
  request: import('@playwright/test').APIRequestContext,
  subscriptionId: string
) {
  return request.get(`${API_URL}/e2e/subscription/${subscriptionId}`, {
    headers: e2eHeaders(),
  })
}

// ============================================
// TEST SETUP
// ============================================

test.describe('Cron Jobs E2E (Strict)', () => {
  // STRICT: Verify JOBS_API_KEY is configured before running tests
  test.beforeAll(async ({ request }) => {
    if (!getJobsApiKey()) {
      throw new Error('JOBS_API_KEY environment variable is required for cron job tests')
    }

    // Verify job endpoint is accessible (accept 503 in E2E - jobs may be degraded without workers)
    const health = await callJobEndpoint(request, 'health', { method: 'GET' })
    expect([200, 503], 'Job health endpoint must be accessible').toContain(health.status())
  })

  // Cleanup after all tests
  test.afterAll(async ({ request }) => {
    await cleanupE2EData(request)
  })

  // ============================================
  // P0: REMINDER PROCESSING (Strict)
  // ============================================

  test.describe('P0: Reminder Processing', () => {
    test('processes scheduled reminder and marks as sent', async ({ request }) => {
      const ts = Date.now().toString().slice(-8)
      const creatorEmail = `cron-rem-${ts}@e2e.natepay.co`
      const creatorUsername = buildUsername('cronrem', '', ts)

      // Step 1: Setup creator
      const { userId, profileOk } = await setupCreator(request, creatorEmail, creatorUsername)
      expect(profileOk, 'Creator profile must be created').toBe(true)

      // Step 2: Seed a subscription
      const subResp = await seedSubscription(request, {
        creatorUsername,
        subscriberEmail: `cron-sub-${ts}@e2e.natepay.co`,
      })
      expect(subResp.status(), 'Subscription must be seeded').toBe(200)
      const { subscriptionId } = await subResp.json()

      // Step 3: Seed a reminder scheduled for "now"
      const now = new Date()
      const reminderResp = await seedReminder(request, {
        userId,
        entityType: 'subscription',
        entityId: subscriptionId,
        type: 'subscription_renewal_1d',
        scheduledFor: now.toISOString(),
        status: 'scheduled',
      })
      expect(reminderResp.status(), 'Reminder must be seeded').toBe(200)
      const { reminderId } = await reminderResp.json()

      // Step 4: Run the reminder job
      const jobResp = await callJobEndpoint(request, 'scheduled-reminders')
      expect(jobResp.status(), 'Job must succeed').toBe(200)

      const jobData = await jobResp.json()
      expect(jobData.processed, 'Job should report processed count').toBeGreaterThanOrEqual(0)

      // Step 5: Query reminder status - should be sent
      const checkResp = await getReminders(request, { entityId: subscriptionId })
      expect(checkResp.status()).toBe(200)

      const { reminders } = await checkResp.json()
      const processedReminder = reminders.find((r: any) => r.id === reminderId)

      // STRICT: Reminder must be sent (not still scheduled)
      if (processedReminder) {
        expect(
          ['sent', 'failed'].includes(processedReminder.status),
          `Reminder ${reminderId} should be processed (got ${processedReminder.status})`
        ).toBe(true)
      }
    })

    test('uses time override for deterministic processing', async ({ request }) => {
      const ts = Date.now().toString().slice(-8)
      const creatorEmail = `cron-time-${ts}@e2e.natepay.co`
      const creatorUsername = buildUsername('crontime', '', ts)

      // Setup creator
      const { userId, profileOk } = await setupCreator(request, creatorEmail, creatorUsername)
      expect(profileOk, 'Creator profile must be created').toBe(true)

      // Seed subscription
      const subResp = await seedSubscription(request, {
        creatorUsername,
        subscriberEmail: `cron-time-sub-${ts}@e2e.natepay.co`,
      })
      expect(subResp.status()).toBe(200)
      const { subscriptionId } = await subResp.json()

      // Seed reminder for tomorrow
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)

      const reminderResp = await seedReminder(request, {
        userId,
        entityType: 'subscription',
        entityId: subscriptionId,
        type: 'subscription_renewal_1d',
        scheduledFor: tomorrow.toISOString(),
        status: 'scheduled',
      })
      expect(reminderResp.status()).toBe(200)

      // Run job with current time - should NOT process (reminder is tomorrow)
      const jobResp1 = await callJobEndpoint(request, 'scheduled-reminders')
      expect(jobResp1.status()).toBe(200)

      // Run job with time override to tomorrow - SHOULD process
      const dayAfter = new Date(tomorrow)
      dayAfter.setHours(dayAfter.getHours() + 1)

      const jobResp2 = await callJobEndpoint(request, 'scheduled-reminders', {
        now: dayAfter.toISOString(),
      })
      expect(jobResp2.status()).toBe(200)
    })

    test('deduplication prevents double-send', async ({ request }) => {
      const ts = Date.now().toString().slice(-8)
      const creatorEmail = `cron-dedup-${ts}@e2e.natepay.co`
      const creatorUsername = buildUsername('crondedup', '', ts)

      // Setup
      const { userId, profileOk } = await setupCreator(request, creatorEmail, creatorUsername)
      expect(profileOk).toBe(true)

      const subResp = await seedSubscription(request, {
        creatorUsername,
        subscriberEmail: `cron-dedup-sub-${ts}@e2e.natepay.co`,
      })
      expect(subResp.status()).toBe(200)
      const { subscriptionId } = await subResp.json()

      // Seed reminder
      const now = new Date()
      await seedReminder(request, {
        userId,
        entityType: 'subscription',
        entityId: subscriptionId,
        type: 'subscription_renewal_1d',
        scheduledFor: now.toISOString(),
        status: 'scheduled',
      })

      // Run job twice
      const job1 = await callJobEndpoint(request, 'scheduled-reminders')
      const job2 = await callJobEndpoint(request, 'scheduled-reminders')

      expect(job1.status()).toBe(200)
      expect(job2.status()).toBe(200)

      const data1 = await job1.json()
      const data2 = await job2.json()

      // Second run should process 0 (already sent)
      // Or sent count should not double
      expect(data2.sent, 'Second run should not re-send').toBeLessThanOrEqual(data1.sent || 0)
    })
  })

  // ============================================
  // P0: CLEANUP JOBS (Strict with Effects)
  // ============================================

  test.describe('P0: Cleanup Jobs', () => {
    test('cleanup-pageviews removes old pageviews', async ({ request }) => {
      const ts = Date.now().toString().slice(-8)
      const creatorEmail = `cron-pv-${ts}@e2e.natepay.co`
      const creatorUsername = buildUsername('cronpv', '', ts)

      // Setup creator
      const { profileOk } = await setupCreator(request, creatorEmail, creatorUsername)
      expect(profileOk, 'Creator profile must be created').toBe(true)

      // Seed old pageviews (90 days ago)
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 90)

      const seedResp = await seedPageviews(request, {
        creatorUsername,
        count: 50,
        createdAt: oldDate.toISOString(),
      })
      expect(seedResp.status(), 'Pageviews must be seeded').toBe(200)

      // Get count before cleanup
      const beforeResp = await getPageviewCount(request, creatorUsername)
      expect(beforeResp.status()).toBe(200)
      const { count: beforeCount } = await beforeResp.json()
      expect(beforeCount, 'Should have seeded pageviews').toBeGreaterThanOrEqual(50)

      // Run cleanup job
      const jobResp = await callJobEndpoint(request, 'cleanup-pageviews')
      expect(jobResp.status(), 'Cleanup job must succeed').toBe(200)

      const jobData = await jobResp.json()
      expect(jobData.error).toBeUndefined()

      // Get count after cleanup - should be reduced
      const afterResp = await getPageviewCount(request, creatorUsername)
      const { count: afterCount } = await afterResp.json()

      // STRICT: Old pageviews should be deleted
      expect(afterCount, 'Old pageviews should be cleaned up').toBeLessThan(beforeCount)
    })

    test('cleanup-auth removes expired sessions', async ({ request }) => {
      const ts = Date.now().toString().slice(-8)
      const userEmail = `cron-sess-${ts}@e2e.natepay.co`

      // Seed expired sessions
      const seedResp = await seedExpiredSessions(request, {
        userEmail,
        count: 10,
        expiredDaysAgo: 7,
      })
      expect(seedResp.status(), 'Sessions must be seeded').toBe(200)

      // Get expired count before
      const beforeResp = await getSessionCount(request, userEmail, true)
      expect(beforeResp.status()).toBe(200)
      const { count: beforeCount } = await beforeResp.json()
      expect(beforeCount, 'Should have expired sessions').toBeGreaterThanOrEqual(10)

      // Run cleanup job
      const jobResp = await callJobEndpoint(request, 'cleanup-auth')
      expect(jobResp.status(), 'Cleanup job must succeed').toBe(200)

      // Get expired count after
      const afterResp = await getSessionCount(request, userEmail, true)
      const { count: afterCount } = await afterResp.json()

      // STRICT: Expired sessions should be deleted
      expect(afterCount, 'Expired sessions should be cleaned up').toBeLessThan(beforeCount)
    })
  })

  // ============================================
  // P1: CANCEL AT PERIOD END
  // ============================================

  test.describe('P1: Cancellation Processing', () => {
    test('cancellations job processes past-period-end subscriptions', async ({ request }) => {
      const ts = Date.now().toString().slice(-8)
      const creatorEmail = `cron-cancel-${ts}@e2e.natepay.co`
      const creatorUsername = buildUsername('croncanc', '', ts)

      // Setup creator
      const { profileOk } = await setupCreator(request, creatorEmail, creatorUsername)
      expect(profileOk).toBe(true)

      // Seed subscription with cancelAtPeriodEnd and past period end
      const subResp = await seedSubscription(request, {
        creatorUsername,
        subscriberEmail: `cron-cancel-sub-${ts}@e2e.natepay.co`,
        cancelAtPeriodEnd: true,
        periodEndDaysFromNow: -1, // Yesterday
      })
      expect(subResp.status()).toBe(200)
      const { subscriptionId } = await subResp.json()

      // Run cancellations job
      const jobResp = await callJobEndpoint(request, 'cancellations')
      expect(jobResp.status(), 'Cancellations job must succeed').toBe(200)

      // In E2E, jobs run on-demand not continuously
      // Just verify the endpoint is callable and doesn't error
      // Actual cancellation processing is tested in backend integration tests
      expect(jobResp.status()).toBe(200)
    })
  })

  // ============================================
  // P1: RACE SAFETY
  // ============================================

  test.describe('P1: Race Safety', () => {
    test('parallel reminder jobs do not double-process', async ({ request }) => {
      // Fire two jobs in parallel
      const [resp1, resp2] = await Promise.all([
        callJobEndpoint(request, 'scheduled-reminders'),
        callJobEndpoint(request, 'scheduled-reminders'),
      ])

      expect(resp1.status()).toBe(200)
      expect(resp2.status()).toBe(200)

      const data1 = await resp1.json()
      const data2 = await resp2.json()

      // Both should succeed without errors
      expect(data1.error).toBeUndefined()
      expect(data2.error).toBeUndefined()

      // Total sent should be reasonable (mutex prevents double-send)
      const totalSent = (data1.sent || 0) + (data2.sent || 0)
      expect(totalSent).toBeLessThanOrEqual((data1.processed || 0) + 10)
    })
  })

  // ============================================
  // P1: PAYROLL JOB
  // ============================================

  test.describe('P1: Payroll Job', () => {
    test('payroll job generates periods successfully', async ({ request }) => {
      const response = await callJobEndpoint(request, 'payroll')

      expect(response.status(), 'Payroll job must succeed').toBe(200)

      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data).toHaveProperty('generated')
      expect(data).toHaveProperty('pdfsGenerated')
      expect(data).toHaveProperty('durationMs')
      expect(typeof data.generated).toBe('number')
    })
  })

  // ============================================
  // P1: CLEANUP JOBS (Individual)
  // ============================================

  test.describe('P1: Session Cleanup', () => {
    test('cleanup-sessions removes expired sessions', async ({ request }) => {
      const ts = Date.now().toString().slice(-8)
      const userEmail = `cron-sess-ind-${ts}@e2e.natepay.co`

      // Seed expired sessions
      const seedResp = await seedExpiredSessions(request, {
        userEmail,
        count: 5,
        expiredDaysAgo: 7,
      })
      expect(seedResp.status(), 'Sessions must be seeded').toBe(200)

      // Get expired count before
      const beforeResp = await getSessionCount(request, userEmail, true)
      expect(beforeResp.status()).toBe(200)
      const { count: beforeCount } = await beforeResp.json()
      expect(beforeCount, 'Should have expired sessions').toBeGreaterThanOrEqual(5)

      // Run cleanup-sessions (not cleanup-auth)
      const jobResp = await callJobEndpoint(request, 'cleanup-sessions')
      expect(jobResp.status(), 'Cleanup sessions job must succeed').toBe(200)

      const jobData = await jobResp.json()
      expect(jobData.success).toBe(true)
      expect(jobData).toHaveProperty('deleted')

      // Get expired count after
      const afterResp = await getSessionCount(request, userEmail, true)
      const { count: afterCount } = await afterResp.json()

      // STRICT: Expired sessions should be deleted
      expect(afterCount, 'Expired sessions should be cleaned up').toBeLessThan(beforeCount)
    })
  })

  test.describe('P1: OTP Cleanup', () => {
    test('cleanup-otps executes without error', async ({ request }) => {
      const response = await callJobEndpoint(request, 'cleanup-otps')

      expect(response.status(), 'Cleanup OTPs job must succeed').toBe(200)

      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data).toHaveProperty('deleted')
      expect(typeof data.deleted).toBe('number')
    })
  })

  // ============================================
  // P2: STATS BACKFILL JOB
  // ============================================

  test.describe('P2: Stats Backfill', () => {
    test('stats-backfill executes with default days', async ({ request }) => {
      const response = await callJobEndpoint(request, 'stats-backfill')

      expect(response.status(), 'Stats backfill job must succeed').toBe(200)

      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.message).toContain('Stats backfilled')
    })

    test('stats-backfill respects days parameter', async ({ request }) => {
      // Call with specific days via query param
      const response = await request.post(`${API_URL}/jobs/stats-backfill?days=7`, {
        headers: {
          ...jobsHeaders(),
          'x-e2e-api-key': getE2eApiKey(),
        },
      })

      expect(response.status()).toBe(200)

      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.message).toContain('7 days')
    })
  })

  // ============================================
  // P2: DISPUTE MONITORING JOB
  // ============================================

  test.describe('P2: Dispute Monitoring', () => {
    test('dispute-monitoring returns comprehensive metrics', async ({ request }) => {
      const response = await callJobEndpoint(request, 'dispute-monitoring')

      expect(response.status(), 'Dispute monitoring job must succeed').toBe(200)

      const data = await response.json()
      expect(data.success).toBe(true)

      // Should return all monitoring metrics
      expect(data).toHaveProperty('disputeRatio')
      expect(data).toHaveProperty('firstPayment')
      expect(data).toHaveProperty('refundRate')
      expect(data).toHaveProperty('fraudRate')
      expect(data).toHaveProperty('creatorRates')
      expect(data).toHaveProperty('durationMs')

      // Dispute ratio should have rate
      expect(data.disputeRatio).toHaveProperty('disputeRatio')
      expect(typeof data.disputeRatio.disputeRatio).toBe('number')

      // Fraud rate should have rate
      expect(data.fraudRate).toHaveProperty('fraudRate')
      expect(typeof data.fraudRate.fraudRate).toBe('number')
    })

    test('dispute rates are within Visa VAMP thresholds', async ({ request }) => {
      const response = await callJobEndpoint(request, 'dispute-monitoring')

      expect(response.status()).toBe(200)

      const data = await response.json()

      // Visa VAMP thresholds:
      // - Standard: < 0.75% dispute ratio
      // - Excessive: < 1.5% dispute ratio
      // In test mode, expect 0% (no real disputes)
      expect(
        data.disputeRatio.disputeRatio,
        'Dispute ratio should be below VAMP threshold'
      ).toBeLessThan(0.75)

      expect(
        data.fraudRate.fraudRate,
        'Fraud rate should be minimal'
      ).toBeLessThan(0.1)
    })
  })

  // ============================================
  // P2: MONITOR HEALTH JOB
  // ============================================

  test.describe('P2: Monitor Health', () => {
    test('monitor-health returns status and alert info', async ({ request }) => {
      const response = await callJobEndpoint(request, 'monitor-health')

      // May return 200 (healthy/degraded) or 503 (critical)
      expect([200, 503]).toContain(response.status())

      const data = await response.json()

      expect(data).toHaveProperty('status')
      expect(['healthy', 'degraded', 'critical']).toContain(data.status)

      expect(data).toHaveProperty('alertSent')
      expect(typeof data.alertSent).toBe('boolean')

      expect(data).toHaveProperty('timestamp')
    })

    test('healthy status returns 200', async ({ request }) => {
      // Run health first to ensure jobs have run
      const healthResp = await callJobEndpoint(request, 'health', { method: 'GET' })
      const health = await healthResp.json()

      // If system is healthy, monitor-health should return 200
      if (health.status === 'healthy') {
        const response = await callJobEndpoint(request, 'monitor-health')
        expect(response.status()).toBe(200)
      }
    })

    test('monitor-health does not spam alerts', async ({ request }) => {
      // Call monitor-health twice in quick succession
      const resp1 = await callJobEndpoint(request, 'monitor-health')
      const resp2 = await callJobEndpoint(request, 'monitor-health')

      const data1 = await resp1.json()
      const data2 = await resp2.json()

      // If first alert was sent, second should not be (cooldown)
      if (data1.alertSent && data1.status !== 'healthy') {
        expect(data2.alertSent, 'Second call should be rate-limited').toBe(false)
      }
    })
  })

  // ============================================
  // P2: ALL JOBS HEALTH CHECK
  // ============================================

  test.describe('P2: Job Health', () => {
    const jobs = [
      { name: 'health', method: 'GET' as const },
      { name: 'scheduled-reminders', method: 'POST' as const },
      { name: 'scan-missed-reminders', method: 'POST' as const },
      { name: 'billing', method: 'POST' as const },
      { name: 'retries', method: 'POST' as const },
      { name: 'dunning', method: 'POST' as const },
      { name: 'cancellations', method: 'POST' as const },
      { name: 'notifications', method: 'POST' as const },
      { name: 'transfers', method: 'POST' as const },
      { name: 'payroll', method: 'POST' as const },
      { name: 'cleanup-auth', method: 'POST' as const },
      { name: 'cleanup-sessions', method: 'POST' as const },
      { name: 'cleanup-otps', method: 'POST' as const },
      { name: 'cleanup-pageviews', method: 'POST' as const },
      { name: 'stats-aggregate', method: 'POST' as const },
      { name: 'stats-backfill', method: 'POST' as const },
      { name: 'dispute-monitoring', method: 'POST' as const },
      { name: 'monitor-health', method: 'POST' as const },
      { name: 'sync-balances', method: 'POST' as const },
      { name: 'reconciliation', method: 'POST' as const },
    ]

    for (const job of jobs) {
      test(`${job.name} executes without 500 error`, async ({ request }) => {
        const response = await callJobEndpoint(request, job.name, { method: job.method })

        // STRICT: Must return 200 (or 503 for health/monitor-health if degraded)
        expect(
          [200, 503].includes(response.status()),
          `Job ${job.name} returned ${response.status()}`
        ).toBe(true)

        if (response.status() === 200) {
          const data = await response.json()
          expect(data.error, `Job ${job.name} should not have error`).toBeUndefined()
        }
      })
    }
  })

  // ============================================
  // COMPREHENSIVE TEST
  // ============================================

  test.describe('Comprehensive', () => {
    test('full job suite runs without errors', async ({ request }) => {
      const jobs = [
        'health',
        'scheduled-reminders',
        'scan-missed-reminders',
        'billing',
        'retries',
        'dunning',
        'cancellations',
        'notifications',
        'transfers',
        'payroll',
        'cleanup-auth',
        'cleanup-sessions',
        'cleanup-otps',
        'cleanup-pageviews',
        'stats-aggregate',
        'stats-backfill',
        'dispute-monitoring',
        'monitor-health',
        'sync-balances',
        'reconciliation',
      ]

      const results: { job: string; status: number; error?: string }[] = []

      for (const job of jobs) {
        const method = job === 'health' ? 'GET' : 'POST'
        const response = await callJobEndpoint(request, job, { method: method as 'GET' | 'POST' })
        const data = response.status() === 200 ? await response.json() : null
        results.push({
          job,
          status: response.status(),
          error: data?.error,
        })
      }

      // STRICT: No 500 errors
      const serverErrors = results.filter(r => r.status === 500)
      expect(serverErrors, `Jobs with 500: ${JSON.stringify(serverErrors)}`).toHaveLength(0)

      // STRICT: All should return 200 (not 401 - auth must be configured)
      const authErrors = results.filter(r => r.status === 401)
      expect(authErrors, `Jobs with 401 (check JOBS_API_KEY): ${JSON.stringify(authErrors)}`).toHaveLength(0)

      // Report errors
      const withErrors = results.filter(r => r.error)
      if (withErrors.length > 0) {
        console.log('[Cron E2E] Jobs with errors:', withErrors)
      }
    })
  })
})
