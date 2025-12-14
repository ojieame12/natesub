// Balance & Transaction Reconciliation Job
// Compares database totals with Stripe/Paystack to detect discrepancies
// Run daily or weekly via cron

import { db } from '../db/client.js'
import { stripe } from '../services/stripe.js'
import { getBalance as getPaystackBalance, listAllTransactions, type PaystackTransaction } from '../services/paystack.js'
import { sendReconciliationAlert } from '../services/alerts.js'

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

// ============================================
// PAYSTACK TRANSACTION RECONCILIATION
// ============================================

interface PaystackReconciliationResult {
  runAt: Date
  periodHours: number
  paystackTransactions: number
  dbPayments: number
  missingInDb: Array<{
    reference: string
    amount: number
    currency: string
    paidAt: string
    metadata: Record<string, any> | null
  }>
  statusMismatches: Array<{
    reference: string
    dbStatus: string
    paystackStatus: string
    amount: number
  }>
  autoFixed: number
  alerts: string[]
}

/**
 * Reconcile Paystack transactions with database payments
 * Finds:
 * 1. Successful payments in Paystack that are missing from DB (webhook failed)
 * 2. Payments with status mismatches (DB says pending, Paystack says success)
 *
 * Optionally auto-fixes status mismatches
 */
export async function reconcilePaystackTransactions(options: {
  periodHours?: number  // How far back to look (default: 48 hours)
  autoFix?: boolean     // Auto-fix status mismatches (default: false)
  alertOnDiscrepancy?: boolean // Send email alert (default: true)
} = {}): Promise<PaystackReconciliationResult> {
  const { periodHours = 48, autoFix = false, alertOnDiscrepancy = true } = options
  const now = new Date()
  const periodStart = new Date(now.getTime() - periodHours * 60 * 60 * 1000)

  console.log(`[reconciliation] Starting Paystack transaction reconciliation (${periodHours}h window)`)

  const result: PaystackReconciliationResult = {
    runAt: now,
    periodHours,
    paystackTransactions: 0,
    dbPayments: 0,
    missingInDb: [],
    statusMismatches: [],
    autoFixed: 0,
    alerts: [],
  }

  try {
    // 1. Fetch all successful transactions from Paystack in the period
    const paystackTxns = await listAllTransactions({
      from: periodStart,
      to: now,
      status: 'success',
    })

    result.paystackTransactions = paystackTxns.length
    console.log(`[reconciliation] Fetched ${paystackTxns.length} successful Paystack transactions`)

    if (paystackTxns.length === 0) {
      console.log('[reconciliation] No transactions to reconcile')
      return result
    }

    // 2. Get all Paystack references from our DB in the same period
    const dbPayments = await db.payment.findMany({
      where: {
        paystackTransactionRef: { not: null },
        createdAt: { gte: periodStart },
      },
      select: {
        id: true,
        paystackTransactionRef: true,
        status: true,
        amountCents: true,
        currency: true,
      },
    })

    result.dbPayments = dbPayments.length

    // Create a map for quick lookup
    const dbPaymentMap = new Map(
      dbPayments.map(p => [p.paystackTransactionRef, p])
    )

    // 3. Compare each Paystack transaction
    for (const txn of paystackTxns) {
      const dbPayment = dbPaymentMap.get(txn.reference)

      if (!dbPayment) {
        // Transaction exists in Paystack but NOT in our DB
        // This is the critical case: customer paid, webhook failed, creator didn't get credited
        result.missingInDb.push({
          reference: txn.reference,
          amount: txn.amount,
          currency: txn.currency,
          paidAt: txn.paid_at || txn.created_at,
          metadata: txn.metadata,
        })

        result.alerts.push(`MISSING: ${txn.reference} - ${txn.currency} ${txn.amount / 100} paid at ${txn.paid_at}`)
        continue
      }

      // Check for status mismatch
      // Paystack status is 'success', but our DB might have 'pending' or 'failed'
      const dbStatus = dbPayment.status
      if (dbStatus !== 'succeeded') {
        result.statusMismatches.push({
          reference: txn.reference,
          dbStatus,
          paystackStatus: txn.status,
          amount: txn.amount,
        })

        // Auto-fix if enabled
        if (autoFix && dbStatus === 'pending') {
          try {
            await db.payment.update({
              where: { id: dbPayment.id },
              data: { status: 'succeeded' },
            })
            result.autoFixed++
            console.log(`[reconciliation] Auto-fixed payment ${dbPayment.id}: pending -> succeeded`)
          } catch (err) {
            console.error(`[reconciliation] Failed to auto-fix payment ${dbPayment.id}:`, err)
          }
        }
      }
    }

    // 4. Log summary
    console.log(`[reconciliation] Complete:`)
    console.log(`  - Paystack transactions: ${result.paystackTransactions}`)
    console.log(`  - DB payments: ${result.dbPayments}`)
    console.log(`  - Missing in DB: ${result.missingInDb.length}`)
    console.log(`  - Status mismatches: ${result.statusMismatches.length}`)
    console.log(`  - Auto-fixed: ${result.autoFixed}`)

    // 5. Send alert if discrepancies found
    if (alertOnDiscrepancy && (result.missingInDb.length > 0 || result.statusMismatches.length > 0)) {
      const totalDiscrepancy = result.missingInDb.reduce((sum, t) => sum + t.amount, 0)

      try {
        await sendReconciliationAlert({
          missingInDb: result.missingInDb,
          statusMismatches: result.statusMismatches,
          totalDiscrepancyCents: totalDiscrepancy,
        })
        result.alerts.push('Email alert sent')
      } catch (err) {
        console.error('[reconciliation] Failed to send alert:', err)
        result.alerts.push(`Failed to send alert: ${err instanceof Error ? err.message : 'Unknown'}`)
      }
    }

  } catch (err) {
    console.error('[reconciliation] Paystack reconciliation failed:', err)
    result.alerts.push(`RECONCILIATION FAILED: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }

  return result
}

/**
 * Get missing transactions that need manual intervention
 * These are transactions that exist in Paystack but not in our DB
 */
export async function getMissingTransactions(periodHours = 48): Promise<{
  count: number
  transactions: Array<{
    reference: string
    amount: number
    currency: string
    paidAt: string
    customerEmail: string
    metadata: Record<string, any> | null
  }>
}> {
  const now = new Date()
  const periodStart = new Date(now.getTime() - periodHours * 60 * 60 * 1000)

  // Fetch successful Paystack transactions
  const paystackTxns = await listAllTransactions({
    from: periodStart,
    to: now,
    status: 'success',
  })

  // Get all references from our DB
  const dbRefs = await db.payment.findMany({
    where: {
      paystackTransactionRef: { not: null },
      createdAt: { gte: periodStart },
    },
    select: { paystackTransactionRef: true },
  })

  const dbRefSet = new Set(dbRefs.map(p => p.paystackTransactionRef))

  // Find missing
  const missing = paystackTxns
    .filter(txn => !dbRefSet.has(txn.reference))
    .map(txn => ({
      reference: txn.reference,
      amount: txn.amount,
      currency: txn.currency,
      paidAt: txn.paid_at || txn.created_at,
      customerEmail: txn.customer.email,
      metadata: txn.metadata,
    }))

  return {
    count: missing.length,
    transactions: missing,
  }
}
