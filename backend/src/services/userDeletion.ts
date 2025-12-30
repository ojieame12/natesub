/**
 * User Deletion Service
 *
 * Handles the complete user deletion process including:
 * - Platform subscription cancellation
 * - Stripe subscription cancellation (creator & subscriber)
 * - Paystack subscription neutralization (creator & subscriber)
 * - Activity logging
 * - User anonymization
 * - Session cleanup
 * - Profile deletion
 */

import { db } from '../db/client.js'
import { stripe } from './stripe.js'
import { deactivateAuthorizationsBatch } from './paystack.js'

/**
 * Result of subscription cancellation operations
 */
interface CancellationCounts {
  platform: number
  stripeCreator: number
  stripeSubscriber: number
  paystackCreator: number
  paystackSubscriber: number
  stripeAccountDeleted: boolean
  [key: string]: number | boolean // Index signature for JSON compatibility
}

/**
 * Error that occurred during deletion
 */
interface DeletionError {
  operation: string
  message: string
  critical: boolean
  [key: string]: string | boolean // Index signature for JSON compatibility
}

/**
 * Result of user deletion operation
 */
export interface UserDeletionResult {
  success: boolean
  canceledSubscriptions: CancellationCounts
  errors: DeletionError[]
}

/**
 * Admin context for audit logging
 */
interface AdminContext {
  adminUserId: string
  adminEmail: string
}

/**
 * Cancel the platform subscription (NatePay Pro)
 */
async function cancelPlatformSubscription(
  platformSubscriptionId: string | null | undefined,
  errors: DeletionError[]
): Promise<number> {
  if (!platformSubscriptionId) return 0

  try {
    await stripe.subscriptions.cancel(platformSubscriptionId)
    return 1
  } catch (err: any) {
    if (err.code !== 'resource_missing') {
      errors.push({
        operation: 'cancel_platform_subscription',
        message: err.message,
        critical: false,
      })
      console.error(`[userDeletion] Failed to cancel platform subscription:`, err.message)
    }
    return 0
  }
}

/**
 * Cancel Stripe subscriptions where user is creator or subscriber
 */
async function cancelStripeSubscriptions(
  userId: string,
  role: 'creator' | 'subscriber',
  errors: DeletionError[]
): Promise<number> {
  const whereClause = role === 'creator' ? { creatorId: userId } : { subscriberId: userId }

  const subs = await db.subscription.findMany({
    where: {
      ...whereClause,
      stripeSubscriptionId: { not: null },
      status: { in: ['active', 'past_due', 'pending'] },
    },
    select: { id: true, stripeSubscriptionId: true },
  })

  let canceled = 0
  for (const sub of subs) {
    if (sub.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(sub.stripeSubscriptionId)
        await db.subscription.update({
          where: { id: sub.id },
          data: { status: 'canceled', canceledAt: new Date() },
        })
        canceled++
      } catch (err: any) {
        if (err.code !== 'resource_missing') {
          errors.push({
            operation: `cancel_stripe_${role}_subscription`,
            message: `Subscription ${sub.id}: ${err.message}`,
            critical: false,
          })
          console.error(`[userDeletion] Failed to cancel ${role} subscription:`, err.message)
        }
      }
    }
  }
  return canceled
}

/**
 * Neutralize Paystack subscriptions where user is creator or subscriber
 * Revokes authorization codes and marks subscriptions as canceled
 */
async function cancelPaystackSubscriptions(
  userId: string,
  role: 'creator' | 'subscriber',
  errors: DeletionError[]
): Promise<number> {
  const whereClause = role === 'creator' ? { creatorId: userId } : { subscriberId: userId }

  // Fetch authorization codes before clearing them
  const subsToCancel = await db.subscription.findMany({
    where: {
      ...whereClause,
      paystackAuthorizationCode: { not: null },
      status: { in: ['active', 'past_due', 'pending'] },
    },
    select: { paystackAuthorizationCode: true },
  })

  const authCodes = subsToCancel
    .map((s) => s.paystackAuthorizationCode)
    .filter((code): code is string => code !== null)

  // Revoke authorizations with Paystack BEFORE clearing from DB
  if (authCodes.length > 0) {
    try {
      const revokeResult = await deactivateAuthorizationsBatch(authCodes)
      console.log(
        `[userDeletion] Revoked ${revokeResult.success}/${authCodes.length} Paystack ${role} authorizations for user ${userId}`
      )
    } catch (err: any) {
      errors.push({
        operation: `revoke_paystack_${role}_authorizations`,
        message: err.message,
        critical: false,
      })
      console.error(`[userDeletion] Failed to revoke Paystack ${role} authorizations:`, err.message)
    }
  }

  // Update subscriptions in DB
  const result = await db.subscription.updateMany({
    where: {
      ...whereClause,
      paystackAuthorizationCode: { not: null },
      status: { in: ['active', 'past_due', 'pending'] },
    },
    data: {
      status: 'canceled',
      cancelAtPeriodEnd: true,
      canceledAt: new Date(),
      paystackAuthorizationCode: null,
    },
  })

  return result.count
}

/**
 * Delete the Stripe Connected Account for a creator
 * This is permanent and cannot be undone
 */
async function deleteStripeConnectedAccount(
  userId: string,
  errors: DeletionError[]
): Promise<boolean> {
  // Get the profile with stripeAccountId
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { stripeAccountId: true },
  })

  if (!profile?.stripeAccountId) {
    return false // No Stripe account to delete
  }

  try {
    await stripe.accounts.del(profile.stripeAccountId)
    console.log(`[userDeletion] Deleted Stripe Connected Account ${profile.stripeAccountId} for user ${userId}`)
    return true
  } catch (err: any) {
    // resource_missing means already deleted, which is fine
    if (err.code === 'resource_missing') {
      console.log(`[userDeletion] Stripe account ${profile.stripeAccountId} already deleted`)
      return true
    }
    errors.push({
      operation: 'delete_stripe_connected_account',
      message: `Account ${profile.stripeAccountId}: ${err.message}`,
      critical: false, // Non-critical since user is still deleted from our DB
    })
    console.error(`[userDeletion] Failed to delete Stripe Connected Account:`, err.message)
    return false
  }
}

/**
 * Delete a user with full cleanup
 *
 * This orchestrates the complete deletion process:
 * 1. Cancel platform subscription
 * 2. Cancel Stripe subscriptions (creator & subscriber)
 * 3. Cancel Paystack subscriptions (creator & subscriber)
 * 4. Delete Stripe Connected Account
 * 5. Log admin activity
 * 6. Anonymize user email
 * 7. Delete sessions
 * 8. Delete profile
 */
export async function deleteUser(
  userId: string,
  adminContext: AdminContext,
  reason: string,
  originalEmail: string,
  platformSubscriptionId: string | null | undefined
): Promise<UserDeletionResult> {
  const errors: DeletionError[] = []
  const canceledCounts: CancellationCounts = {
    platform: 0,
    stripeCreator: 0,
    stripeSubscriber: 0,
    paystackCreator: 0,
    paystackSubscriber: 0,
    stripeAccountDeleted: false,
  }

  // 1. Cancel platform subscription
  canceledCounts.platform = await cancelPlatformSubscription(platformSubscriptionId, errors)

  // 2. Cancel Stripe subscriptions (creator)
  canceledCounts.stripeCreator = await cancelStripeSubscriptions(userId, 'creator', errors)

  // 3. Cancel Stripe subscriptions (subscriber)
  canceledCounts.stripeSubscriber = await cancelStripeSubscriptions(userId, 'subscriber', errors)

  // 4. Cancel Paystack subscriptions (creator)
  canceledCounts.paystackCreator = await cancelPaystackSubscriptions(userId, 'creator', errors)

  // 5. Cancel Paystack subscriptions (subscriber)
  canceledCounts.paystackSubscriber = await cancelPaystackSubscriptions(userId, 'subscriber', errors)

  // 6. Delete Stripe Connected Account (for creators)
  canceledCounts.stripeAccountDeleted = await deleteStripeConnectedAccount(userId, errors)

  // 7. Log admin activity
  await db.activity.create({
    data: {
      userId,
      type: 'admin_delete',
      payload: {
        reason,
        deletedBy: adminContext.adminUserId,
        adminId: adminContext.adminUserId,
        adminEmail: adminContext.adminEmail,
        originalEmail,
        deletedAt: new Date().toISOString(),
        canceledSubscriptions: canceledCounts,
        errors: errors.length > 0 ? errors : undefined,
      },
    },
  })

  // 8. Anonymize email
  const anonymizedEmail = `deleted_${userId}@deleted.natepay.co`
  await db.user.update({
    where: { id: userId },
    data: {
      deletedAt: new Date(),
      email: anonymizedEmail,
    },
  })

  // 9. Delete sessions (non-critical)
  try {
    await db.session.deleteMany({ where: { userId } })
  } catch (err: any) {
    errors.push({
      operation: 'delete_sessions',
      message: err.message,
      critical: false,
    })
  }

  // 10. Delete profile
  try {
    await db.profile.deleteMany({ where: { userId } })
  } catch (err: any) {
    errors.push({
      operation: 'delete_profile',
      message: err.message,
      critical: true, // Profile deletion failure is more significant
    })
  }

  return {
    success: true,
    canceledSubscriptions: canceledCounts,
    errors,
  }
}
