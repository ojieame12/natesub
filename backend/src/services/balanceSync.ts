/**
 * Balance Sync Service
 *
 * Syncs creator balance from Stripe Express accounts to cached fields on Profile.
 * This enables fast dashboard loads without hitting Stripe API on every request.
 */

import { getAccountBalance } from './stripe.js'
import { db } from '../db/client.js'

export interface BalanceResult {
  available: number
  pending: number
  currency: string
}

/**
 * Sync balance for a single creator from their payment provider
 *
 * @param userId - The creator's user ID
 * @returns The synced balance or null if sync failed/not applicable
 */
export async function syncCreatorBalance(userId: string): Promise<BalanceResult | null> {
  const profile = await db.profile.findUnique({
    where: { userId },
    select: {
      id: true,
      stripeAccountId: true,
      paymentProvider: true,
    },
  })

  if (!profile) {
    console.warn(`[balanceSync] No profile found for user ${userId}`)
    return null
  }

  // Stripe balance sync
  if (profile.paymentProvider === 'stripe' && profile.stripeAccountId) {
    try {
      const balance = await getAccountBalance(profile.stripeAccountId)

      await db.profile.update({
        where: { id: profile.id },
        data: {
          balanceAvailableCents: balance.available,
          balancePendingCents: balance.pending,
          balanceCurrency: balance.currency,
          balanceLastSyncedAt: new Date(),
        },
      })

      console.log(`[balanceSync] Synced balance for user ${userId}: ${balance.available} available, ${balance.pending} pending ${balance.currency}`)
      return balance
    } catch (err) {
      console.error(`[balanceSync] Failed to sync Stripe balance for user ${userId}:`, err)
      return null
    }
  }

  // Paystack: No real balance API - subaccount model means auto-settlement
  // We estimate pending as payments in last 24h that haven't settled
  if (profile.paymentProvider === 'paystack') {
    try {
      const pendingPayments = await db.payment.aggregate({
        where: {
          creatorId: userId,
          paystackEventId: { not: null },
          status: 'succeeded',
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        _sum: { netCents: true },
      })

      const pending = pendingPayments._sum.netCents || 0

      await db.profile.update({
        where: { id: profile.id },
        data: {
          balanceAvailableCents: 0, // Paystack settles directly to bank (T+1)
          balancePendingCents: pending,
          balanceCurrency: 'NGN', // Paystack is primarily NGN
          balanceLastSyncedAt: new Date(),
        },
      })

      console.log(`[balanceSync] Estimated Paystack balance for user ${userId}: ${pending} pending NGN`)
      return { available: 0, pending, currency: 'NGN' }
    } catch (err) {
      console.error(`[balanceSync] Failed to estimate Paystack balance for user ${userId}:`, err)
      return null
    }
  }

  // No payment provider configured
  return null
}

/**
 * Check if a creator's balance is stale and needs refresh
 *
 * @param balanceLastSyncedAt - The last sync timestamp
 * @param maxAgeMs - Maximum age in milliseconds (default: 5 minutes)
 * @returns true if balance is stale and should be refreshed
 */
export function isBalanceStale(
  balanceLastSyncedAt: Date | null | undefined,
  maxAgeMs = 5 * 60 * 1000 // 5 minutes
): boolean {
  if (!balanceLastSyncedAt) return true
  return Date.now() - balanceLastSyncedAt.getTime() > maxAgeMs
}

/**
 * Sync balances for all active creators
 * Used by periodic job as backup for webhook-driven sync
 *
 * @returns Stats on sync operation
 */
export async function syncAllActiveBalances(): Promise<{
  synced: number
  failed: number
  skipped: number
}> {
  const activeCreators = await db.profile.findMany({
    where: {
      payoutStatus: 'active',
      paymentProvider: { not: null },
    },
    select: { userId: true },
  })

  let synced = 0
  let failed = 0
  let skipped = 0

  for (const creator of activeCreators) {
    try {
      const result = await syncCreatorBalance(creator.userId)
      if (result) {
        synced++
      } else {
        skipped++
      }
    } catch {
      failed++
    }

    // Rate limit: 100ms between calls to respect Stripe rate limits
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  console.log(`[balanceSync] Batch complete: synced=${synced}, failed=${failed}, skipped=${skipped}`)
  return { synced, failed, skipped }
}
