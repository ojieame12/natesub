/**
 * Cleanup Jobs
 *
 * Scheduled jobs to clean up expired data:
 * - Expired sessions (>7 days old)
 * - Used/expired magic link tokens
 * - Old page views (for storage management)
 */

import { Prisma } from '@prisma/client'
import { db } from '../db/client.js'

interface CleanupResult {
  deletedSessions: number
  deletedTokens: number
  deletedPageViews: number
  expiredRequests: number
  canceledPendingSubscriptions: number
  clearedAbandonedOnboarding: number
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
 * Clear abandoned onboarding state
 * Users who authenticated but never completed onboarding have server-side state
 * (onboardingStep, onboardingBranch, onboardingData) that persists indefinitely.
 * After 30 days, clear this state so they get a fresh start if they return.
 */
export async function clearAbandonedOnboarding(): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Find users with onboarding state whose account was created 30+ days ago
  // and have NOT created a profile (those who completed onboarding already had state cleared)
  const result = await db.user.updateMany({
    where: {
      onboardingStep: { not: null },
      profile: null, // No profile = never completed onboarding
      createdAt: { lt: thirtyDaysAgo },
    },
    data: {
      onboardingStep: null,
      onboardingBranch: null,
      onboardingData: Prisma.DbNull,
    },
  })

  if (result.count > 0) {
    console.log(`[cleanup] Cleared onboarding state for ${result.count} abandoned users`)
  }
  return result.count
}

/**
 * Cancel stale pending subscriptions
 * Subscriptions created with async payment methods (bank transfers, SEPA, etc.)
 * that stay in 'pending' status for more than 7 days are likely abandoned.
 * Mark them as canceled so they don't stay pending forever.
 */
export async function cleanupPendingSubscriptions(): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  // Find pending subscriptions older than 7 days
  const staleSubscriptions = await db.subscription.findMany({
    where: {
      status: 'pending',
      createdAt: { lt: sevenDaysAgo },
    },
    select: { id: true, creatorId: true },
  })

  if (staleSubscriptions.length === 0) return 0

  // Cancel them and create activity records
  const now = new Date()
  for (const sub of staleSubscriptions) {
    await db.subscription.update({
      where: { id: sub.id },
      data: {
        status: 'canceled',
        canceledAt: now,
      },
    })

    await db.activity.create({
      data: {
        userId: sub.creatorId,
        type: 'subscription_canceled',
        payload: {
          subscriptionId: sub.id,
          reason: 'pending_payment_timeout',
          autoCleanup: true,
        },
      },
    })
  }

  console.log(`[cleanup] Canceled ${staleSubscriptions.length} stale pending subscriptions`)
  return staleSubscriptions.length
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
  let canceledPendingSubscriptions = 0
  let clearedAbandonedOnboarding = 0

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

  try {
    canceledPendingSubscriptions = await cleanupPendingSubscriptions()
  } catch (error: any) {
    console.error('[cleanup] Failed to cleanup pending subscriptions:', error.message)
    errors.push(`Pending subscriptions: ${error.message}`)
  }

  try {
    clearedAbandonedOnboarding = await clearAbandonedOnboarding()
  } catch (error: any) {
    console.error('[cleanup] Failed to clear abandoned onboarding:', error.message)
    errors.push(`Abandoned onboarding: ${error.message}`)
  }

  const result = {
    deletedSessions,
    deletedTokens,
    deletedPageViews,
    expiredRequests,
    canceledPendingSubscriptions,
    clearedAbandonedOnboarding,
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
  cleanupPendingSubscriptions,
  clearAbandonedOnboarding,
  runCleanup,
}
