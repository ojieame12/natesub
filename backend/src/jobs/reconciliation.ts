// Balance Reconciliation Job
// Compares database totals with Stripe/Paystack to detect discrepancies
// Run daily or weekly via cron

import { db } from '../db/client.js'
import { stripe } from '../services/stripe.js'
import { getBalance as getPaystackBalance } from '../services/paystack.js'

interface ReconciliationResult {
  runAt: Date
  stripe: {
    dbTotal: number
    apiBalance: number
    discrepancy: number
    discrepancyPercent: number
    status: 'ok' | 'warning' | 'error'
  } | null
  paystack: {
    dbTotal: number
    apiBalance: number
    discrepancy: number
    discrepancyPercent: number
    status: 'ok' | 'warning' | 'error'
  } | null
  alerts: string[]
}

// Thresholds for alerts
const WARNING_THRESHOLD_PERCENT = 1 // 1% discrepancy triggers warning
const ERROR_THRESHOLD_PERCENT = 5 // 5% discrepancy triggers error

/**
 * Run balance reconciliation
 * Compares DB payment records with actual provider balances
 */
export async function runReconciliation(
  options: {
    periodDays?: number // Default: 30 days
    dryRun?: boolean // If true, don't create activity records
  } = {}
): Promise<ReconciliationResult> {
  const { periodDays = 30, dryRun = false } = options
  const now = new Date()
  const periodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000)

  const result: ReconciliationResult = {
    runAt: now,
    stripe: null,
    paystack: null,
    alerts: [],
  }

  // ====================
  // STRIPE RECONCILIATION
  // ====================
  try {
    // Get DB totals for Stripe payments in period
    const stripePayments = await db.payment.aggregate({
      where: {
        stripeEventId: { not: null },
        status: 'succeeded',
        createdAt: { gte: periodStart },
      },
      _sum: {
        netCents: true,
        feeCents: true,
        amountCents: true,
      },
      _count: true,
    })

    const stripeDbTotal = stripePayments._sum.netCents || 0

    // Get Stripe balance (available + pending)
    // Note: This is platform balance, not per-creator
    const stripeBalance = await stripe.balance.retrieve()
    const stripeApiBalance = stripeBalance.available.reduce((sum, b) => sum + b.amount, 0)
      + stripeBalance.pending.reduce((sum, b) => sum + b.amount, 0)

    const stripeDiscrepancy = Math.abs(stripeDbTotal - stripeApiBalance)
    const stripeDiscrepancyPercent = stripeApiBalance > 0
      ? (stripeDiscrepancy / stripeApiBalance) * 100
      : 0

    let stripeStatus: 'ok' | 'warning' | 'error' = 'ok'
    if (stripeDiscrepancyPercent >= ERROR_THRESHOLD_PERCENT) {
      stripeStatus = 'error'
      result.alerts.push(`STRIPE ERROR: ${stripeDiscrepancyPercent.toFixed(2)}% discrepancy (DB: ${stripeDbTotal}, API: ${stripeApiBalance})`)
    } else if (stripeDiscrepancyPercent >= WARNING_THRESHOLD_PERCENT) {
      stripeStatus = 'warning'
      result.alerts.push(`STRIPE WARNING: ${stripeDiscrepancyPercent.toFixed(2)}% discrepancy`)
    }

    result.stripe = {
      dbTotal: stripeDbTotal,
      apiBalance: stripeApiBalance,
      discrepancy: stripeDiscrepancy,
      discrepancyPercent: stripeDiscrepancyPercent,
      status: stripeStatus,
    }

    console.log(`[reconciliation] Stripe: DB=${stripeDbTotal}, API=${stripeApiBalance}, diff=${stripeDiscrepancy} (${stripeDiscrepancyPercent.toFixed(2)}%)`)
  } catch (err) {
    console.error('[reconciliation] Stripe check failed:', err)
    result.alerts.push(`STRIPE CHECK FAILED: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }

  // ====================
  // PAYSTACK RECONCILIATION
  // ====================
  try {
    // Get DB totals for Paystack payments in period
    const paystackPayments = await db.payment.aggregate({
      where: {
        paystackEventId: { not: null },
        status: 'succeeded',
        createdAt: { gte: periodStart },
      },
      _sum: {
        netCents: true,
        feeCents: true,
        amountCents: true,
      },
      _count: true,
    })

    const paystackDbTotal = paystackPayments._sum.netCents || 0

    // Get Paystack balance
    const paystackBalances = await getPaystackBalance()
    // Sum all currency balances (converted to cents for consistency)
    const paystackApiBalance = paystackBalances.reduce((sum, b) => sum + b.balance, 0)

    const paystackDiscrepancy = Math.abs(paystackDbTotal - paystackApiBalance)
    const paystackDiscrepancyPercent = paystackApiBalance > 0
      ? (paystackDiscrepancy / paystackApiBalance) * 100
      : 0

    let paystackStatus: 'ok' | 'warning' | 'error' = 'ok'
    if (paystackDiscrepancyPercent >= ERROR_THRESHOLD_PERCENT) {
      paystackStatus = 'error'
      result.alerts.push(`PAYSTACK ERROR: ${paystackDiscrepancyPercent.toFixed(2)}% discrepancy (DB: ${paystackDbTotal}, API: ${paystackApiBalance})`)
    } else if (paystackDiscrepancyPercent >= WARNING_THRESHOLD_PERCENT) {
      paystackStatus = 'warning'
      result.alerts.push(`PAYSTACK WARNING: ${paystackDiscrepancyPercent.toFixed(2)}% discrepancy`)
    }

    result.paystack = {
      dbTotal: paystackDbTotal,
      apiBalance: paystackApiBalance,
      discrepancy: paystackDiscrepancy,
      discrepancyPercent: paystackDiscrepancyPercent,
      status: paystackStatus,
    }

    console.log(`[reconciliation] Paystack: DB=${paystackDbTotal}, API=${paystackApiBalance}, diff=${paystackDiscrepancy} (${paystackDiscrepancyPercent.toFixed(2)}%)`)
  } catch (err) {
    console.error('[reconciliation] Paystack check failed:', err)
    result.alerts.push(`PAYSTACK CHECK FAILED: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }

  // ====================
  // RECORD RESULTS
  // ====================
  if (!dryRun && result.alerts.length > 0) {
    // Create activity for alerts (visible to admin/system)
    await db.activity.create({
      data: {
        userId: 'system', // System user ID - should exist or use first admin
        type: 'reconciliation_alert',
        payload: {
          runAt: result.runAt.toISOString(),
          periodDays,
          stripe: result.stripe,
          paystack: result.paystack,
          alerts: result.alerts,
        },
      },
    }).catch((err) => {
      console.error('[reconciliation] Failed to create alert activity:', err)
    })
  }

  // Log summary
  console.log(`[reconciliation] Complete. Alerts: ${result.alerts.length}`)
  if (result.alerts.length > 0) {
    result.alerts.forEach(alert => console.log(`  - ${alert}`))
  }

  return result
}

/**
 * Check for missing webhook events
 * Identifies payments in DB without corresponding webhook event records
 */
export async function checkMissingWebhookEvents(): Promise<{
  missingStripe: number
  missingPaystack: number
  details: Array<{ paymentId: string; provider: string; createdAt: Date }>
}> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  // Find payments without corresponding webhook events
  const paymentsWithoutEvents = await db.payment.findMany({
    where: {
      createdAt: { gte: twentyFourHoursAgo },
      status: 'succeeded',
      OR: [
        {
          stripeEventId: { not: null },
          // No corresponding webhook event
        },
        {
          paystackEventId: { not: null },
        },
      ],
    },
    select: {
      id: true,
      stripeEventId: true,
      paystackEventId: true,
      createdAt: true,
    },
  })

  // Check each payment for webhook event
  const missingDetails: Array<{ paymentId: string; provider: string; createdAt: Date }> = []

  for (const payment of paymentsWithoutEvents) {
    const eventId = payment.stripeEventId || (payment.paystackEventId ? `paystack_${payment.paystackEventId}` : null)
    if (!eventId) continue

    const webhookEvent = await db.webhookEvent.findUnique({
      where: { eventId },
    })

    if (!webhookEvent) {
      missingDetails.push({
        paymentId: payment.id,
        provider: payment.stripeEventId ? 'stripe' : 'paystack',
        createdAt: payment.createdAt,
      })
    }
  }

  return {
    missingStripe: missingDetails.filter(d => d.provider === 'stripe').length,
    missingPaystack: missingDetails.filter(d => d.provider === 'paystack').length,
    details: missingDetails,
  }
}

/**
 * Get webhook event statistics
 */
export async function getWebhookStats(periodDays = 7): Promise<{
  total: number
  byStatus: Record<string, number>
  byProvider: Record<string, number>
  byEventType: Record<string, number>
  avgProcessingTimeMs: number
  failureRate: number
}> {
  const periodStart = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000)

  const events = await db.webhookEvent.findMany({
    where: {
      createdAt: { gte: periodStart },
    },
    select: {
      status: true,
      provider: true,
      eventType: true,
      processingTimeMs: true,
    },
  })

  const byStatus: Record<string, number> = {}
  const byProvider: Record<string, number> = {}
  const byEventType: Record<string, number> = {}
  let totalProcessingTime = 0
  let processedCount = 0

  for (const event of events) {
    byStatus[event.status] = (byStatus[event.status] || 0) + 1
    byProvider[event.provider] = (byProvider[event.provider] || 0) + 1
    byEventType[event.eventType] = (byEventType[event.eventType] || 0) + 1

    if (event.processingTimeMs) {
      totalProcessingTime += event.processingTimeMs
      processedCount++
    }
  }

  const failedCount = byStatus['failed'] || 0
  const totalCount = events.length

  return {
    total: totalCount,
    byStatus,
    byProvider,
    byEventType,
    avgProcessingTimeMs: processedCount > 0 ? Math.round(totalProcessingTime / processedCount) : 0,
    failureRate: totalCount > 0 ? (failedCount / totalCount) * 100 : 0,
  }
}
