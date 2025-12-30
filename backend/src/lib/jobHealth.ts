/**
 * Job Health Tracking
 *
 * Tracks last successful run times for scheduled jobs in Redis.
 * Provides staleness detection for alerting when jobs haven't run on schedule.
 */

import { redis } from '../db/redis.js'

const JOB_HEALTH_PREFIX = 'job_health:'

// Expected run intervals for each job (in seconds)
// If a job hasn't run in 2x this interval, it's considered stale
export const JOB_SCHEDULES: Record<string, { intervalSeconds: number; description: string }> = {
  'billing': { intervalSeconds: 24 * 60 * 60, description: 'Process recurring billing (daily)' },
  'retries': { intervalSeconds: 60 * 60, description: 'Process payment retries (hourly)' },
  'payroll': { intervalSeconds: 15 * 24 * 60 * 60, description: 'Generate payroll periods (1st/16th)' },
  'dunning': { intervalSeconds: 24 * 60 * 60, description: 'Send dunning emails (daily)' },
  'cancellations': { intervalSeconds: 24 * 60 * 60, description: 'Send cancellation notices (daily)' },
  'transfers': { intervalSeconds: 60 * 60, description: 'Monitor stuck transfers (hourly)' },
  'reconciliation': { intervalSeconds: 24 * 60 * 60, description: 'Reconcile Paystack transactions (nightly)' },
  'scheduled-reminders': { intervalSeconds: 60 * 60, description: 'Process scheduled reminders (hourly)' },
  'cleanup-auth': { intervalSeconds: 24 * 60 * 60, description: 'Clean expired sessions/OTPs (daily)' },
  'cleanup-pageviews': { intervalSeconds: 7 * 24 * 60 * 60, description: 'Clean old page views (weekly)' },
  'stats-aggregate': { intervalSeconds: 24 * 60 * 60, description: 'Aggregate daily stats (daily)' },
  'dispute-monitoring': { intervalSeconds: 24 * 60 * 60, description: 'Monitor dispute rates (daily)' },
  'sync-balances': { intervalSeconds: 30 * 60, description: 'Sync creator balances (every 30 min)' },
}

interface JobRunRecord {
  lastRunAt: string
  lastRunDurationMs: number
  lastRunSuccess: boolean
  lastRunError?: string
  runCount: number
}

/**
 * Record a successful job run
 */
export async function recordJobRun(
  jobName: string,
  durationMs: number,
  success: boolean = true,
  error?: string
): Promise<void> {
  const key = `${JOB_HEALTH_PREFIX}${jobName}`

  try {
    // Get existing record to increment run count
    const existing = await redis.get(key)
    const prev: Partial<JobRunRecord> = existing ? JSON.parse(existing) : {}

    const record: JobRunRecord = {
      lastRunAt: new Date().toISOString(),
      lastRunDurationMs: durationMs,
      lastRunSuccess: success,
      lastRunError: error,
      runCount: (prev.runCount || 0) + 1,
    }

    // Keep for 30 days
    await redis.setex(key, 30 * 24 * 60 * 60, JSON.stringify(record))
  } catch (err) {
    // Non-critical - just log
    console.warn(`[jobHealth] Failed to record run for ${jobName}:`, err)
  }
}

interface JobHealthStatus {
  name: string
  description: string
  lastRunAt: string | null
  lastRunDurationMs: number | null
  lastRunSuccess: boolean | null
  runCount: number
  isStale: boolean
  staleSinceMinutes: number | null
  expectedIntervalMinutes: number
}

/**
 * Get health status for all tracked jobs
 */
export async function getJobsHealth(): Promise<{
  status: 'healthy' | 'degraded' | 'critical'
  jobs: JobHealthStatus[]
  staleJobs: string[]
  failedJobs: string[]
}> {
  const jobs: JobHealthStatus[] = []
  const staleJobs: string[] = []
  const failedJobs: string[] = []

  for (const [name, schedule] of Object.entries(JOB_SCHEDULES)) {
    const key = `${JOB_HEALTH_PREFIX}${name}`

    try {
      const data = await redis.get(key)
      const record: Partial<JobRunRecord> = data ? JSON.parse(data) : {}

      let isStale = false
      let staleSinceMinutes: number | null = null

      if (record.lastRunAt) {
        const lastRun = new Date(record.lastRunAt)
        const now = new Date()
        const ageSeconds = (now.getTime() - lastRun.getTime()) / 1000

        // Stale if hasn't run in 2x expected interval
        const staleThreshold = schedule.intervalSeconds * 2
        isStale = ageSeconds > staleThreshold

        if (isStale) {
          staleSinceMinutes = Math.round((ageSeconds - staleThreshold) / 60)
          staleJobs.push(name)
        }

        if (record.lastRunSuccess === false) {
          failedJobs.push(name)
        }
      } else {
        // Never run - consider stale
        isStale = true
        staleJobs.push(name)
      }

      jobs.push({
        name,
        description: schedule.description,
        lastRunAt: record.lastRunAt || null,
        lastRunDurationMs: record.lastRunDurationMs || null,
        lastRunSuccess: record.lastRunSuccess ?? null,
        runCount: record.runCount || 0,
        isStale,
        staleSinceMinutes,
        expectedIntervalMinutes: Math.round(schedule.intervalSeconds / 60),
      })
    } catch (err) {
      // Redis error - mark as unknown
      jobs.push({
        name,
        description: schedule.description,
        lastRunAt: null,
        lastRunDurationMs: null,
        lastRunSuccess: null,
        runCount: 0,
        isStale: true,
        staleSinceMinutes: null,
        expectedIntervalMinutes: Math.round(schedule.intervalSeconds / 60),
      })
      staleJobs.push(name)
    }
  }

  // Determine overall status
  let status: 'healthy' | 'degraded' | 'critical' = 'healthy'

  // Critical if billing or webhooks are stale/failed
  const criticalJobs = ['billing', 'retries']
  if (criticalJobs.some(j => staleJobs.includes(j) || failedJobs.includes(j))) {
    status = 'critical'
  } else if (staleJobs.length > 0 || failedJobs.length > 0) {
    status = 'degraded'
  }

  return {
    status,
    jobs,
    staleJobs,
    failedJobs,
  }
}

// ============================================
// ALERT DEDUPLICATION
// ============================================

const ALERT_STATE_KEY = 'job_health:alert_state'
const ALERT_COOLDOWN_MS = 60 * 60 * 1000 // 1 hour - don't spam alerts

interface AlertState {
  status: string
  timestamp: number
}

/**
 * Check if we should send an alert based on state transitions and cooldown
 *
 * - Always alert on state transitions (healthy→degraded, degraded→critical, etc.)
 * - Repeat alerts after 1 hour cooldown if still unhealthy
 * - Never alert if healthy
 */
export async function shouldSendAlert(currentStatus: string): Promise<boolean> {
  // Never alert if healthy
  if (currentStatus === 'healthy') return false

  try {
    const lastAlert = await redis.get(ALERT_STATE_KEY)

    // No previous alert - send alert
    if (!lastAlert) return true

    const state: AlertState = JSON.parse(lastAlert)
    const elapsed = Date.now() - state.timestamp

    // Status changed - alert on transition
    if (state.status !== currentStatus) return true

    // Same status but cooldown expired - send reminder
    if (elapsed > ALERT_COOLDOWN_MS) return true

    // Same status, within cooldown - don't spam
    return false
  } catch (err) {
    // Redis error - err on side of alerting
    console.warn('[jobHealth] Error checking alert state:', err)
    return true
  }
}

/**
 * Record that an alert was sent
 */
export async function recordAlertSent(status: string): Promise<void> {
  try {
    const state: AlertState = {
      status,
      timestamp: Date.now(),
    }

    // Keep state for 24 hours
    await redis.setex(ALERT_STATE_KEY, 24 * 60 * 60, JSON.stringify(state))
  } catch (err) {
    console.warn('[jobHealth] Failed to record alert state:', err)
  }
}

/**
 * Clear alert state (call when health returns to normal)
 */
export async function clearAlertState(): Promise<void> {
  try {
    await redis.del(ALERT_STATE_KEY)
  } catch (err) {
    console.warn('[jobHealth] Failed to clear alert state:', err)
  }
}
