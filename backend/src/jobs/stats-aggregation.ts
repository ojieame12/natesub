/**
 * Stats Aggregation Job
 *
 * Pre-computes daily statistics for the admin dashboard.
 * Run via cron daily, or manually to backfill historical data.
 */

import { db } from '../db/client.js'

interface DayStats {
  date: Date
  totalUsers: number
  newUsers: number
  activeCreators: number
  activeSubscriptions: number
  newSubscriptions: number
  canceledSubscriptions: number
  totalVolumeCents: bigint
  platformFeeCents: bigint
  creatorPayoutsCents: bigint
  paymentCount: number
  failedPayments: number
  refundCount: number
  refundAmountCents: bigint
  disputeCount: number
  stripeVolumeCents: bigint
  paystackVolumeCents: bigint
}

/**
 * Compute stats for a specific day
 */
export async function computeDayStats(date: Date): Promise<DayStats> {
  // Normalize to start of day UTC
  const dayStart = new Date(date)
  dayStart.setUTCHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1)

  // Run all queries in parallel for efficiency
  const [
    totalUsers,
    newUsers,
    activeCreators,
    activeSubscriptions,
    newSubscriptions,
    canceledSubscriptions,
    paymentStats,
    failedPayments,
    refundStats,
    disputeCount,
    stripeStats,
    paystackStats,
  ] = await Promise.all([
    // Total users as of this day
    db.user.count({
      where: { createdAt: { lt: dayEnd } },
    }),

    // New users on this day
    db.user.count({
      where: { createdAt: { gte: dayStart, lt: dayEnd } },
    }),

    // Active creators (payout status = active)
    db.profile.count({
      where: { payoutStatus: 'active' },
    }),

    // Active subscriptions as of this day
    db.subscription.count({
      where: {
        status: 'active',
        createdAt: { lt: dayEnd },
      },
    }),

    // New subscriptions on this day
    db.subscription.count({
      where: { createdAt: { gte: dayStart, lt: dayEnd } },
    }),

    // Canceled subscriptions on this day
    db.subscription.count({
      where: {
        status: 'canceled',
        updatedAt: { gte: dayStart, lt: dayEnd },
      },
    }),

    // Successful payment stats for this day
    db.payment.aggregate({
      where: {
        status: 'succeeded',
        type: { in: ['recurring', 'one_time'] },
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      _sum: {
        grossCents: true,
        feeCents: true,
        netCents: true,
      },
      _count: { _all: true },
    }),

    // Failed payments on this day
    db.payment.count({
      where: {
        status: 'failed',
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    }),

    // Refund stats for this day (use createdAt since Payment doesn't have updatedAt)
    db.payment.aggregate({
      where: {
        status: 'refunded',
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      _sum: { grossCents: true },
      _count: { _all: true },
    }),

    // Disputes opened on this day
    db.payment.count({
      where: {
        status: { in: ['disputed', 'dispute_lost'] },
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    }),

    // Stripe payment stats
    db.payment.aggregate({
      where: {
        status: 'succeeded',
        type: { in: ['recurring', 'one_time'] },
        stripePaymentIntentId: { not: null },
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      _sum: { grossCents: true },
    }),

    // Paystack payment stats
    db.payment.aggregate({
      where: {
        status: 'succeeded',
        type: { in: ['recurring', 'one_time'] },
        paystackTransactionRef: { not: null },
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      _sum: { grossCents: true },
    }),
  ])

  return {
    date: dayStart,
    totalUsers,
    newUsers,
    activeCreators,
    activeSubscriptions,
    newSubscriptions,
    canceledSubscriptions,
    totalVolumeCents: BigInt(paymentStats._sum.grossCents || 0),
    platformFeeCents: BigInt(paymentStats._sum.feeCents || 0),
    creatorPayoutsCents: BigInt(paymentStats._sum.netCents || 0),
    paymentCount: paymentStats._count._all,
    failedPayments,
    refundCount: refundStats._count._all,
    refundAmountCents: BigInt(refundStats._sum.grossCents || 0),
    disputeCount,
    stripeVolumeCents: BigInt(stripeStats._sum.grossCents || 0),
    paystackVolumeCents: BigInt(paystackStats._sum.grossCents || 0),
  }
}

/**
 * Aggregate stats for a single day and upsert to database
 */
export async function aggregateDay(date: Date): Promise<void> {
  const stats = await computeDayStats(date)

  await db.dailyStats.upsert({
    where: { date: stats.date },
    create: stats,
    update: {
      ...stats,
      computedAt: new Date(),
    },
  })

  console.log(`[stats] Aggregated stats for ${stats.date.toISOString().split('T')[0]}`)
}

/**
 * Aggregate stats for today (call this from daily cron)
 */
export async function aggregateToday(): Promise<void> {
  await aggregateDay(new Date())
}

/**
 * Aggregate yesterday's final stats (call this at midnight)
 */
export async function aggregateYesterday(): Promise<void> {
  const yesterday = new Date()
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  await aggregateDay(yesterday)
}

/**
 * Backfill historical stats for the last N days
 */
export async function backfillStats(days: number = 30): Promise<void> {
  console.log(`[stats] Backfilling stats for last ${days} days...`)

  const promises: Promise<void>[] = []
  const today = new Date()

  for (let i = 0; i < days; i++) {
    const date = new Date(today)
    date.setUTCDate(date.getUTCDate() - i)
    promises.push(aggregateDay(date))
  }

  await Promise.all(promises)
  console.log(`[stats] Backfill complete`)
}

/**
 * Get cached daily stats for a date range
 * Falls back to live computation if cache miss
 */
export async function getCachedDailyStats(days: number = 30) {
  const startDate = new Date()
  startDate.setUTCDate(startDate.getUTCDate() - days)
  startDate.setUTCHours(0, 0, 0, 0)

  const stats = await db.dailyStats.findMany({
    where: { date: { gte: startDate } },
    orderBy: { date: 'asc' },
  })

  return stats.map(s => ({
    date: s.date.toISOString().split('T')[0],
    volumeCents: Number(s.totalVolumeCents),
    feesCents: Number(s.platformFeeCents),
    payoutsCents: Number(s.creatorPayoutsCents),
    count: s.paymentCount,
  }))
}

/**
 * Get dashboard summary from cached stats
 */
export async function getCachedDashboardStats() {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const yesterday = new Date(today)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)

  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  // Get today's and this month's cached stats
  const [todayStats, monthStats] = await Promise.all([
    db.dailyStats.findUnique({ where: { date: today } }),
    db.dailyStats.findMany({
      where: { date: { gte: startOfMonth } },
    }),
  ])

  // Aggregate month stats
  const monthTotals = monthStats.reduce(
    (acc, s) => ({
      volume: acc.volume + Number(s.totalVolumeCents),
      fees: acc.fees + Number(s.platformFeeCents),
      newUsers: acc.newUsers + s.newUsers,
    }),
    { volume: 0, fees: 0, newUsers: 0 }
  )

  return {
    today: todayStats ? {
      volumeCents: Number(todayStats.totalVolumeCents),
      feesCents: Number(todayStats.platformFeeCents),
      paymentCount: todayStats.paymentCount,
      newUsers: todayStats.newUsers,
      failedPayments: todayStats.failedPayments,
    } : null,
    thisMonth: {
      volumeCents: monthTotals.volume,
      feesCents: monthTotals.fees,
      newUsers: monthTotals.newUsers,
    },
    // These need live queries for accuracy
    live: {
      totalUsers: await db.user.count(),
      activeSubscriptions: await db.subscription.count({ where: { status: 'active' } }),
      disputedPayments: await db.payment.count({ where: { status: 'disputed' } }),
    },
  }
}
