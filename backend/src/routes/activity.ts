import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { centsToDisplayAmount } from '../utils/currency.js'
import { isStripeCrossBorderSupported } from '../utils/constants.js'
import { getUSDRate, convertLocalCentsToUSD, convertUSDCentsToLocal } from '../services/fx.js'
import { syncCreatorBalance, isBalanceStale } from '../services/balanceSync.js'
import { getChargeFxData } from '../services/stripe.js'

/**
 * Add business days to a date (skipping weekends)
 * Used for estimating payout arrival dates
 */
function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date)
  let added = 0
  while (added < days) {
    result.setDate(result.getDate() + 1)
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (result.getDay() !== 0 && result.getDay() !== 6) {
      added++
    }
  }
  return result
}

const activity = new Hono()

// Get activity feed (with pagination, max 100 per page)
activity.get(
  '/',
  requireAuth,
  zValidator('query', z.object({
    limit: z.string().optional().transform(v => Math.min(parseInt(v || '20') || 20, 100)),
    cursor: z.string().optional(),
  })),
  async (c) => {
    const userId = c.get('userId')
    const { limit, cursor } = c.req.valid('query')

    const activities = await db.activity.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // Get one extra to check if there's more
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    const hasMore = activities.length > limit
    if (hasMore) activities.pop()

    return c.json({
      activities: activities.map(a => ({
        id: a.id,
        type: a.type,
        payload: a.payload,
        createdAt: a.createdAt,
      })),
      nextCursor: hasMore ? activities[activities.length - 1]?.id : null,
    })
  }
)

// Get dashboard metrics (must be before /:id to avoid route conflict)
// Optimized to use DB aggregates instead of loading all subscriptions into memory
activity.get('/metrics', requireAuth, async (c) => {
  const userId = c.get('userId')

  // Run all queries in parallel for efficiency
  const [
    profile,
    subscriberCount,
    mrrResult,
    grossRevenueResult,
    refundsResult,
    chargebacksResult,
    tierBreakdown,
  ] = await Promise.all([
    // Profile for currency and cached balance
    db.profile.findUnique({
      where: { userId },
      select: {
        currency: true,
        stripeAccountId: true,
        paymentProvider: true,
        balanceAvailableCents: true,
        balancePendingCents: true,
        balanceCurrency: true,
        balanceLastSyncedAt: true,
      },
    }),

    // Count active subscribers
    db.subscription.count({
      where: {
        creatorId: userId,
        status: 'active',
      },
    }),

    // Calculate MRR using DB aggregate, grouped by currency
    db.subscription.groupBy({
      by: ['currency'],
      where: {
        creatorId: userId,
        status: 'active',
        interval: 'month',
      },
      _sum: { amount: true },
    }),

    // Get gross revenue (succeeded payments), grouped by currency
    db.payment.groupBy({
      by: ['currency'],
      where: {
        creatorId: userId,
        status: 'succeeded',
      },
      _sum: { netCents: true },
    }),

    // Get refunded amounts to subtract (net revenue = gross - refunds - chargebacks)
    db.payment.groupBy({
      by: ['currency'],
      where: {
        creatorId: userId,
        status: 'refunded',
      },
      _sum: { netCents: true },
    }),

    // Get chargeback/dispute losses to subtract
    db.payment.groupBy({
      by: ['currency'],
      where: {
        creatorId: userId,
        status: 'dispute_lost',
      },
      _sum: { netCents: true },
    }),

    // Tier breakdown using groupBy
    db.subscription.groupBy({
      by: ['tierName'],
      where: {
        creatorId: userId,
        status: 'active',
      },
      _count: true,
    }),
  ])

  // Convert tier breakdown to record format
  const tierBreakdownRecord: Record<string, number> = {}
  for (const tier of tierBreakdown) {
    const tierName = tier.tierName || 'Default'
    tierBreakdownRecord[tierName] = tier._count
  }

  const profileCurrency = profile?.currency || 'USD'

  // Helper to normalize cents from any currency to Profile Currency
  // 1. Convert Local -> USD
  // 2. Convert USD -> Profile Currency
  // Note: FX rates for NGN/KES/etc are "USD to Local".
  const normalizeToProfile = async (groups: { currency: string, _sum: any }[], field: string) => {
    let totalUsdCents = 0

    // First pass: Convert everything to USD common base
    for (const group of groups) {
      const currency = group.currency
      const amount = group._sum[field] || 0

      if (amount === 0) continue

      if (currency === 'USD') {
        totalUsdCents += amount
      } else {
        // Fetch rate (e.g., 1 USD = 1600 NGN)
        const rate = await getUSDRate(currency)
        // Convert NGN cents -> USD cents
        totalUsdCents += convertLocalCentsToUSD(amount, rate)
      }
    }

    // Second pass: Convert Total USD -> Profile Currency
    if (profileCurrency === 'USD') {
      return totalUsdCents
    } else {
      const rate = await getUSDRate(profileCurrency)
      return convertUSDCentsToLocal(totalUsdCents, rate)
    }
  }

  // Calculate normalized totals
  const mrrCents = await normalizeToProfile(mrrResult, 'amount')

  // Net revenue = gross - refunds - chargebacks
  const grossCents = await normalizeToProfile(grossRevenueResult, 'netCents')
  const refundsCents = await normalizeToProfile(refundsResult, 'netCents')
  const chargebacksCents = await normalizeToProfile(chargebacksResult, 'netCents')
  const totalRevenueCents = Math.max(0, grossCents - refundsCents - chargebacksCents)

  // If balance is stale (>5 min), trigger background refresh
  if (profile?.stripeAccountId && isBalanceStale(profile.balanceLastSyncedAt)) {
    syncCreatorBalance(userId).catch(() => {}) // Fire-and-forget
  }

  // Get FX rate if balance currency differs from profile currency
  const balanceCurrency = profile?.balanceCurrency || profileCurrency
  let fxRate: number | null = null
  if (balanceCurrency !== profileCurrency) {
    // Get rate: 1 USD = X local
    // We need profile→balance conversion for display toggle
    const profileToUsdRate = profileCurrency === 'USD' ? 1 : await getUSDRate(profileCurrency)
    const balanceToUsdRate = balanceCurrency === 'USD' ? 1 : await getUSDRate(balanceCurrency)
    // fxRate: 1 profile currency = X balance currency
    fxRate = balanceToUsdRate / profileToUsdRate
  }

  return c.json({
    metrics: {
      subscriberCount,
      mrrCents,
      mrr: centsToDisplayAmount(mrrCents, profileCurrency),
      totalRevenueCents,
      totalRevenue: centsToDisplayAmount(totalRevenueCents, profileCurrency),
      currency: profileCurrency,
      tierBreakdown: tierBreakdownRecord,
      // Balance breakdown (from cached Stripe balance)
      balance: {
        available: profile?.balanceAvailableCents || 0,
        pending: profile?.balancePendingCents || 0,
        currency: balanceCurrency,
        lastSyncedAt: profile?.balanceLastSyncedAt || null,
      },
      // FX rate for currency toggle: 1 profileCurrency = fxRate balanceCurrency
      fxRate,
    },
  })
})

// Force-refresh balance from Stripe
activity.post('/balance/refresh', requireAuth, async (c) => {
  const userId = c.get('userId')

  const balance = await syncCreatorBalance(userId)
  if (!balance) {
    return c.json({ error: 'Failed to sync balance or no payment provider configured' }, 400)
  }

  return c.json({ balance })
})

// Get payout history - all payouts for the creator
// Returns payouts from Payment model (type='payout') + payout activities
activity.get('/payouts', requireAuth, async (c) => {
  const userId = c.get('userId')

  // Get payout records from Payment model (created by payout.paid webhook)
  const [payoutPayments, payoutActivities, profile] = await Promise.all([
    db.payment.findMany({
      where: {
        creatorId: userId,
        type: 'payout',
      },
      orderBy: { occurredAt: 'desc' },
      take: 50,
      select: {
        id: true,
        amountCents: true,
        currency: true,
        status: true,
        occurredAt: true,
        stripePaymentIntentId: true, // This stores payout ID
        createdAt: true,
      },
    }),

    // Also get payout activities for more details (initiated, failed)
    db.activity.findMany({
      where: {
        userId,
        type: { in: ['payout_initiated', 'payout_completed', 'payout_failed'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),

    // Profile for account health
    db.profile.findUnique({
      where: { userId },
      select: {
        paymentProvider: true,
        payoutStatus: true,
        lastPayoutStatus: true,
        lastPayoutAmountCents: true,
        lastPayoutAt: true,
        balanceAvailableCents: true,
        balancePendingCents: true,
        balanceCurrency: true,
        stripeAccountId: true,
      },
    }),
  ])

  // Build payout history with enriched data
  const payoutMap = new Map<string, any>()

  // Add completed payouts from Payment records
  for (const p of payoutPayments) {
    const payoutId = p.stripePaymentIntentId || p.id
    payoutMap.set(payoutId, {
      id: payoutId,
      amount: p.amountCents,
      currency: p.currency,
      status: 'paid',
      initiatedAt: p.createdAt,
      arrivedAt: p.occurredAt,
    })
  }

  // Enrich with activity data (for initiated/failed that may not have Payment records)
  for (const a of payoutActivities) {
    const payload = a.payload as any
    const payoutId = payload?.payoutId || a.id

    if (!payoutMap.has(payoutId)) {
      payoutMap.set(payoutId, {
        id: payoutId,
        amount: payload?.amount,
        currency: payload?.currency?.toUpperCase(),
        status: a.type === 'payout_failed' ? 'failed'
          : a.type === 'payout_completed' ? 'paid'
          : 'pending',
        initiatedAt: a.createdAt,
        arrivedAt: payload?.arrivalDate || null,
        failureReason: payload?.failureMessage || null,
      })
    } else if (a.type === 'payout_initiated') {
      // Add initiated timestamp to existing record
      const existing = payoutMap.get(payoutId)
      existing.initiatedAt = a.createdAt
    }
  }

  // Sort by most recent first
  const payouts = Array.from(payoutMap.values())
    .sort((a, b) => new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime())

  // Account health summary
  const accountHealth = {
    payoutStatus: profile?.payoutStatus || 'pending',
    provider: profile?.paymentProvider || null,
    hasStripeAccount: !!profile?.stripeAccountId,
    lastPayout: profile?.lastPayoutAt ? {
      amount: profile.lastPayoutAmountCents,
      date: profile.lastPayoutAt,
      status: profile.lastPayoutStatus,
    } : null,
    currentBalance: {
      available: profile?.balanceAvailableCents || 0,
      pending: profile?.balancePendingCents || 0,
      currency: profile?.balanceCurrency || 'USD',
    },
  }

  return c.json({
    payouts,
    accountHealth,
  })
})

// Get single activity (must be after /metrics to avoid route conflict)
// Enriches payment activities with payout status and FX data
activity.get(
  '/:id',
  requireAuth,
  zValidator('param', z.object({ id: z.string().uuid() })),
  async (c) => {
    const userId = c.get('userId')
    const { id } = c.req.valid('param')

    const act = await db.activity.findFirst({
      where: { id, userId },
    })

    if (!act) {
      return c.json({ error: 'Activity not found' }, 404)
    }

    // For payment activities, enrich with payout status and FX data
    const paymentActivityTypes = ['payment_received', 'payment', 'renewal', 'subscription_created', 'new_subscriber', 'request_accepted']
    let payoutInfo = null
    let fxData = null
    let fxPending = false

    if (paymentActivityTypes.includes(act.type)) {
      const payload = act.payload as any

      // Fetch profile for payout context and FX backfill
      const profile = await db.profile.findUnique({
        where: { userId },
        select: {
          lastPayoutAt: true,
          paymentProvider: true,
          stripeAccountId: true, // For FX backfill
          currency: true, // For cross-border detection
          countryCode: true, // For cross-border detection (NG/GH/KE)
        },
      })

      // Fetch the specific payment for this activity
      // Use paymentId if available (new activities), fall back to subscriptionId (legacy)
      const paymentQuery = payload?.paymentId
        ? { id: payload.paymentId }
        : payload?.subscriptionId
          ? { subscriptionId: payload.subscriptionId, creatorId: userId, status: 'succeeded' as const }
          : null

      if (paymentQuery) {
        const payment = await db.payment.findFirst({
          where: paymentQuery,
          orderBy: payload?.paymentId ? undefined : { createdAt: 'desc' }, // Only order if using subscriptionId fallback
          select: {
            id: true,           // For backfill update
            payoutCurrency: true,
            payoutAmountCents: true,
            exchangeRate: true,
            fxCheckedAt: true,  // Sentinel to avoid repeated Stripe calls
            currency: true,
            amountCents: true,  // Legacy field for amount paid
            grossCents: true,   // What subscriber paid (for FX display)
            netCents: true,     // What creator receives
            occurredAt: true,
            stripeChargeId: true, // For on-demand FX backfill
          },
        })

        if (payment) {
          // Determine payout status for this payment
          // Priority: Real status from webhooks > Estimation based on timing
          const paymentDate = payment.occurredAt
          const lastPayoutDate = profile?.lastPayoutAt
          const lastPayoutStatus = profile?.lastPayoutStatus as string | null
          const provider = profile?.paymentProvider || (payload?.provider as string) || null

          // Status values match PayoutInfoResponse: 'pending' | 'in_transit' | 'paid' | 'failed'
          let estimatedStatus: 'paid' | 'pending' | 'in_transit' | 'failed'
          let expectedPayoutDate: Date | null = null
          let paidDate: Date | null = null

          if (lastPayoutDate && paymentDate && paymentDate < lastPayoutDate) {
            // Payment was included in a completed payout
            estimatedStatus = 'paid'
            paidDate = lastPayoutDate
          } else if (lastPayoutStatus && ['in_transit', 'pending', 'paid', 'failed'].includes(lastPayoutStatus)) {
            // Use real payout status from Stripe/Paystack webhooks
            // This gives us accurate "In Transit" status instead of estimates
            estimatedStatus = lastPayoutStatus as 'paid' | 'pending' | 'in_transit' | 'failed'
            expectedPayoutDate = lastPayoutDate || addBusinessDays(new Date(paymentDate), provider === 'stripe' ? 2 : 1)
            if (lastPayoutStatus === 'paid') {
              paidDate = lastPayoutDate
            }
          } else if (provider === 'stripe') {
            // Fallback: Stripe payouts are typically T+2 business days
            const daysSincePayment = (Date.now() - new Date(paymentDate).getTime()) / (1000 * 60 * 60 * 24)
            estimatedStatus = daysSincePayment > 3 ? 'in_transit' : 'pending'
            expectedPayoutDate = addBusinessDays(new Date(paymentDate), 2)
          } else {
            // Fallback: Paystack payouts are T+1 (next business day)
            const daysSincePayment = (Date.now() - new Date(paymentDate).getTime()) / (1000 * 60 * 60 * 24)
            estimatedStatus = daysSincePayment > 2 ? 'in_transit' : 'pending'
            expectedPayoutDate = addBusinessDays(new Date(paymentDate), 1)
          }

          // Return a unified 'date' field:
          // - For 'paid': the payout date
          // - For 'pending'/'in_transit': the expected payout date
          const payoutDate = estimatedStatus === 'paid' ? paidDate : expectedPayoutDate

          payoutInfo = {
            status: estimatedStatus,
            provider,
            date: payoutDate?.toISOString() || null,
            amount: payment.netCents, // Amount being paid out
          }

          if (payment.exchangeRate) {
            // FX data already exists
            fxData = {
              originalCurrency: payment.currency,
              originalAmountCents: payment.grossCents ?? payment.amountCents ?? payment.netCents, // Fallback chain for legacy
              payoutCurrency: payment.payoutCurrency,
              payoutAmountCents: payment.payoutAmountCents,
              exchangeRate: payment.exchangeRate,
            }
          } else if (payment.stripeChargeId && provider === 'stripe' && !payment.fxCheckedAt) {
            // ON-DEMAND FX BACKFILL: FX data missing, not yet checked, and we have a charge ID
            // Fire-and-forget to avoid blocking the response
            const stripeAccountId = profile?.stripeAccountId
            const paymentId = payment.id

            // Cross-border detection: Use countryCode, not currency
            // Nigerian/Ghanaian/Kenyan Stripe creators have profile.currency = 'USD' (required)
            // but payouts convert to local currency (NGN/GHS/KES), so FX IS happening
            const countryCode = profile?.countryCode || ''
            const isCrossBorder = isStripeCrossBorderSupported(countryCode)

            if (stripeAccountId) {
              // Signal pending FX to UI for cross-border countries (NG/GH/KE)
              // These always have FX conversion even when payment.currency === profile.currency
              if (isCrossBorder) {
                fxPending = true
              }

              // Async backfill - don't await
              ;(async () => {
                try {
                  const result = await getChargeFxData(payment.stripeChargeId!, stripeAccountId)

                  switch (result.status) {
                    case 'fx_found':
                      // FX conversion confirmed - save data and set sentinel
                      await db.payment.update({
                        where: { id: paymentId },
                        data: {
                          payoutCurrency: result.data.payoutCurrency,
                          payoutAmountCents: result.data.payoutAmountCents,
                          exchangeRate: result.data.exchangeRate,
                          fxCheckedAt: new Date(),
                        },
                      })
                      console.log(`[activity] Backfilled FX data for payment ${paymentId}`)
                      break

                    case 'no_fx':
                      // Same currency, no conversion - set sentinel (confirmed final state)
                      await db.payment.update({
                        where: { id: paymentId },
                        data: { fxCheckedAt: new Date() },
                      })
                      console.log(`[activity] No FX conversion for payment ${paymentId}, marked as checked`)
                      break

                    case 'pending':
                      // Transfer not ready yet - DON'T set sentinel, will retry on next view
                      console.log(`[activity] FX data pending for payment ${paymentId}, will retry later`)
                      break

                    case 'error':
                      // API error - DON'T set sentinel, will retry on next view
                      console.log(`[activity] FX lookup error for payment ${paymentId}, will retry later`)
                      break
                  }
                } catch (err) {
                  // Unexpected error - DON'T set sentinel, will retry
                  console.warn(`[activity] FX backfill failed for payment ${paymentId}:`, err)
                }
              })()
            }
          }
          // If fxCheckedAt is set but no exchangeRate, there's no FX conversion (same currency)
        }
      }
    }

    return c.json({
      activity: act,
      payoutInfo,
      fxData, // Exchange rate data for cross-border payments
      fxPending, // True if FX data is being fetched in background
    })
  }
)

export default activity
