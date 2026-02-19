/**
 * Balance Sync Service
 *
 * Syncs creator balance from Stripe Express accounts to cached fields on Profile.
 * This enables fast dashboard loads without hitting Stripe API on every request.
 *
 * Rate limiting: Uses Redis locks to prevent concurrent syncs and cooldowns to
 * avoid spamming payment provider APIs.
 */

import { getAccountBalance } from './stripe.js'
import { db } from '../db/client.js'
import { redis } from '../db/redis.js'

// Lock TTL: max time a sync can hold the lock (prevents deadlocks)
const SYNC_LOCK_TTL_SECONDS = 30

// Cooldown: minimum time between syncs for the same user
const SYNC_COOLDOWN_SECONDS = 60

/**
 * Try to acquire a sync lock for a user
 * Returns true if lock acquired, false if already locked or in cooldown
 */
async function tryAcquireSyncLock(userId: string): Promise<boolean> {
  const lockKey = `balance-sync-lock:${userId}`
  const cooldownKey = `balance-sync-cooldown:${userId}`

  // Check cooldown first
  const inCooldown = await redis.get(cooldownKey)
  if (inCooldown) {
    return false
  }

  // Try to acquire lock (NX = only set if not exists)
  const acquired = await redis.set(lockKey, '1', 'EX', SYNC_LOCK_TTL_SECONDS, 'NX')
  return acquired === 'OK'
}

/**
 * Release sync lock and set cooldown
 */
async function releaseSyncLock(userId: string): Promise<void> {
  const lockKey = `balance-sync-lock:${userId}`
  const cooldownKey = `balance-sync-cooldown:${userId}`

  await redis.del(lockKey)
  await redis.setex(cooldownKey, SYNC_COOLDOWN_SECONDS, '1')
}

export interface BalanceResult {
  available: number
  pending: number
  currency: string
}

/**
 * Valid payout status values for lastPayoutStatus field.
 * Using const assertion for type safety without requiring Prisma enum migration.
 */
export const PAYOUT_STATUS = {
  PENDING: 'pending',      // Payout initiated, awaiting arrival
  IN_TRANSIT: 'in_transit', // En route to bank
  PAID: 'paid',            // Successfully deposited
  FAILED: 'failed',        // Failed (bank rejection, etc.)
  CANCELED: 'canceled',    // Canceled before arrival
} as const

export type PayoutStatus = typeof PAYOUT_STATUS[keyof typeof PAYOUT_STATUS]

/**
 * Validate and normalize a payout status string
 */
export function normalizePayoutStatus(status: string | null | undefined): PayoutStatus | null {
  if (!status) return null
  const normalized = status.toLowerCase()
  const validStatuses = Object.values(PAYOUT_STATUS)
  return validStatuses.includes(normalized as PayoutStatus) ? normalized as PayoutStatus : null
}

/**
 * Sync balance for a single creator from their payment provider
 * Uses Redis lock to prevent concurrent syncs and cooldown to avoid rate limits.
 *
 * @param userId - The creator's user ID
 * @param force - Skip lock/cooldown (for webhook-driven syncs)
 * @returns The synced balance or null if sync failed/not applicable/skipped
 */
export async function syncCreatorBalance(userId: string, force = false): Promise<BalanceResult | null> {
  // Acquire lock (unless forced by webhook)
  if (!force) {
    const acquired = await tryAcquireSyncLock(userId)
    if (!acquired) {
      // Already syncing or in cooldown - skip silently
      return null
    }
  }

  try {
    const profile = await db.profile.findUnique({
      where: { userId },
      select: {
        id: true,
        stripeAccountId: true,
        paymentProvider: true,
        currency: true, // Profile's configured currency
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
    // Settlement windows vary by country: NG (T+1), GH (T+1), KE (T+2), ZA (T+2)
    if (profile.paymentProvider === 'paystack') {
      try {
        // Use profile currency (NGN, GHS, KES, ZAR) instead of hardcoding
        const currency = profile.currency || 'NGN'

        // Settlement window varies by country - use 48h to be safe for all regions
        const settlementWindowMs = 48 * 60 * 60 * 1000

        const pendingPayments = await db.payment.aggregate({
          where: {
            creatorId: userId,
            paystackEventId: { not: null },
            status: 'succeeded',
            currency, // Only sum payments in profile currency
            createdAt: { gte: new Date(Date.now() - settlementWindowMs) },
          },
          _sum: { netCents: true },
        })

        const pending = pendingPayments._sum.netCents || 0

        await db.profile.update({
          where: { id: profile.id },
          data: {
            balanceAvailableCents: 0, // Paystack settles directly to bank
            balancePendingCents: pending,
            balanceCurrency: currency,
            balanceLastSyncedAt: new Date(),
          },
        })

        console.log(`[balanceSync] Estimated Paystack balance for user ${userId}: ${pending} pending ${currency}`)
        return { available: 0, pending, currency }
      } catch (err) {
        console.error(`[balanceSync] Failed to estimate Paystack balance for user ${userId}:`, err)
        return null
      }
    }

    // No payment provider configured
    return null
  } finally {
    // Always release lock (unless forced)
    if (!force) {
      await releaseSyncLock(userId)
    }
  }
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

// Batch size for concurrent processing (conservative for Stripe rate limits)
const SYNC_BATCH_SIZE = 5

// Maximum creators to process in a single run (prevents runaway jobs)
const MAX_CREATORS_PER_RUN = 500

/**
 * Sync balances for all active creators
 * Used by periodic job as backup for webhook-driven sync
 *
 * Processes creators in batches of SYNC_BATCH_SIZE concurrently,
 * with a 100ms delay between batches to respect Stripe rate limits.
 *
 * @returns Stats on sync operation
 */
export async function syncAllActiveBalances(): Promise<{
  synced: number
  failed: number
  skipped: number
  total: number
  capped: boolean
}> {
  const activeCreators = await db.profile.findMany({
    where: {
      payoutStatus: 'active',
      paymentProvider: { not: null },
    },
    select: { userId: true },
    orderBy: { userId: 'asc' },
    take: MAX_CREATORS_PER_RUN,
  })

  const capped = activeCreators.length === MAX_CREATORS_PER_RUN

  let synced = 0
  let failed = 0
  let skipped = 0

  // Process in batches of SYNC_BATCH_SIZE
  for (let i = 0; i < activeCreators.length; i += SYNC_BATCH_SIZE) {
    const batch = activeCreators.slice(i, i + SYNC_BATCH_SIZE)

    const results = await Promise.allSettled(
      batch.map(creator => syncCreatorBalance(creator.userId))
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value) {
          synced++
        } else {
          skipped++
        }
      } else {
        failed++
      }
    }

    // Rate limit: 100ms between batches to respect Stripe rate limits
    if (i + SYNC_BATCH_SIZE < activeCreators.length) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  console.log(`[balanceSync] Batch complete: synced=${synced}, failed=${failed}, skipped=${skipped}, total=${activeCreators.length}, capped=${capped}`)
  return { synced, failed, skipped, total: activeCreators.length, capped }
}
