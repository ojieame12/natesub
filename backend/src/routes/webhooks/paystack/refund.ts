import { db } from '../../../db/client.js'
import { invalidateAdminRevenueCache } from '../../../utils/cache.js'
import { convertLocalCentsToUSD, getUSDRate } from '../../../services/fx.js'

// Handle Paystack refund.processed - refund completed successfully
export async function handlePaystackRefundProcessed(data: any, eventId: string) {
  const { transaction, amount, currency } = data
  const transactionRef = transaction?.reference || data.transaction_reference

  if (!transactionRef) {
    console.error('[paystack] Refund processed but no transaction reference')
    return
  }

  // Find the original payment by transaction reference
  const originalPayment = await db.payment.findFirst({
    where: {
      paystackTransactionRef: transactionRef,
      type: { in: ['recurring', 'one_time'] },
      status: 'succeeded',
    },
    include: {
      subscription: {
        include: {
          creator: {
            include: { profile: { select: { purpose: true } } },
          },
        },
      },
    },
  })

  if (!originalPayment) {
    console.log(`[paystack] Refund processed but no original payment found: ${transactionRef}`)
    return
  }

  // IDEMPOTENCY: Check if refund already recorded
  const existingRefund = await db.payment.findFirst({
    where: { paystackEventId: eventId },
  })
  if (existingRefund) {
    console.log(`[paystack] Refund ${eventId} already processed, skipping`)
    return
  }

  // Calculate refund fees using original payment's fee ratio
  const refundAmount = amount || originalPayment.amountCents
  let feeCents = 0
  let netCents = refundAmount
  let creatorFeeCents: number | null = null
  let subscriberFeeCents: number | null = null

  if (originalPayment.grossCents && originalPayment.feeCents) {
    // Use original fee ratio for accurate refund calculation
    const feeRatio = originalPayment.feeCents / originalPayment.grossCents
    const netRatio = originalPayment.netCents / originalPayment.grossCents
    feeCents = Math.round(refundAmount * feeRatio)
    netCents = Math.round(refundAmount * netRatio)

    // Copy split fee breakdown from original payment (proportional to refund)
    if (originalPayment.creatorFeeCents !== null && originalPayment.grossCents > 0) {
      const refundRatio = refundAmount / originalPayment.grossCents
      creatorFeeCents = Math.round(originalPayment.creatorFeeCents * refundRatio)
    }
    if (originalPayment.subscriberFeeCents !== null && originalPayment.grossCents > 0) {
      const refundRatio = refundAmount / originalPayment.grossCents
      subscriberFeeCents = Math.round(originalPayment.subscriberFeeCents * refundRatio)
    }
  }

  // Calculate reporting currency fields using original payment's rate (or fallback to current)
  const refundCurrency = currency?.toUpperCase() || originalPayment.currency
  const isUSD = refundCurrency === 'USD'
  let reportingData: {
    reportingCurrency: string
    reportingGrossCents: number
    reportingFeeCents: number
    reportingNetCents: number
    reportingExchangeRate: number
    reportingRateSource: string
    reportingRateTimestamp: Date
    reportingIsEstimated: boolean
  }

  if (originalPayment.reportingExchangeRate && originalPayment.reportingCurrency) {
    const rate = originalPayment.reportingExchangeRate
    reportingData = {
      reportingCurrency: 'USD',
      reportingGrossCents: isUSD ? -refundAmount : -convertLocalCentsToUSD(refundAmount, rate),
      reportingFeeCents: isUSD ? -feeCents : -convertLocalCentsToUSD(feeCents, rate),
      reportingNetCents: isUSD ? -netCents : -convertLocalCentsToUSD(netCents, rate),
      reportingExchangeRate: rate,
      reportingRateSource: 'original_payment',
      reportingRateTimestamp: new Date(),
      reportingIsEstimated: false,
    }
  } else {
    // Fall back to current rate if original payment has no reporting data
    const rate = isUSD ? 1 : await getUSDRate(refundCurrency)
    reportingData = {
      reportingCurrency: 'USD',
      reportingGrossCents: isUSD ? -refundAmount : -convertLocalCentsToUSD(refundAmount, rate),
      reportingFeeCents: isUSD ? -feeCents : -convertLocalCentsToUSD(feeCents, rate),
      reportingNetCents: isUSD ? -netCents : -convertLocalCentsToUSD(netCents, rate),
      reportingExchangeRate: rate,
      reportingRateSource: 'current_rate',
      reportingRateTimestamp: new Date(),
      reportingIsEstimated: !isUSD,
    }
  }

  // Create refund payment record (negative amounts) with split fee fields
  // Use eventId for uniqueness to support multiple partial refunds for same transaction
  await db.payment.create({
    data: {
      subscriptionId: originalPayment.subscriptionId,
      creatorId: originalPayment.creatorId,
      subscriberId: originalPayment.subscriberId,
      amountCents: -refundAmount, // Negative for refund
      currency: refundCurrency,
      feeCents: -feeCents,
      netCents: -netCents,
      creatorFeeCents: creatorFeeCents !== null ? -creatorFeeCents : null,
      subscriberFeeCents: subscriberFeeCents !== null ? -subscriberFeeCents : null,
      type: 'refund',
      status: 'refunded',
      paystackEventId: eventId,
      paystackTransactionRef: `REF-${eventId}`, // Use eventId for uniqueness (supports partial refunds)
      feeModel: originalPayment.feeModel,
      // Reporting currency (use original payment's rate)
      ...reportingData,
    },
  })

  // Invalidate admin revenue cache after refund creation
  await invalidateAdminRevenueCache()

  // Decrement LTV if subscription exists
  if (originalPayment.subscriptionId) {
    const subscription = await db.subscription.findUnique({
      where: { id: originalPayment.subscriptionId },
    })
    if (subscription) {
      // Don't let LTV go negative
      const decrementAmount = Math.min(netCents, subscription.ltvCents)
      await db.subscription.update({
        where: { id: originalPayment.subscriptionId },
        data: { ltvCents: { decrement: decrementAmount } },
      })
    }
  }

  // Create activity for creator notification
  await db.activity.create({
    data: {
      userId: originalPayment.creatorId,
      type: 'payment_refunded',
      payload: {
        subscriptionId: originalPayment.subscriptionId,
        originalPaymentId: originalPayment.id,
        amount: refundAmount,
        currency: currency?.toUpperCase() || originalPayment.currency,
        reason: data.refund_reason || 'Customer requested refund',
        provider: 'paystack',
      },
    },
  })

  console.log(`[paystack] Refund processed: ${transactionRef}, amount: ${refundAmount}`)
}

// Handle Paystack refund.pending - refund is being processed
export async function handlePaystackRefundPending(data: any, eventId: string) {
  const { transaction } = data
  const transactionRef = transaction?.reference || data.transaction_reference

  console.log(`[paystack] Refund pending for transaction: ${transactionRef}`)

  // We don't create a payment record yet - wait for refund.processed
  // Just log for monitoring
}

// Handle Paystack refund.failed - refund attempt failed
export async function handlePaystackRefundFailed(data: any, eventId: string) {
  const { transaction, reason } = data
  const transactionRef = transaction?.reference || data.transaction_reference

  console.error(`[paystack] Refund failed for transaction: ${transactionRef}`, {
    reason: reason || 'Unknown reason',
    eventId,
  })

  // Find the original payment to notify creator
  const originalPayment = await db.payment.findFirst({
    where: {
      paystackTransactionRef: transactionRef,
      type: { in: ['recurring', 'one_time'] },
    },
  })

  if (originalPayment) {
    // Create activity for ops team to investigate
    await db.activity.create({
      data: {
        userId: originalPayment.creatorId,
        type: 'refund_failed',
        payload: {
          transactionRef,
          reason: reason || 'Refund processing failed',
          eventId,
          provider: 'paystack',
        },
      },
    })
  }
}
