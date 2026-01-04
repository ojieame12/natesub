import Stripe from 'stripe'
import { stripe, setSubscriptionDefaultFee, getChargeFxData } from '../../../services/stripe.js'
import { db } from '../../../db/client.js'
import { sendNewSubscriberEmail, sendSubscriptionConfirmationEmail, sendPlatformDebitRecoveredNotification } from '../../../services/email.js'
import { cancelAllRemindersForEntity } from '../../../jobs/reminders.js'
import { calculateLegacyFee } from '../../../services/fees.js'
import { withLock } from '../../../services/lock.js'
import {
  validateCheckoutMetadata,
  parseMetadataAmount,
} from '../../../utils/webhookValidation.js'
import { normalizeEmailAddress } from '../utils.js'
import { invalidateAdminRevenueCache } from '../../../utils/cache.js'
import { getReportingCurrencyData } from '../../../services/fx.js'
import { generateManageUrl, generateExpressDashboardUrl } from '../../../utils/cancelToken.js'
import { logger } from '../../../utils/logger.js'

async function resolveStripeCheckoutCustomer(session: Stripe.Checkout.Session): Promise<{ email: string; name: string | null }> {
  const directEmail = session.customer_details?.email || session.customer_email || null
  const directName = session.customer_details?.name || null

  if (directEmail) {
    return { email: normalizeEmailAddress(directEmail), name: directName }
  }

  const customerId = typeof session.customer === 'string' ? session.customer : null
  if (customerId) {
    try {
      const customer = await stripe.customers.retrieve(customerId)
      if (!('deleted' in customer && customer.deleted)) {
        const email = customer.email || null
        const name = customer.name || null
        if (email) {
          return { email: normalizeEmailAddress(email), name: directName || name }
        }
      }
    } catch (err) {
      logger.error('Failed to retrieve customer for session', err as Error, { sessionId: session.id })
    }
  }

  throw new Error(`[stripe][checkout] Missing customer email for session ${session.id}`)
}

// Handle checkout.session.completed
export async function handleCheckoutCompleted(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session

  // IMPORTANT: Check payment_status before processing
  // For async payment methods (bank transfers, etc), payment_status can be 'unpaid'
  const isAsyncPayment = session.payment_status !== 'paid'
  const isSubscriptionMode = session.mode === 'subscription'

  // For ONE-TIME payments with async payment: defer to checkout.session.async_payment_succeeded
  // For SUBSCRIPTIONS with async payment: create subscription record now, invoice.paid will create payment
  if (isAsyncPayment && !isSubscriptionMode) {
    logger.debug('Skipping one-time session with pending payment', { sessionId: session.id, paymentStatus: session.payment_status })
    return
  }

  if (isAsyncPayment && isSubscriptionMode) {
    logger.info('Creating subscription record for async payment session', { sessionId: session.id })
    // Continue processing to create subscription record, but skip payment creation
  }

  // Validate webhook metadata - provider signature already verified, this validates data integrity
  const metadataValidation = validateCheckoutMetadata(session.metadata as Record<string, string>)
  if (!metadataValidation.valid) {
    logger.error('Invalid metadata for session', null, { sessionId: session.id, error: metadataValidation.error })
    throw new Error(`Invalid metadata: ${metadataValidation.error}`)
  }

  const validatedMeta = metadataValidation.data!
  const creatorId = validatedMeta.creatorId
  const tierId = validatedMeta.tierId
  const requestId = validatedMeta.requestId
  const viewId = validatedMeta.viewId

  // Fee metadata from validated schema
  const feeModel = validatedMeta.feeModel || null
  const feeMode = validatedMeta.feeMode || 'split' // Default to split for new subscriptions
  const netAmount = parseMetadataAmount(validatedMeta.netAmount)
  const serviceFee = parseMetadataAmount(validatedMeta.serviceFee)
  const feeEffectiveRate = validatedMeta.feeEffectiveRate ? parseFloat(validatedMeta.feeEffectiveRate) : null
  const feeWasCapped = validatedMeta.feeWasCapped === 'true'

  // Split fee fields (v2 model)
  const subscriberFeeCents = parseMetadataAmount(validatedMeta.subscriberFeeCents)
  const creatorFeeCents = parseMetadataAmount(validatedMeta.creatorFeeCents)
  const baseAmountCents = parseMetadataAmount(validatedMeta.baseAmountCents)

  // Platform debit recovery (for service providers with lapsed platform subscription)
  const platformDebitRecovered = parseMetadataAmount(validatedMeta.platformDebitRecovered)

  // Dispute evidence metadata (for chargeback defense)
  const checkoutIp = validatedMeta.checkoutIp || null
  const checkoutUserAgent = validatedMeta.checkoutUserAgent || null
  const checkoutAcceptLanguage = validatedMeta.checkoutAcceptLanguage || null

  // Log with sanitized values for audit trail
  logger.info('Processing checkout session', { sessionId: session.id, creatorId })

  // Server-side conversion tracking (more reliable than client-side)
  // IMPORTANT: Only mark as completed if payment actually succeeded
  // For async payment subscriptions, invoice.paid will handle this
  if (!isAsyncPayment && viewId) {
    // Only update the specific view that was passed - no fallback to avoid overcounting
    await db.pageView.update({
      where: { id: viewId },
      data: { startedCheckout: true, completedCheckout: true },
    }).catch(() => { }) // Ignore if view doesn't exist
  }

  // If this checkout was triggered by a request, finalize it
  // IMPORTANT: Only mark as accepted if payment actually succeeded
  // For async payment subscriptions, invoice.paid will handle this
  if (requestId && !isAsyncPayment) {
    await db.request.update({
      where: { id: requestId },
      data: {
        status: 'accepted',
        respondedAt: new Date(),
      },
    })

    // Cancel any scheduled reminders for this request
    await cancelAllRemindersForEntity({
      entityType: 'request',
      entityId: requestId,
    })

    // Get request details for activity logging
    const request = await db.request.findUnique({ where: { id: requestId } })
    if (request) {
      await db.activity.create({
        data: {
          userId: creatorId,
          type: 'request_accepted',
          payload: {
            requestId: request.id,
            recipientName: request.recipientName,
            amount: request.amountCents,
            provider: 'stripe',
          },
        },
      })
    }
  }

  const { email: subscriberEmail, name: subscriberName } = await resolveStripeCheckoutCustomer(session)

  // Get or create subscriber user (normalize email to match auth flow)
  let subscriber = await db.user.findUnique({ where: { email: subscriberEmail } })
  if (!subscriber) {
    try {
      subscriber = await db.user.create({ data: { email: subscriberEmail } })
    } catch {
      // Race-safe fallback (unique email)
      subscriber = await db.user.findUnique({ where: { email: subscriberEmail } })
    }
  }
  if (!subscriber) {
    throw new Error(`[stripe][checkout] Could not find or create subscriber for session ${session.id}`)
  }

  // Get creator profile for tier info
  const creatorProfile = await db.profile.findUnique({
    where: { userId: creatorId },
  })

  let tierName: string | null = null
  if (tierId && creatorProfile?.tiers) {
    const tiers = creatorProfile.tiers as any[]
    const tier = tiers.find(t => t.id === tierId)
    tierName = tier?.name || null
  }

  // Calculate fees - use new model if metadata present, else fallback to legacy
  let feeCents: number
  let netCents: number
  let grossCents: number | null = null
  let basePrice: number  // Creator's set price - this is what fees are calculated on for renewals
  let subFeeCents: number | null = null
  let creatorFee: number | null = null

  // Check if new fee model is in use (netAmount and serviceFee are set via validated metadata)
  const hasNewFeeModel = feeModel && netAmount > 0

  if ((feeModel === 'split_v1' || feeModel === 'direct_v1') && hasNewFeeModel) {
    // split_v1: Destination charges with split fee (4.5%/4.5% domestic, 5.25%/5.25% cross-border)
    // direct_v1: Unused legacy - kept for backward compatibility only
    grossCents = session.amount_total || 0  // Total subscriber paid
    feeCents = serviceFee                    // Platform fee (9% domestic, 10.5% cross-border)
    netCents = netAmount                     // What creator receives
    subFeeCents = subscriberFeeCents || null
    creatorFee = creatorFeeCents || null
    basePrice = baseAmountCents || netCents  // Creator's set price
  } else if (feeModel === 'flat' && hasNewFeeModel) {
    // Legacy flat fee model with feeMode (absorb or pass_to_subscriber)
    grossCents = session.amount_total || 0  // Total subscriber paid
    feeCents = serviceFee
    netCents = netAmount  // What creator receives (depends on feeMode)

    // CRITICAL: Store creator's set price for renewal fee calculation
    // In absorb mode: creator sets price = what subscriber pays (gross)
    // In pass_to_subscriber mode: creator sets price = what they receive (net)
    basePrice = feeMode === 'absorb' ? grossCents : netCents
  } else if (feeModel?.startsWith('progressive') && hasNewFeeModel) {
    // Legacy progressive model (backward compatibility)
    grossCents = session.amount_total || 0
    feeCents = serviceFee
    netCents = netAmount
    basePrice = feeMode === 'absorb' ? grossCents : netCents
  } else {
    // Legacy model: fee deducted from creator's earnings (no feeMode)
    const purpose = creatorProfile?.purpose as 'personal' | 'service' | null
    const legacyFees = calculateLegacyFee(session.amount_total || 0, purpose, session.currency?.toUpperCase() || 'USD')
    feeCents = legacyFees.feeCents
    netCents = legacyFees.netCents
    basePrice = session.amount_total || 0  // Legacy used gross as base
  }

  // Use transaction to ensure atomic creation/update of subscription + payment + activity
  // isSubscriptionMode is already defined at the top of the function
  const subscriptionInterval = isSubscriptionMode ? 'month' : 'one_time'

  // DISTRIBUTED LOCK: Prevent race conditions when processing concurrent webhooks
  // Lock key based on subscriber email + creator to prevent duplicate subscriptions
  const lockKey = `sub:${subscriber.id}:${creatorId}:${subscriptionInterval}`
  const subscription = await withLock(lockKey, 30000, async () => {
    return await db.$transaction(async (tx) => {
      // UPSERT subscription to handle resubscribe scenarios
      // Uniqueness constraint: subscriberId_creatorId_interval
      // This allows a subscriber to resubscribe after cancellation
      const newSubscription = await tx.subscription.upsert({
        where: {
          subscriberId_creatorId_interval: {
            subscriberId: subscriber.id,
            creatorId,
            interval: subscriptionInterval,
          },
        },
        create: {
          creatorId,
          subscriberId: subscriber.id,
          tierId: tierId || null,
          tierName,
          amount: basePrice, // Creator's SET PRICE - fees calculated on this for renewals
          currency: session.currency?.toUpperCase() || 'USD',
          interval: subscriptionInterval,
          // Use 'pending' for async payments until payment confirms
          status: isAsyncPayment ? 'pending' : 'active',
          stripeSubscriptionId: session.subscription as string || null,
          stripeCustomerId: session.customer as string || null,
          feeModel: feeModel || null,
          feeMode: feeMode || null,
          // Store async payment follow-up data for invoice.paid to complete
          asyncViewId: isAsyncPayment ? (viewId || null) : null,
          asyncRequestId: isAsyncPayment ? (requestId || null) : null,
        },
        update: {
          // Reactivate subscription with new details
          // Use 'pending' for async payments until payment confirms
          status: isAsyncPayment ? 'pending' : 'active',
          tierId: tierId || null,
          tierName,
          amount: basePrice,
          stripeSubscriptionId: session.subscription as string || null,
          stripeCustomerId: session.customer as string || null,
          feeModel: feeModel || null,
          feeMode: feeMode || null,
          canceledAt: null, // Clear cancellation
          cancelAtPeriodEnd: false,
          // Store async payment follow-up data for invoice.paid to complete
          asyncViewId: isAsyncPayment ? (viewId || null) : null,
          asyncRequestId: isAsyncPayment ? (requestId || null) : null,
        },
      })

      // For SUBSCRIPTIONS: Don't create payment here - invoice.paid handles it
      // This prevents double-counting the first payment
      // For ONE-TIME payments: Create payment record here
      let oneTimePaymentId: string | null = null
      if (!isSubscriptionMode) {
        // Get charge ID from payment intent if available
        let stripeChargeId: string | null = null
        if (session.payment_intent) {
          try {
            const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent as string)
            stripeChargeId = paymentIntent.latest_charge as string || null
          } catch (err) {
            logger.warn('Could not retrieve payment intent for charge ID', { sessionId: session.id, error: (err as Error).message })
          }
        }

        // Create payment record for one-time payments only
        const oneTimePayment = await tx.payment.create({
          data: {
            subscriptionId: newSubscription.id,
            creatorId,
            subscriberId: subscriber.id,
            grossCents: grossCents,
            amountCents: grossCents || session.amount_total || 0,
            currency: session.currency?.toUpperCase() || 'USD',
            feeCents,
            netCents,
            subscriberFeeCents: subFeeCents,   // Split fee: subscriber's portion
            creatorFeeCents: creatorFee,       // Split fee: creator's portion
            feeModel: feeModel || null,
            feeEffectiveRate: feeEffectiveRate,
            feeWasCapped: feeWasCapped,
            platformDebitRecoveredCents: platformDebitRecovered, // Track debit recovery
            type: 'one_time',
            status: 'succeeded',
            stripeEventId: event.id,
            stripePaymentIntentId: session.payment_intent as string || null,
            stripeChargeId,
          },
        })
        oneTimePaymentId = oneTimePayment.id

        // Create dispute evidence record for chargeback defense
        if (checkoutIp || checkoutUserAgent) {
          await tx.disputeEvidence.create({
            data: {
              paymentId: oneTimePayment.id,
              checkoutIp,
              checkoutUserAgent,
              checkoutAcceptLanguage,
              checkoutTimestamp: new Date(),
              confirmationEmailSent: true, // We send confirmation email below
            },
          }).catch((err: any) => {
            // Non-fatal - don't fail the payment if evidence can't be saved
            logger.warn('Failed to create dispute evidence', { error: err.message })
          })
        }

        // Clear platform debit if recovered from this payment
        if (platformDebitRecovered > 0) {
          await tx.profile.update({
            where: { userId: creatorId },
            data: {
              platformDebitCents: { decrement: platformDebitRecovered },
            },
          })

          // Create activity for audit trail
          await tx.activity.create({
            data: {
              userId: creatorId,
              type: 'platform_debit_recovered',
              payload: {
                amountCents: platformDebitRecovered,
                source: 'stripe_one_time_payment',
                paymentIntentId: session.payment_intent as string || null,
              },
            },
          })

          logger.info('Recovered platform debit from creator', { creatorId, amountCents: platformDebitRecovered })
        }
      }

      // Create activity event
      // IMPORTANT: Show NET amount (what creator receives), not gross
      // For subscriptions: paymentId is null here (invoice.paid creates the payment later)
      // For one-time: paymentId is set above
      await tx.activity.create({
        data: {
          userId: creatorId,
          type: 'subscription_created',
          payload: {
            subscriptionId: newSubscription.id,
            paymentId: oneTimePaymentId,  // Only set for one-time payments (subscriptions get it from invoice.paid)
            subscriberEmail,
            subscriberName,
            tierName,
            amount: netCents,           // NET - what creator receives after fees
            grossAmount: grossCents,    // GROSS - what subscriber paid (for reference)
            feeCents,                   // Platform fee taken
            currency: session.currency,
            provider: 'stripe',         // Payment provider
          },
        },
      })

      return newSubscription
    })
  })

  // If lock couldn't be acquired, another process is handling this
  if (!subscription) {
    logger.debug('Lock not acquired, skipping', { lockKey })
    return
  }

  // For subscriptions with tracked fee model, set default fee metadata
  // This helps with invoice.created webhook to know expected fee amount
  if (session.subscription && feeModel && serviceFee) {
    try {
      await setSubscriptionDefaultFee(session.subscription as string, serviceFee)
    } catch (err) {
      // Non-fatal: log but continue
      logger.error('Failed to set default fee on subscription', err as Error, { subscriptionId: session.subscription as string })
    }
  }

  // Send notification email to creator
  const creator = await db.user.findUnique({
    where: { id: creatorId },
    include: { profile: { select: { displayName: true, username: true, platformDebitCents: true, stripeAccountId: true } } },
  })
  if (creator) {
    // Generate dashboard URL for Stripe Express users
    const dashboardUrl = creator.profile?.stripeAccountId
      ? generateExpressDashboardUrl(creator.profile.stripeAccountId)
      : undefined

    // Send creator their NET amount (what they earn after fees)
    await sendNewSubscriberEmail(
      creator.email,
      subscriberName || subscriberEmail || 'Someone',
      tierName,
      netCents,  // NET - what creator receives after platform fees
      session.currency?.toUpperCase() || 'USD',
      creatorId,
      dashboardUrl
    )

    // Send confirmation email to subscriber with manage page link (no login required)
    if (subscriberEmail) {
      try {
        // Generate manage URL for our branded subscription management page
        const manageUrl = subscription
          ? generateManageUrl(subscription.id)
          : undefined

        await sendSubscriptionConfirmationEmail(
          subscriberEmail,
          subscriberName || 'there',
          creator.profile?.displayName || creator.email,
          creator.profile?.username || '',
          tierName,
          session.amount_total || 0,
          session.currency?.toUpperCase() || 'USD',
          manageUrl
        )
      } catch (emailErr) {
        logger.error('Failed to send subscriber confirmation email', emailErr as Error, { creatorId })
      }
    }

    // Send debit recovery email if we recovered any debit
    if (platformDebitRecovered > 0) {
      const remainingDebit = creator.profile?.platformDebitCents || 0
      try {
        await sendPlatformDebitRecoveredNotification(
          creator.email,
          creator.profile?.displayName || 'there',
          platformDebitRecovered,
          remainingDebit
        )
      } catch (emailErr) {
        logger.error('Failed to send debit recovery email', emailErr as Error, { creatorId })
      }
    }
  }
}

/**
 * Handle checkout.session.async_payment_succeeded
 *
 * This fires for payment methods that don't complete immediately
 * (e.g., bank transfers, SEPA, Boleto, OXXO, etc.)
 *
 * When checkout.session.completed fires with payment_status='unpaid',
 * we skip processing. This handler processes when payment actually succeeds.
 */
export async function handleAsyncPaymentSucceeded(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session

  logger.info('Processing async payment succeeded', { sessionId: session.id })

  // For subscriptions, invoice.paid handles the payment
  // This handler is primarily for one-time payments with async methods
  if (session.mode === 'subscription') {
    logger.debug('Subscription mode - invoice.paid will handle payment', { sessionId: session.id })
    return
  }

  // Validate webhook metadata
  const metadataValidation = validateCheckoutMetadata(session.metadata as Record<string, string>)
  if (!metadataValidation.valid) {
    logger.error('Invalid metadata for async payment session', null, { sessionId: session.id, error: metadataValidation.error })
    throw new Error(`Invalid metadata: ${metadataValidation.error}`)
  }

  const validatedMeta = metadataValidation.data!
  const creatorId = validatedMeta.creatorId
  const tierId = validatedMeta.tierId
  const viewId = validatedMeta.viewId
  const requestId = validatedMeta.requestId

  // Fee metadata from validated schema
  const feeModel = validatedMeta.feeModel || null
  const feeMode = validatedMeta.feeMode || 'split' // Default to split for new subscriptions
  const netAmount = parseMetadataAmount(validatedMeta.netAmount)
  const serviceFee = parseMetadataAmount(validatedMeta.serviceFee)
  const feeEffectiveRate = validatedMeta.feeEffectiveRate ? parseFloat(validatedMeta.feeEffectiveRate) : null
  const feeWasCapped = validatedMeta.feeWasCapped === 'true'

  // Split fee fields (v2 model)
  const subscriberFeeCents = parseMetadataAmount(validatedMeta.subscriberFeeCents)
  const creatorFeeCents = parseMetadataAmount(validatedMeta.creatorFeeCents)
  const baseAmountCents = parseMetadataAmount(validatedMeta.baseAmountCents)

  logger.info('Processing async payment session for creator', { sessionId: session.id, creatorId })

  // Conversion tracking
  if (viewId) {
    await db.pageView.update({
      where: { id: viewId },
      data: { startedCheckout: true, completedCheckout: true },
    }).catch(() => { })
  }

  // If this checkout was triggered by a request, finalize it
  if (requestId) {
    await db.request.update({
      where: { id: requestId },
      data: {
        status: 'accepted',
        respondedAt: new Date(),
      },
    }).catch(() => { }) // Ignore if request doesn't exist

    // Get request details for activity logging
    const request = await db.request.findUnique({ where: { id: requestId } })
    if (request) {
      await db.activity.create({
        data: {
          userId: creatorId,
          type: 'request_accepted',
          payload: {
            requestId: request.id,
            recipientName: request.recipientName,
            amount: request.amountCents,
            asyncPayment: true,
            provider: 'stripe',
          },
        },
      })
    }
  }

  const { email: subscriberEmail, name: subscriberName } = await resolveStripeCheckoutCustomer(session)

  // Get or create subscriber (normalize email to match auth flow)
  let subscriber = await db.user.findUnique({ where: { email: subscriberEmail } })
  if (!subscriber) {
    try {
      subscriber = await db.user.create({ data: { email: subscriberEmail } })
    } catch {
      subscriber = await db.user.findUnique({ where: { email: subscriberEmail } })
    }
  }
  if (!subscriber) {
    throw new Error(`[stripe][async_payment_succeeded] Could not find or create subscriber for session ${session.id}`)
  }

  // Get tier info
  const creatorProfile = await db.profile.findUnique({
    where: { userId: creatorId },
    select: { tiers: true, purpose: true },
  })

  let tierName: string | null = null
  if (tierId && creatorProfile?.tiers) {
    const tiers = creatorProfile.tiers as any[]
    const tier = tiers.find(t => t.id === tierId)
    tierName = tier?.name || null
  }

  // Calculate fees
  let feeCents: number
  let netCents: number
  let grossCents: number | null = null
  let subFeeCents: number | null = null
  let creatorFee: number | null = null
  let basePrice: number  // Creator's set price - consistent with sync path

  const amountTotal = session.amount_total || 0
  const hasNewFeeModel = feeModel && netAmount > 0
  if ((feeModel === 'split_v1' || feeModel === 'direct_v1') && hasNewFeeModel) {
    // split_v1: Destination charges with split fee (4.5%/4.5% domestic, 5.25%/5.25% cross-border)
    // direct_v1: Unused legacy - kept for backward compatibility only
    grossCents = amountTotal
    feeCents = serviceFee
    netCents = netAmount
    subFeeCents = subscriberFeeCents || null
    creatorFee = creatorFeeCents || null
    // Robust fallback: baseAmountCents → gross → net (handles missing metadata)
    basePrice = baseAmountCents || grossCents || netCents
  } else if (hasNewFeeModel) {
    // Legacy fee models (flat, progressive)
    grossCents = amountTotal
    feeCents = serviceFee
    netCents = netAmount
    // CRITICAL: Store creator's set price for consistency
    // Absorb mode: creator sets gross price; Pass mode: creator sets net price
    // Fallback chain handles missing baseAmountCents gracefully
    basePrice = baseAmountCents || (feeMode === 'absorb' ? grossCents : netCents)
  } else {
    // Legacy model (no fee metadata) - use gross as base
    const purpose = creatorProfile?.purpose as 'personal' | 'service' | null
    const legacyFees = calculateLegacyFee(amountTotal, purpose, session.currency?.toUpperCase() || 'USD')
    feeCents = legacyFees.feeCents
    netCents = legacyFees.netCents
    grossCents = amountTotal
    basePrice = baseAmountCents || amountTotal || netCents
  }

  // Create or update one-time subscription record (upsert to handle repeat payments)
  const subscription = await db.subscription.upsert({
    where: {
      subscriberId_creatorId_interval: {
        subscriberId: subscriber.id,
        creatorId,
        interval: 'one_time',
      },
    },
    create: {
      creatorId,
      subscriberId: subscriber.id,
      tierId: tierId || null,
      tierName,
      amount: basePrice,  // Creator's set price (consistent with sync path)
      currency: session.currency?.toUpperCase() || 'USD',
      interval: 'one_time',
      status: 'active',
      ltvCents: netCents, // LTV tracks actual earnings (net)
      stripeCustomerId: session.customer as string || null,
      feeModel: feeModel || null,
      feeMode: feeMode || null,
    },
    update: {
      tierId: tierId || null,
      tierName,
      amount: basePrice,  // Creator's set price (consistent with sync path)
      stripeCustomerId: session.customer as string || null,
      ltvCents: { increment: netCents }, // LTV tracks actual earnings (net)
    },
  })

  // Get charge ID from payment intent
  let stripeChargeId: string | null = null
  if (session.payment_intent) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent as string)
      stripeChargeId = typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id || null
    } catch {
      // Ignore - charge ID is optional
    }
  }

  // Get reporting currency data (USD conversion) for admin dashboard
  const currency = session.currency?.toUpperCase() || 'USD'
  const reportingData = await getReportingCurrencyData(grossCents, feeCents, netCents, currency)

  // Create payment record
  const checkoutPayment = await db.payment.create({
    data: {
      subscriptionId: subscription.id,
      creatorId,
      subscriberId: subscriber.id,
      grossCents,
      amountCents: session.amount_total || 0,
      currency,
      feeCents,
      netCents,
      subscriberFeeCents: subFeeCents,   // Split fee: subscriber's portion
      creatorFeeCents: creatorFee,       // Split fee: creator's portion
      feeModel: feeModel || null,
      feeEffectiveRate,
      feeWasCapped,
      type: 'one_time',
      status: 'succeeded',
      stripeEventId: event.id,
      stripePaymentIntentId: session.payment_intent as string || null,
      stripeChargeId,
      // Reporting currency fields (USD normalized)
      ...reportingData,
    },
  })

  // Fetch FX data for cross-border payments (e.g., USD → NGN)
  // Do this async after payment creation so it doesn't block the main flow
  // Note: Transfer may not exist yet at webhook time - that's OK, activity.ts will backfill on-demand
  if (stripeChargeId) {
    db.profile.findUnique({
      where: { userId: creatorId },
      select: { stripeAccountId: true },
    }).then(async (profile) => {
      if (profile?.stripeAccountId) {
        // All countries use destination charges - charge lives on platform, transfer to connected account
        const result = await getChargeFxData(stripeChargeId, profile.stripeAccountId)

        if (result.status === 'fx_found') {
          await db.payment.update({
            where: { id: checkoutPayment.id },
            data: {
              payoutCurrency: result.data.payoutCurrency,
              payoutAmountCents: result.data.payoutAmountCents,
              exchangeRate: result.data.exchangeRate,
            },
          })
          logger.info('Stored FX data for payment', { paymentId: checkoutPayment.id, chargeType, originalCurrency: result.data.originalCurrency, payoutCurrency: result.data.payoutCurrency, exchangeRate: result.data.exchangeRate })
        } else {
          // pending/no_fx/error - activity.ts will handle on-demand backfill
          logger.debug('FX lookup status', { paymentId: checkoutPayment.id, chargeType, status: result.status })
        }
      }
    }).catch((err) => {
      logger.warn('Could not fetch FX data for payment', { paymentId: checkoutPayment.id, error: err.message })
    })
  }

  // Invalidate admin revenue cache to ensure fresh dashboard data
  await invalidateAdminRevenueCache()

  // Create activity
  // IMPORTANT: Show NET amount (what creator receives), not gross
  await db.activity.create({
    data: {
      userId: creatorId,
      type: 'subscription_created',
      payload: {
        subscriptionId: subscription.id,
        subscriberEmail,
        tierName,
        amount: netCents,            // NET - what creator receives after fees
        grossAmount: grossCents,     // GROSS - what subscriber paid (for reference)
        feeCents,                    // Platform fee taken
        currency: session.currency,
        asyncPayment: true,
        provider: 'stripe',
      },
    },
  })

  // Send notification email to creator with NET amount (what they earn)
  const creator = await db.user.findUnique({
    where: { id: creatorId },
    include: { profile: { select: { stripeAccountId: true } } },
  })
  if (creator) {
    // Generate dashboard URL for Stripe Express users
    const dashboardUrl = creator.profile?.stripeAccountId
      ? generateExpressDashboardUrl(creator.profile.stripeAccountId)
      : undefined

    await sendNewSubscriberEmail(
      creator.email,
      subscriberName || subscriberEmail || 'Someone',
      tierName,
      netCents,  // NET - what creator receives after platform fees
      session.currency?.toUpperCase() || 'USD',
      creatorId,
      dashboardUrl
    )
  }

  // SALARY MODE: Track successful payments for unlock gate
  // Only count real payments (amount > 0), not $0 trials
  const paymentAmount = session.amount_total || 0
  if (paymentAmount > 0) {
    // Atomically increment counter and get new value
    const updatedProfile = await db.profile.update({
      where: { userId: creatorId },
      data: { totalSuccessfulPayments: { increment: 1 } },
      select: { totalSuccessfulPayments: true, paydayAlignmentUnlocked: true },
    })

    // Check if we should unlock (2+ payments AND not already unlocked)
    if (updatedProfile.totalSuccessfulPayments >= 2 && !updatedProfile.paydayAlignmentUnlocked) {
      // Atomic unlock: only update if still locked (prevents duplicate activities)
      const unlockResult = await db.profile.updateMany({
        where: {
          userId: creatorId,
          paydayAlignmentUnlocked: false, // Only unlock if still locked
        },
        data: { paydayAlignmentUnlocked: true },
      })

      // Only create activity if we actually unlocked (count > 0)
      if (unlockResult.count > 0) {
        logger.info('Unlocked Salary Mode for creator', { creatorId, successfulPayments: updatedProfile.totalSuccessfulPayments })
        await db.activity.create({
          data: {
            userId: creatorId,
            type: 'salary_mode_unlocked',
            payload: {
              successfulPayments: updatedProfile.totalSuccessfulPayments,
              message: 'You can now set a preferred payday for predictable monthly income.',
            },
          },
        })
      }
    }
  }

  logger.info('Created subscription for async payment', { subscriptionId: subscription.id })
}

// Handle checkout session expired (user abandoned payment)
export async function handleCheckoutExpired(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session

  const requestId = session.metadata?.requestId
  if (!requestId) return

  // Find the request by checkout session ID
  const request = await db.request.findFirst({
    where: {
      id: requestId,
      stripeCheckoutSessionId: session.id,
      status: 'pending_payment',
    },
  })

  if (!request) return

  // Revert request to 'sent' status so they can try again
  // Alternative: set to 'expired' if you want to track abandoned checkouts
  await db.request.update({
    where: { id: request.id },
    data: {
      status: 'sent',
      stripeCheckoutSessionId: null, // Clear the expired session
    },
  })

  logger.info('Checkout expired for request, reverted to sent status', { requestId })
}
