import Stripe from 'stripe'
import { db } from '../../../db/client.js'
import { calculateServiceFee, calculateLegacyFee } from '../../../services/fees.js'
import { stripe } from '../../../services/stripe.js'
import { isStripeCrossBorderSupported } from '../../../utils/constants.js'
import { convertLocalCentsToUSD, getUSDRate } from '../../../services/fx.js'

// Handle charge refunded
export async function handleChargeRefunded(event: Stripe.Event) {
  const charge = event.data.object as Stripe.Charge

  // Find the payment by looking up the charge's payment intent
  const paymentIntent = charge.payment_intent as string
  if (!paymentIntent) return

  // Find the original payment via invoice or checkout session
  // For subscriptions, we track via stripeEventId on the original payment
  // For refunds, we create a new payment record with negative amount

  type SubscriptionWithCreator = Awaited<ReturnType<typeof db.subscription.findFirst<{
    include: { creator: { include: { profile: { select: { purpose: true; countryCode: true } } } } }
  }>>>

  let subscription: SubscriptionWithCreator = null

  // FIXED: Look up subscription by Stripe subscription ID (not customer ID)
  // This prevents matching the wrong subscription when a customer has multiple
  // Access invoice from charge metadata (Stripe types vary by API version)
  const invoiceId = (charge as any).invoice as string | null

  if (invoiceId) {
    // Charge is from an invoice (subscription payment)
    // Get the subscription ID from the invoice
    try {
      const invoice = await stripe.invoices.retrieve(invoiceId)
      // Stripe API types vary by version - access subscription via any cast
      const invoiceData = invoice as any
      const stripeSubscriptionId = typeof invoiceData.subscription === 'string'
        ? invoiceData.subscription
        : invoiceData.subscription?.id || null

      if (stripeSubscriptionId) {
        subscription = await db.subscription.findFirst({
          where: { stripeSubscriptionId },
          include: {
            creator: {
              include: { profile: { select: { purpose: true, countryCode: true } } },
            },
          },
        })
      }
    } catch (err) {
      console.error('[stripe] Failed to retrieve invoice for refund:', err)
    }
  }

  // Fallback: look up by customer ID (for one-time payments or if invoice lookup failed)
  if (!subscription) {
    const stripeCustomerId = charge.customer as string
    if (stripeCustomerId) {
      subscription = await db.subscription.findFirst({
        where: { stripeCustomerId },
        orderBy: { createdAt: 'desc' },
        include: {
          creator: {
            include: { profile: { select: { purpose: true, countryCode: true } } },
          },
        },
      })
    }
  }

  if (!subscription) {
    console.log('No subscription found for refunded charge')
    return
  }

  const refundAmount = charge.amount_refunded

  // Find the original payment to get correct fee ratio
  // This ensures refunds use the same fee calculation as the original payment
  const originalPayment = await db.payment.findFirst({
    where: {
      subscriptionId: subscription.id,
      stripeChargeId: charge.id,
      status: 'succeeded',
    },
  })

  let feeCents: number
  let netCents: number
  let creatorFeeCents: number | null = null
  let subscriberFeeCents: number | null = null

  if (originalPayment && originalPayment.grossCents && originalPayment.grossCents > 0) {
    // Use the original payment's fee ratio for accurate refund calculation
    // This handles both absorb and pass_to_subscriber modes correctly
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
  } else if (subscription.feeModel) {
    // Fallback: recalculate if original payment not found (shouldn't happen)
    // Note: This may be inaccurate for pass_to_subscriber mode
    console.warn(`[refund] Original payment not found for charge ${charge.id}, recalculating fees`)
    const creatorPurpose = subscription.creator?.profile?.purpose

    // Check cross-border status for correct fee buffer
    const countryCode = subscription.creator?.profile?.countryCode
    const isCrossBorder = countryCode ? isStripeCrossBorderSupported(countryCode) : false

    const feeCalc = calculateServiceFee(refundAmount, charge.currency.toUpperCase(), creatorPurpose, 'pass_to_subscriber', isCrossBorder)
    feeCents = feeCalc.feeCents
    netCents = refundAmount - feeCalc.feeCents

    // For split_v1, estimate fee split
    if (subscription.feeModel === 'split_v1') {
      creatorFeeCents = feeCalc.creatorFeeCents || Math.round(feeCents / 2)
      subscriberFeeCents = feeCalc.subscriberFeeCents || (feeCents - creatorFeeCents)
    }
  } else {
    // Legacy model: fee based on creator's purpose
    const creatorPurpose = subscription.creator?.profile?.purpose as 'personal' | 'service' | null
    const legacyFees = calculateLegacyFee(refundAmount, creatorPurpose, charge.currency.toUpperCase())
    feeCents = legacyFees.feeCents
    netCents = legacyFees.netCents
  }

  // Calculate reporting currency fields using original payment's rate (if available)
  // This ensures refunds cancel out the original payment exactly in USD terms
  // Fall back to current rate if original payment has no reporting data
  const refundCurrency = charge.currency.toUpperCase()
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

  if (originalPayment?.reportingExchangeRate && originalPayment.reportingCurrency) {
    // Use original payment's rate for exact cancellation
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
    // Fall back to current rate (original payment has no reporting data)
    const rate = isUSD ? 1 : await getUSDRate(refundCurrency)
    reportingData = {
      reportingCurrency: 'USD',
      reportingGrossCents: isUSD ? -refundAmount : -convertLocalCentsToUSD(refundAmount, rate),
      reportingFeeCents: isUSD ? -feeCents : -convertLocalCentsToUSD(feeCents, rate),
      reportingNetCents: isUSD ? -netCents : -convertLocalCentsToUSD(netCents, rate),
      reportingExchangeRate: rate,
      reportingRateSource: 'current_rate',
      reportingRateTimestamp: new Date(),
      reportingIsEstimated: !isUSD, // Non-USD payments use estimated rate
    }
  }

  // Create refund payment record with split fee fields
  await db.payment.create({
    data: {
      subscriptionId: subscription.id,
      creatorId: subscription.creatorId,
      subscriberId: subscription.subscriberId,
      amountCents: -refundAmount, // Negative for refund
      currency: refundCurrency,
      feeCents: -feeCents, // Reverse the fee
      netCents: -netCents,
      creatorFeeCents: creatorFeeCents !== null ? -creatorFeeCents : null,
      subscriberFeeCents: subscriberFeeCents !== null ? -subscriberFeeCents : null,
      feeModel: subscription.feeModel,
      type: subscription.interval === 'month' ? 'recurring' : 'one_time',
      status: 'refunded',
      stripeEventId: event.id,
      // Reporting currency (always set - uses original rate or current fallback)
      ...reportingData,
    },
  })

  // Update subscription LTV (decrement by net amount, not gross)
  // LTV tracks creator's earnings, so we reverse the net portion
  // IMPORTANT: Prevent negative LTV - only decrement up to current LTV
  const currentLtv = subscription.ltvCents || 0
  const decrementAmount = Math.min(netCents, currentLtv)

  if (decrementAmount > 0) {
    await db.subscription.update({
      where: { id: subscription.id },
      data: {
        ltvCents: { decrement: decrementAmount },
      },
    })
  }

  // Create activity event
  await db.activity.create({
    data: {
      userId: subscription.creatorId,
      type: 'payment_refunded',
      payload: {
        subscriptionId: subscription.id,
        amount: refundAmount,
        currency: charge.currency,
        reason: charge.refunds?.data[0]?.reason || 'requested_by_customer',
      },
    },
  })
}

// Handle payment_intent.payment_failed - when a payment attempt fails
export async function handlePaymentIntentFailed(event: Stripe.Event) {
  const paymentIntent = event.data.object as Stripe.PaymentIntent

  const creatorId = paymentIntent.metadata?.creatorId
  if (!creatorId) {
    console.log('[payment_intent.payment_failed] No creatorId in metadata')
    return
  }

  // Get failure details
  const lastError = paymentIntent.last_payment_error
  const failureReason = lastError?.message || lastError?.code || 'Unknown error'

  // Create activity event
  await db.activity.create({
    data: {
      userId: creatorId,
      type: 'payment_failed',
      payload: {
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        failureCode: lastError?.code,
        failureMessage: failureReason,
        customerEmail: paymentIntent.receipt_email,
      },
    },
  })

  console.log(`[payment_intent.payment_failed] Payment failed for creator ${creatorId}: ${failureReason}`)
}
