/**
 * Cleanup Jobs
 *
 * Scheduled jobs to clean up expired data:
 * - Expired sessions (>7 days old)
 * - Used/expired magic link tokens
 * - Old page views (for storage management)
 */

import { db } from '../db/client.js'

interface CleanupResult {
  deletedSessions: number
  deletedTokens: number
  deletedPageViews: number
  expiredRequests: number
  errors: string[]
}

/**
 * Clean up expired sessions
 * Sessions expire after 7 days
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const result = await db.session.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  })

  console.log(`[cleanup] Deleted ${result.count} expired sessions`)
  return result.count
}

/**
 * Clean up used and expired magic link tokens
 * Keep used tokens for 24 hours for audit, then delete
 */
export async function cleanupExpiredMagicLinks(): Promise<number> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const result = await db.magicLinkToken.deleteMany({
    where: {
      OR: [
        // Expired tokens
        { expiresAt: { lt: new Date() } },
        // Used tokens older than 24 hours
        {
          AND: [
            { usedAt: { not: null } },
            { usedAt: { lt: oneDayAgo } },
          ],
        },
      ],
    },
  })

  console.log(`[cleanup] Deleted ${result.count} expired/used magic link tokens`)
  return result.count
}

/**
 * Clean up old page views (optional - for storage management)
 * Only delete page views older than 90 days
 */
export async function cleanupOldPageViews(): Promise<number> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

  const result = await db.pageView.deleteMany({
    where: {
      createdAt: { lt: ninetyDaysAgo },
    },
  })

  console.log(`[cleanup] Deleted ${result.count} old page views`)
  return result.count
}

/**
 * Mark expired requests as expired
 * Requests with tokenExpiresAt in the past and still in 'sent' or 'pending_payment' status
 * should be marked as 'expired' so creator dashboard shows accurate state
 */
export async function expireRequests(): Promise<number> {
  const result = await db.request.updateMany({
    where: {
      tokenExpiresAt: { lt: new Date() },
      status: { in: ['sent', 'pending_payment'] },
    },
    data: {
      status: 'expired',
    },
  })

  if (result.count > 0) {
    console.log(`[cleanup] Marked ${result.count} requests as expired`)
  }
  return result.count
}

/**
 * Run all cleanup jobs
 * Should be scheduled to run daily
 */
export async function runCleanup(): Promise<CleanupResult> {
  const errors: string[] = []
  let deletedSessions = 0
  let deletedTokens = 0
  let deletedPageViews = 0
  let expiredRequests = 0

  try {
    deletedSessions = await cleanupExpiredSessions()
  } catch (error: any) {
    console.error('[cleanup] Failed to cleanup sessions:', error.message)
    errors.push(`Sessions: ${error.message}`)
  }

  try {
    deletedTokens = await cleanupExpiredMagicLinks()
  } catch (error: any) {
    console.error('[cleanup] Failed to cleanup magic links:', error.message)
    errors.push(`Magic links: ${error.message}`)
  }

  try {
    deletedPageViews = await cleanupOldPageViews()
  } catch (error: any) {
    console.error('[cleanup] Failed to cleanup page views:', error.message)
    errors.push(`Page views: ${error.message}`)
  }

  try {
    expiredRequests = await expireRequests()
  } catch (error: any) {
    console.error('[cleanup] Failed to expire requests:', error.message)
    errors.push(`Requests: ${error.message}`)
  }

  const result = {
    deletedSessions,
    deletedTokens,
    deletedPageViews,
    expiredRequests,
    errors,
  }

  console.log('[cleanup] Complete:', JSON.stringify(result))

  return result
}

export default {
  cleanupExpiredSessions,
  cleanupExpiredMagicLinks,
  cleanupOldPageViews,
  expireRequests,
  runCleanup,
}
