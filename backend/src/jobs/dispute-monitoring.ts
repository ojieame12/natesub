/**
 * Dispute Ratio Monitoring Job
 *
 * Tracks 30-day rolling dispute ratio and alerts before hitting Visa VAMP thresholds.
 * Run daily via cron (recommended: 9 AM local time).
 *
 * Visa VAMP 2025 Thresholds:
 * - 0.65% Early Warning (Visa VAMP notification)
 * - 0.9%  Standard Threshold (VAMP enrollment)
 * - 1.8%  Excessive Threshold (enhanced remediation)
 *
 * Our Alert Thresholds (proactive, before Visa):
 * - 0.4% Early Warning
 * - 0.6% Elevated
 * - 0.8% Critical
 *
 * Creator Enforcement Thresholds:
 * - >2% (min 5 disputes) → Pause payouts, notify creator
 * - >3% → Suspend account (disable checkout), require appeal
 */

import { db } from '../db/client.js'
import { alertDisputeRatioWarning, alertSimple } from '../services/slack.js'
import {
  sendPayoutsPausedEmail,
  sendAccountSuspendedEmail,
  sendPayoutsResumedEmail,
} from '../services/email.js'

// Platform-level alert thresholds (as decimals)
const THRESHOLDS = {
  early: 0.004,    // 0.4%
  elevated: 0.006, // 0.6%
  critical: 0.008, // 0.8%
} as const

// Creator-level enforcement thresholds
// PayoutStatus enum: pending, active, restricted, disabled
const CREATOR_THRESHOLDS = {
  pausePayouts: 0.02,     // 2% - restrict payouts (payoutStatus: 'restricted')
  suspendAccount: 0.03,   // 3% - disable account (payoutStatus: 'disabled')
  minDisputes: 5,         // Minimum disputes before enforcement (avoid false positives)
} as const

interface DisputeMonitoringResult {
  transactionCount: number
  disputeCount: number
  disputeRatio: number
  alertLevel: 'none' | 'early' | 'elevated' | 'critical'
  topCreatorsByDisputes: Array<{
    creatorId: string
    creatorEmail: string
    displayName: string
    disputeCount: number
  }>
}

interface CreatorEnforcementResult {
  payoutsPaused: number
  accountsSuspended: number
  payoutsResumed: number
  details: Array<{
    creatorId: string
    action: 'paused' | 'suspended' | 'resumed' | 'none'
    disputeRate: number
    disputeCount: number
  }>
}

interface FirstPaymentDisputeResult {
  firstPaymentDisputes: number
  firstPaymentDisputeRate: number
  flaggedSubscribers: Array<{
    subscriberId: string
    email: string
    disputedAt: Date
  }>
}

interface RefundMonitoringResult {
  refundCount: number
  refundRate: number
  alertSent: boolean
}

interface FraudMonitoringResult {
  tc40Count: number
  fraudRate: number
  alertLevel: 'none' | 'early' | 'elevated' | 'critical'
}

/**
 * Calculate 30-day rolling dispute ratio and alert if thresholds exceeded
 */
export async function monitorDisputeRatio(): Promise<DisputeMonitoringResult> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Count successful card transactions in last 30 days
  // Visa counts disputes per transaction, not per dollar
  const transactionCount = await db.payment.count({
    where: {
      status: 'succeeded',
      type: { in: ['recurring', 'one_time'] },
      createdAt: { gte: thirtyDaysAgo },
    },
  })

  // Count disputes (including disputed, dispute_lost, dispute_won) in last 30 days
  // Note: We count at time of dispute creation, not resolution
  const disputeCount = await db.payment.count({
    where: {
      status: { in: ['disputed', 'dispute_lost', 'dispute_won'] },
      createdAt: { gte: thirtyDaysAgo },
    },
  })

  // Calculate ratio
  const disputeRatio = transactionCount > 0 ? disputeCount / transactionCount : 0

  // Determine alert level
  let alertLevel: 'none' | 'early' | 'elevated' | 'critical' = 'none'
  if (disputeRatio >= THRESHOLDS.critical) {
    alertLevel = 'critical'
  } else if (disputeRatio >= THRESHOLDS.elevated) {
    alertLevel = 'elevated'
  } else if (disputeRatio >= THRESHOLDS.early) {
    alertLevel = 'early'
  }

  // Get top creators by dispute count (for investigation)
  const disputesByCreator = await db.payment.groupBy({
    by: ['creatorId'],
    where: {
      status: { in: ['disputed', 'dispute_lost', 'dispute_won'] },
      createdAt: { gte: thirtyDaysAgo },
    },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 10,
  })

  // Fetch creator details
  const creatorIds = disputesByCreator.map((d) => d.creatorId)
  const creators = await db.user.findMany({
    where: { id: { in: creatorIds } },
    select: {
      id: true,
      email: true,
      profile: { select: { displayName: true } },
    },
  })

  const creatorMap = new Map(creators.map((c) => [c.id, c]))

  const topCreatorsByDisputes = disputesByCreator.map((d) => {
    const creator = creatorMap.get(d.creatorId)
    return {
      creatorId: d.creatorId,
      creatorEmail: creator?.email || 'unknown',
      displayName: creator?.profile?.displayName || 'Unknown',
      disputeCount: d._count.id,
    }
  })

  // Send alert if threshold exceeded
  if (alertLevel !== 'none') {
    await alertDisputeRatioWarning({
      currentRatio: disputeRatio,
      threshold: alertLevel,
      disputeCount,
      transactionCount,
      topOffenders: topCreatorsByDisputes.slice(0, 5),
    })

    console.log(
      `[dispute-monitoring] Alert sent: ${alertLevel} - ${(disputeRatio * 100).toFixed(2)}% ` +
      `(${disputeCount}/${transactionCount} transactions)`
    )
  } else {
    console.log(
      `[dispute-monitoring] Ratio healthy: ${(disputeRatio * 100).toFixed(3)}% ` +
      `(${disputeCount}/${transactionCount} transactions)`
    )
  }

  return {
    transactionCount,
    disputeCount,
    disputeRatio,
    alertLevel,
    topCreatorsByDisputes,
  }
}

/**
 * Enforce dispute rate limits on creators
 * - >2% (min 5 disputes) → Pause payouts
 * - >3% → Suspend account
 * - <2% (previously paused) → Resume payouts
 */
export async function enforceCreatorDisputeLimits(): Promise<CreatorEnforcementResult> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const result: CreatorEnforcementResult = {
    payoutsPaused: 0,
    accountsSuspended: 0,
    payoutsResumed: 0,
    details: [],
  }

  // Get dispute counts by creator
  const disputesByCreator = await db.payment.groupBy({
    by: ['creatorId'],
    where: {
      status: { in: ['disputed', 'dispute_lost', 'dispute_won'] },
      createdAt: { gte: thirtyDaysAgo },
    },
    _count: { id: true },
  })

  // Get transaction counts by creator
  const transactionsByCreator = await db.payment.groupBy({
    by: ['creatorId'],
    where: {
      status: 'succeeded',
      type: { in: ['recurring', 'one_time'] },
      createdAt: { gte: thirtyDaysAgo },
    },
    _count: { id: true },
  })

  const transactionMap = new Map(transactionsByCreator.map((t) => [t.creatorId, t._count.id]))

  // Calculate rates and identify creators needing action
  const creatorRates: Map<string, { disputes: number; transactions: number; rate: number }> = new Map()

  for (const d of disputesByCreator) {
    const transactions = transactionMap.get(d.creatorId) || 0
    if (transactions === 0) continue

    const rate = d._count.id / transactions
    creatorRates.set(d.creatorId, {
      disputes: d._count.id,
      transactions,
      rate,
    })
  }

  // Get all creators with profiles for enforcement
  const allCreatorIds = Array.from(creatorRates.keys())
  const creatorsWithProfiles = await db.user.findMany({
    where: { id: { in: allCreatorIds } },
    select: {
      id: true,
      email: true,
      profile: {
        select: {
          displayName: true,
          payoutStatus: true,
        },
      },
    },
  })

  // Process each creator
  for (const creator of creatorsWithProfiles) {
    if (!creator.profile) continue

    const rates = creatorRates.get(creator.id)
    if (!rates) continue

    const { rate, disputes, transactions } = rates
    const currentStatus = creator.profile.payoutStatus

    // Determine required action
    let action: 'paused' | 'suspended' | 'resumed' | 'none' = 'none'

    if (rate >= CREATOR_THRESHOLDS.suspendAccount && disputes >= CREATOR_THRESHOLDS.minDisputes) {
      // >3% dispute rate - disable account (payoutStatus: 'disabled')
      if (currentStatus !== 'disabled') {
        await db.profile.update({
          where: { userId: creator.id },
          data: { payoutStatus: 'disabled' },
        })

        await sendAccountSuspendedEmail(
          creator.email,
          creator.profile.displayName || 'Creator',
          rate,
          disputes
        )

        // Log enforcement action
        await db.activity.create({
          data: {
            userId: creator.id,
            type: 'dispute_enforcement',
            payload: {
              action: 'account_disabled',
              disputeRate: rate,
              disputeCount: disputes,
              transactionCount: transactions,
              threshold: CREATOR_THRESHOLDS.suspendAccount,
            },
          },
        })

        action = 'suspended'
        result.accountsSuspended++

        console.log(
          `[dispute-monitoring] DISABLED account: ${creator.email} ` +
          `(${(rate * 100).toFixed(1)}% - ${disputes}/${transactions})`
        )
      }
    } else if (rate >= CREATOR_THRESHOLDS.pausePayouts && disputes >= CREATOR_THRESHOLDS.minDisputes) {
      // >2% dispute rate - restrict payouts (payoutStatus: 'restricted')
      if (currentStatus !== 'restricted' && currentStatus !== 'disabled') {
        await db.profile.update({
          where: { userId: creator.id },
          data: { payoutStatus: 'restricted' },
        })

        await sendPayoutsPausedEmail(
          creator.email,
          creator.profile.displayName || 'Creator',
          rate,
          disputes,
          transactions
        )

        // Log enforcement action
        await db.activity.create({
          data: {
            userId: creator.id,
            type: 'dispute_enforcement',
            payload: {
              action: 'payouts_restricted',
              disputeRate: rate,
              disputeCount: disputes,
              transactionCount: transactions,
              threshold: CREATOR_THRESHOLDS.pausePayouts,
            },
          },
        })

        action = 'paused'
        result.payoutsPaused++

        console.log(
          `[dispute-monitoring] RESTRICTED payouts: ${creator.email} ` +
          `(${(rate * 100).toFixed(1)}% - ${disputes}/${transactions})`
        )
      }
    } else if (rate < CREATOR_THRESHOLDS.pausePayouts && currentStatus === 'restricted') {
      // Rate dropped below threshold - resume payouts (but not if disabled)
      await db.profile.update({
        where: { userId: creator.id },
        data: { payoutStatus: 'active' },
      })

      await sendPayoutsResumedEmail(
        creator.email,
        creator.profile.displayName || 'Creator',
        rate
      )

      // Log resumption
      await db.activity.create({
        data: {
          userId: creator.id,
          type: 'dispute_enforcement',
          payload: {
            action: 'payouts_resumed',
            disputeRate: rate,
            disputeCount: disputes,
            transactionCount: transactions,
          },
        },
      })

      action = 'resumed'
      result.payoutsResumed++

      console.log(
        `[dispute-monitoring] RESUMED payouts: ${creator.email} ` +
        `(${(rate * 100).toFixed(1)}% - now healthy)`
      )
    }

    if (action !== 'none') {
      result.details.push({
        creatorId: creator.id,
        action,
        disputeRate: rate,
        disputeCount: disputes,
      })
    }
  }

  // Send summary to Slack if any actions taken
  if (result.payoutsPaused > 0 || result.accountsSuspended > 0 || result.payoutsResumed > 0) {
    await alertSimple(
      `Dispute enforcement: ${result.payoutsPaused} paused, ` +
      `${result.accountsSuspended} suspended, ${result.payoutsResumed} resumed`,
      '⚖️'
    )
  }

  return result
}

/**
 * Track first-payment disputes
 * First payment disputes are high-risk indicators (fraud, confusion, immediate regret)
 */
export async function monitorFirstPaymentDisputes(): Promise<FirstPaymentDisputeResult> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Get all disputed payments in last 30 days with subscription info
  const disputedPayments = await db.payment.findMany({
    where: {
      status: { in: ['disputed', 'dispute_lost', 'dispute_won'] },
      createdAt: { gte: thirtyDaysAgo },
      subscriptionId: { not: null },
    },
    include: {
      subscription: {
        select: {
          startedAt: true,
          subscriber: {
            select: {
              email: true,
            },
          },
        },
      },
    },
  })

  // Identify first-payment disputes (disputed within 7 days of subscription start)
  const firstPaymentDisputes: Array<{
    subscriberId: string
    email: string
    disputedAt: Date
  }> = []

  for (const payment of disputedPayments) {
    if (!payment.subscription?.startedAt) continue

    const daysSinceStart = Math.floor(
      (payment.createdAt.getTime() - payment.subscription.startedAt.getTime()) / (24 * 60 * 60 * 1000)
    )

    // First payment = disputed within 7 days of subscription start
    if (daysSinceStart <= 7) {
      firstPaymentDisputes.push({
        subscriberId: payment.subscriberId || 'unknown',
        email: payment.subscription.subscriber?.email || 'unknown',
        disputedAt: payment.createdAt,
      })
    }
  }

  // Calculate first-payment dispute rate
  const totalFirstPayments = await db.payment.count({
    where: {
      status: 'succeeded',
      type: 'recurring',
      createdAt: { gte: thirtyDaysAgo },
      // First payment approximation: payment occurred within 7 days of subscription start
    },
  })

  const firstPaymentDisputeRate = totalFirstPayments > 0
    ? firstPaymentDisputes.length / totalFirstPayments
    : 0

  // Alert if first-payment dispute rate exceeds 2%
  if (firstPaymentDisputeRate > 0.02 && firstPaymentDisputes.length >= 3) {
    await alertSimple(
      `First-payment dispute rate: ${(firstPaymentDisputeRate * 100).toFixed(1)}% ` +
      `(${firstPaymentDisputes.length} disputes). This indicates fraud or confusion at signup.`,
      '🚨'
    )
  }

  console.log(
    `[dispute-monitoring] First-payment disputes: ${firstPaymentDisputes.length} ` +
    `(${(firstPaymentDisputeRate * 100).toFixed(2)}%)`
  )

  return {
    firstPaymentDisputes: firstPaymentDisputes.length,
    firstPaymentDisputeRate,
    flaggedSubscribers: firstPaymentDisputes,
  }
}

/**
 * Monitor refund rate
 * High refund rates (>5%) can trigger payment processor reviews
 */
export async function monitorRefundRate(): Promise<RefundMonitoringResult> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Count refunds in last 30 days
  const refundCount = await db.payment.count({
    where: {
      status: 'refunded',
      createdAt: { gte: thirtyDaysAgo },
    },
  })

  // Count successful transactions
  const transactionCount = await db.payment.count({
    where: {
      status: 'succeeded',
      type: { in: ['recurring', 'one_time'] },
      createdAt: { gte: thirtyDaysAgo },
    },
  })

  const refundRate = transactionCount > 0 ? refundCount / transactionCount : 0

  let alertSent = false

  // Alert if refund rate exceeds 5%
  if (refundRate > 0.05 && refundCount >= 10) {
    await alertSimple(
      `Refund rate elevated: ${(refundRate * 100).toFixed(1)}% ` +
      `(${refundCount}/${transactionCount} transactions). Monitor for patterns.`,
      '💸'
    )
    alertSent = true
  }

  console.log(
    `[dispute-monitoring] Refund rate: ${(refundRate * 100).toFixed(2)}% ` +
    `(${refundCount}/${transactionCount})`
  )

  return {
    refundCount,
    refundRate,
    alertSent,
  }
}

/**
 * Monitor TC40/SAFE fraud warnings (Early Fraud Warnings from Stripe Radar)
 * These count toward Visa VAMP ratio separately from disputes
 *
 * VAMP considers:
 * - Total disputes + TC40 fraud reports
 * - vs Total Visa transactions
 *
 * Thresholds (same as dispute thresholds):
 * - 0.3% Warning
 * - 0.5% Elevated
 * - 0.7% Critical
 */
export async function monitorFraudRate(): Promise<FraudMonitoringResult> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Count TC40/SAFE reports in last 30 days
  const tc40Count = await db.fraudWarning.count({
    where: {
      createdAt: { gte: thirtyDaysAgo },
    },
  })

  // Count successful transactions (same denominator as dispute rate)
  const transactionCount = await db.payment.count({
    where: {
      status: 'succeeded',
      type: { in: ['recurring', 'one_time'] },
      createdAt: { gte: thirtyDaysAgo },
    },
  })

  const fraudRate = transactionCount > 0 ? tc40Count / transactionCount : 0

  // Fraud thresholds (slightly lower than dispute thresholds since TC40s often lead to disputes)
  const FRAUD_THRESHOLDS = {
    early: 0.003,    // 0.3%
    elevated: 0.005, // 0.5%
    critical: 0.007, // 0.7%
  }

  let alertLevel: 'none' | 'early' | 'elevated' | 'critical' = 'none'
  if (fraudRate >= FRAUD_THRESHOLDS.critical) {
    alertLevel = 'critical'
  } else if (fraudRate >= FRAUD_THRESHOLDS.elevated) {
    alertLevel = 'elevated'
  } else if (fraudRate >= FRAUD_THRESHOLDS.early) {
    alertLevel = 'early'
  }

  // Alert if threshold exceeded
  if (alertLevel !== 'none') {
    const alertEmoji = alertLevel === 'critical' ? '🔴' : alertLevel === 'elevated' ? '🟠' : '🟡'
    await alertSimple(
      `${alertEmoji} TC40/Fraud Warning Rate: ${(fraudRate * 100).toFixed(2)}% ` +
      `(${tc40Count} warnings / ${transactionCount} transactions) - Level: ${alertLevel.toUpperCase()}`,
      alertEmoji
    )

    console.log(
      `[dispute-monitoring] TC40 Alert: ${alertLevel} - ${(fraudRate * 100).toFixed(2)}% ` +
      `(${tc40Count} warnings)`
    )
  } else {
    console.log(
      `[dispute-monitoring] TC40 rate healthy: ${(fraudRate * 100).toFixed(3)}% ` +
      `(${tc40Count} warnings / ${transactionCount} transactions)`
    )
  }

  return {
    tc40Count,
    fraudRate,
    alertLevel,
  }
}

/**
 * Check for creators with high individual dispute rates (monitoring only)
 * Actual enforcement is done in enforceCreatorDisputeLimits()
 */
export async function monitorCreatorDisputeRates(): Promise<{
  problematicCreators: Array<{
    creatorId: string
    creatorEmail: string
    displayName: string
    disputeCount: number
    transactionCount: number
    disputeRate: number
  }>
}> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Get dispute counts by creator
  const disputesByCreator = await db.payment.groupBy({
    by: ['creatorId'],
    where: {
      status: { in: ['disputed', 'dispute_lost', 'dispute_won'] },
      createdAt: { gte: thirtyDaysAgo },
    },
    _count: { id: true },
  })

  // Get transaction counts by creator
  const transactionsByCreator = await db.payment.groupBy({
    by: ['creatorId'],
    where: {
      status: 'succeeded',
      type: { in: ['recurring', 'one_time'] },
      createdAt: { gte: thirtyDaysAgo },
    },
    _count: { id: true },
  })

  const transactionMap = new Map(transactionsByCreator.map((t) => [t.creatorId, t._count.id]))

  // Find creators with elevated dispute rates (>1% with at least 2 disputes)
  const problematicCreatorIds: string[] = []
  const creatorRates: Map<string, { disputes: number; transactions: number; rate: number }> = new Map()

  for (const d of disputesByCreator) {
    const transactions = transactionMap.get(d.creatorId) || 0
    if (transactions === 0) continue

    const rate = d._count.id / transactions
    creatorRates.set(d.creatorId, {
      disputes: d._count.id,
      transactions,
      rate,
    })

    // Flag if rate > 1% AND at least 2 disputes (avoid false positives from low volume)
    if (rate > 0.01 && d._count.id >= 2) {
      problematicCreatorIds.push(d.creatorId)
    }
  }

  // Fetch creator details
  const creators = await db.user.findMany({
    where: { id: { in: problematicCreatorIds } },
    select: {
      id: true,
      email: true,
      profile: { select: { displayName: true } },
    },
  })

  const creatorMap = new Map(creators.map((c) => [c.id, c]))

  const problematicCreators = problematicCreatorIds.map((id) => {
    const creator = creatorMap.get(id)
    const rates = creatorRates.get(id)!
    return {
      creatorId: id,
      creatorEmail: creator?.email || 'unknown',
      displayName: creator?.profile?.displayName || 'Unknown',
      disputeCount: rates.disputes,
      transactionCount: rates.transactions,
      disputeRate: rates.rate,
    }
  }).sort((a, b) => b.disputeRate - a.disputeRate)

  return { problematicCreators }
}

/**
 * Full dispute monitoring run
 * Call this from cron scheduler
 */
export async function runDisputeMonitoring(): Promise<{
  platformHealth: DisputeMonitoringResult
  enforcement: CreatorEnforcementResult
  firstPaymentDisputes: FirstPaymentDisputeResult
  refunds: RefundMonitoringResult
  fraudRate: FraudMonitoringResult
}> {
  console.log('[dispute-monitoring] Starting monitoring run...')

  // 1. Platform-level dispute ratio monitoring
  const platformHealth = await monitorDisputeRatio()

  // 2. Creator-level enforcement
  const enforcement = await enforceCreatorDisputeLimits()

  // 3. First-payment dispute tracking
  const firstPaymentDisputes = await monitorFirstPaymentDisputes()

  // 4. Refund rate monitoring
  const refunds = await monitorRefundRate()

  // 5. TC40/Fraud warning rate monitoring (Visa VAMP)
  const fraudRate = await monitorFraudRate()

  console.log(
    `[dispute-monitoring] Complete. Platform: ${platformHealth.alertLevel}, ` +
    `Enforcements: ${enforcement.payoutsPaused + enforcement.accountsSuspended}, ` +
    `First-payment disputes: ${firstPaymentDisputes.firstPaymentDisputes}, ` +
    `Refund rate: ${(refunds.refundRate * 100).toFixed(1)}%, ` +
    `TC40 rate: ${(fraudRate.fraudRate * 100).toFixed(2)}%`
  )

  return {
    platformHealth,
    enforcement,
    firstPaymentDisputes,
    refunds,
    fraudRate,
  }
}

export default {
  monitorDisputeRatio,
  monitorCreatorDisputeRates,
  enforceCreatorDisputeLimits,
  monitorFirstPaymentDisputes,
  monitorRefundRate,
  monitorFraudRate,
  runDisputeMonitoring,
}
