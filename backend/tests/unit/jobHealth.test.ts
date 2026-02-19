/**
 * Job Health Tracking Tests
 *
 * Tests for the job health tracking module including:
 * - Recording job runs
 * - Staleness detection
 * - Health status calculation
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { redisMock } from '../setup.js'

// Import the module under test
import {
  recordJobRun,
  getJobsHealth,
  JOB_SCHEDULES,
  shouldSendAlert,
  recordAlertSent,
  clearAlertState,
} from '../../src/lib/jobHealth.js'

describe('Job Health Tracking', () => {
  beforeEach(() => {
    redisMock.clear()
  })

  describe('recordJobRun', () => {
    it('records a successful job run', async () => {
      await recordJobRun('billing', 1234, true)

      const key = 'job_health:billing'
      const stored = redisMock.get(key)
      expect(stored).toBeDefined()

      const record = JSON.parse(stored!)
      expect(record.lastRunSuccess).toBe(true)
      expect(record.lastRunDurationMs).toBe(1234)
      expect(record.runCount).toBe(1)
      expect(record.lastRunAt).toBeDefined()
    })

    it('records a failed job run with error message', async () => {
      await recordJobRun('billing', 500, false, 'Connection timeout')

      const key = 'job_health:billing'
      const stored = redisMock.get(key)
      const record = JSON.parse(stored!)

      expect(record.lastRunSuccess).toBe(false)
      expect(record.lastRunError).toBe('Connection timeout')
    })

    it('increments run count on subsequent runs', async () => {
      await recordJobRun('billing', 100, true)
      await recordJobRun('billing', 200, true)
      await recordJobRun('billing', 300, true)

      const key = 'job_health:billing'
      const stored = redisMock.get(key)
      const record = JSON.parse(stored!)

      expect(record.runCount).toBe(3)
      expect(record.lastRunDurationMs).toBe(300) // Last run
    })
  })

  describe('getJobsHealth', () => {
    it('returns healthy status when all jobs have run recently', async () => {
      // Record recent runs for critical jobs
      await recordJobRun('billing', 100, true)
      await recordJobRun('retries', 50, true)

      const health = await getJobsHealth()

      // Find billing job in the list
      const billingJob = health.jobs.find(j => j.name === 'billing')
      expect(billingJob).toBeDefined()
      expect(billingJob!.isStale).toBe(false)
      expect(billingJob!.lastRunSuccess).toBe(true)
    })

    it('returns degraded status when non-critical jobs are stale', async () => {
      // Only run critical jobs, leave others stale
      await recordJobRun('billing', 100, true)
      await recordJobRun('retries', 50, true)

      const health = await getJobsHealth()

      // Non-critical jobs like 'transfers' should be marked stale (never run)
      const transfersJob = health.jobs.find(j => j.name === 'transfers')
      expect(transfersJob).toBeDefined()
      expect(transfersJob!.isStale).toBe(true)

      // Overall status should be degraded (not critical since billing/retries ran)
      expect(health.status).toBe('degraded')
      expect(health.staleJobs.length).toBeGreaterThan(0)
    })

    it('returns critical status when billing job is stale', async () => {
      // Don't record any billing runs - it will be marked as never run (stale)
      await recordJobRun('transfers', 100, true)

      const health = await getJobsHealth()

      // Billing is critical and never ran
      expect(health.status).toBe('critical')
      expect(health.staleJobs).toContain('billing')
    })

    it('returns critical status when billing job failed', async () => {
      await recordJobRun('billing', 100, false, 'Database connection failed')
      await recordJobRun('retries', 50, true)

      const health = await getJobsHealth()

      expect(health.status).toBe('critical')
      expect(health.failedJobs).toContain('billing')
    })

    it('includes all tracked jobs in response', async () => {
      const health = await getJobsHealth()

      // Should have entries for all jobs in JOB_SCHEDULES
      const trackedJobNames = Object.keys(JOB_SCHEDULES)
      expect(health.jobs.length).toBe(trackedJobNames.length)

      for (const name of trackedJobNames) {
        const job = health.jobs.find(j => j.name === name)
        expect(job).toBeDefined()
        expect(job!.description).toBe(JOB_SCHEDULES[name].description)
        expect(job!.expectedIntervalMinutes).toBe(
          Math.round(JOB_SCHEDULES[name].intervalSeconds / 60)
        )
      }
    })

    it('calculates staleSinceMinutes correctly', async () => {
      // Record a job run, then simulate time passing
      const oldDate = new Date()
      oldDate.setHours(oldDate.getHours() - 50) // 50 hours ago

      const key = 'job_health:billing'
      redisMock.set(key, JSON.stringify({
        lastRunAt: oldDate.toISOString(),
        lastRunDurationMs: 100,
        lastRunSuccess: true,
        runCount: 1,
      }))

      const health = await getJobsHealth()
      const billingJob = health.jobs.find(j => j.name === 'billing')

      // Billing interval is 24h, stale after 48h
      // 50 hours ago means stale for ~2 hours
      expect(billingJob!.isStale).toBe(true)
      expect(billingJob!.staleSinceMinutes).toBeGreaterThan(0)
    })
  })

  describe('JOB_SCHEDULES', () => {
    it('has expected intervals for critical jobs', () => {
      // Billing should run daily (24h)
      expect(JOB_SCHEDULES.billing.intervalSeconds).toBe(24 * 60 * 60)

      // Retries should run every 6 hours (matches vercel.json cron)
      expect(JOB_SCHEDULES.retries.intervalSeconds).toBe(6 * 60 * 60)

      // Balance sync should run every 30 minutes
      expect(JOB_SCHEDULES['sync-balances'].intervalSeconds).toBe(30 * 60)
    })

    it('has descriptions for all jobs', () => {
      for (const [name, config] of Object.entries(JOB_SCHEDULES)) {
        expect(config.description).toBeDefined()
        expect(config.description.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Alert Deduplication', () => {
    it('does not alert when healthy', async () => {
      const shouldAlert = await shouldSendAlert('healthy')
      expect(shouldAlert).toBe(false)
    })

    it('alerts on first degraded status (no previous alert)', async () => {
      const shouldAlert = await shouldSendAlert('degraded')
      expect(shouldAlert).toBe(true)
    })

    it('alerts on first critical status (no previous alert)', async () => {
      const shouldAlert = await shouldSendAlert('critical')
      expect(shouldAlert).toBe(true)
    })

    it('alerts on healthy->degraded transition', async () => {
      // Record a previous healthy state (though we don't alert on healthy)
      await recordAlertSent('healthy')

      const shouldAlert = await shouldSendAlert('degraded')
      expect(shouldAlert).toBe(true)
    })

    it('alerts on degraded->critical transition', async () => {
      await recordAlertSent('degraded')

      const shouldAlert = await shouldSendAlert('critical')
      expect(shouldAlert).toBe(true)
    })

    it('alerts on critical->degraded transition (improvement)', async () => {
      await recordAlertSent('critical')

      const shouldAlert = await shouldSendAlert('degraded')
      expect(shouldAlert).toBe(true)
    })

    it('does not send duplicate alerts within cooldown (1 hour)', async () => {
      // Record an alert that was just sent
      await recordAlertSent('degraded')

      // Should not alert again immediately
      const shouldAlert = await shouldSendAlert('degraded')
      expect(shouldAlert).toBe(false)
    })

    it('sends repeat alert after cooldown expires', async () => {
      // Simulate an alert sent 2 hours ago
      const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000)
      redisMock.set('job_health:alert_state', JSON.stringify({
        status: 'degraded',
        timestamp: twoHoursAgo,
      }))

      const shouldAlert = await shouldSendAlert('degraded')
      expect(shouldAlert).toBe(true)
    })

    it('clears alert state', async () => {
      await recordAlertSent('critical')
      expect(redisMock.get('job_health:alert_state')).toBeDefined()

      await clearAlertState()
      expect(redisMock.get('job_health:alert_state')).toBeNull()
    })

    it('alerts again after recovering to healthy and degrading again', async () => {
      // First degradation
      await recordAlertSent('degraded')

      // Recovery
      await clearAlertState()

      // Should alert on new degradation
      const shouldAlert = await shouldSendAlert('degraded')
      expect(shouldAlert).toBe(true)
    })
  })
})
