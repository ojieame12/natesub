import Stripe from 'stripe'
import { stripe, getChargeFxData } from '../../../services/stripe.js'
import { db } from '../../../db/client.js'
import { calculateServiceFee, calculateLegacyFee } from '../../../services/fees.js'
import { withLock } from '../../../services/lock.js'
import { sendPlatformDebitRecoveredNotification, sendNewSubscriberEmail } from '../../../services/email.js'
import { isStripeCrossBorderSupported } from '../../../utils/constants.js'
import {
  validateCheckoutMetadata,
  parseMetadataAmount,
  sanitizeForLog,
} from '../../../utils/webhookValidation.js'
import { normalizeEmailAddress } from '../utils.js'
import { invalidateAdminRevenueCache } from '../../../utils/cache.js'
import { scheduleSubscriptionRenewalReminders } from '../../../jobs/reminders.js'
import { getReportingCurrencyData } from '../../../services/fx.js'
import { logger } from '../../../utils/logger.js'

async function resolveStripeInvoiceCustomerEmail(invoice: Stripe.Invoice, context: string): Promise<string> {
  const anyInvoice = invoice as any
  const directEmail: string | undefined = anyInvoice.customer_email || anyInvoice.customerEmail
  if (directEmail) return normalizeEmailAddress(directEmail)

  const customerId = typeof invoice.customer === 'string' ? invoice.customer : null
  if (!customerId) {
    throw new Error(`[stripe][${context}] Missing invoice.customer`)
  }

  const customer = await stripe.customers.retrieve(customerId)
  if ('deleted' in customer && customer.deleted) {
    throw new Error(`[stripe][${context}] Customer deleted: ${sanitizeForLog(customerId)}`)
  }
  if (!customer.email) {
    throw new Error(`[stripe][${context}] Customer email missing: ${sanitizeForLog(customerId)}`)
  }
  return normalizeEmailAddress(customer.email)
}

/**
 * Handle invoice.created - Backup fee application for subscriptions
 *
 * Primary fee collection is via application_fee_percent on subscription_data.
 * This handler serves as a backup for:
 * - Legacy subscriptions created before application_fee_percent was added
 * - Edge cases where the percentage might need adjustment
 *
 * For draft/open invoices, we verify/apply the expected fee amount.
 */
export async function handleInvoiceCreated(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice

  // Only process draft/open invoices (we can still modify them)
  // Skip paid/void/uncollectible invoices - too late to apply fee
  if (invoice.status !== 'draft' && invoice.status !== 'open') {
    return
  }

  // Get subscription ID from invoice
  const stripeSubscriptionId = (invoice as any).subscription_details?.subscription
    || (invoice as any).subscription

  if (!stripeSubscriptionId) return

  // Find our subscription record
  const subscription = await db.subscription.findUnique({
    where: { stripeSubscriptionId: stripeSubscriptionId as string },
    include: {
      creator: {
        include: { profile: true },
      },
    },
  })

  if (!subscription) {
    logger.info('No subscription found for invoice.created', { stripeSubscriptionId })
    return
  }

  // Generate statement descriptor for ALL subscriptions (new and legacy)
  // Format: "NATEPAY* CREATORNAME" - helps prevent "I don't recognize this charge" disputes
  // Stripe limits: 22 chars max, uppercase, alphanumeric + some special chars
  let statementDescriptor: string | undefined
  const creatorName = subscription.creator?.profile?.displayName
  if (creatorName) {
    // Clean the name: remove special chars, uppercase, truncate
    const cleanName = creatorName
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, '')
      .trim()
      .substring(0, 12) // Leave room for "NATEPAY* " prefix (9 chars)
    if (cleanName.length > 0) {
      statementDescriptor = `NATEPAY* ${cleanName}`
    }
  }

  // Check if this subscription uses a tracked fee model
  // Both 'flat' and 'progressive' models need fee applied on invoices
  // because Stripe subscription_data doesn't support fixed application_fee_amount
  if (!subscription.feeModel) {
    // Legacy subscriptions without feeModel - only update statement descriptor if available
    if (statementDescriptor) {
      try {
        await stripe.invoices.update(invoice.id, {
          statement_descriptor: statementDescriptor,
        })
        logger.info('Set statement descriptor for legacy subscription', { subscriptionId: subscription.id, statementDescriptor })
      } catch (err) {
        logger.error('Failed to set statement descriptor for legacy invoice', err as Error, { invoiceId: invoice.id })
      }
    } else {
      logger.info('Skipping legacy subscription (no feeModel, no displayName)', { subscriptionId: subscription.id })
    }
    return
  }

  // For new model: calculate fee based on CREATOR'S PRICE (subscription.amount)
  // NOT invoice.amount_due which includes the fee already
  // subscription.amount stores the creator's price, fees are added on top
  const creatorAmount = subscription.amount
  const currency = invoice.currency.toUpperCase()
  const creatorPurpose = subscription.creator?.profile?.purpose

  // Check cross-border status for correct fee buffer
  const countryCode = subscription.creator?.profile?.countryCode
  const isCrossBorder = countryCode ? isStripeCrossBorderSupported(countryCode) : false

  // Use split model for new subscriptions, legacy mode for old ones
  const feeCalc = calculateServiceFee(
    creatorAmount,
    currency,
    creatorPurpose,
    subscription.feeMode as any, // Pass stored feeMode for legacy subscriptions, ignored for split_v1
    isCrossBorder
  )

  // Update the invoice with the application fee and statement descriptor
  // This must be done before the invoice is finalized
  try {
    await stripe.invoices.update(invoice.id, {
      application_fee_amount: feeCalc.feeCents,
      // Statement descriptor for bank statement clarity - reduces chargebacks
      ...(statementDescriptor && { statement_descriptor: statementDescriptor }),
    })

    logger.info('Applied fee to invoice', {
      invoiceId: invoice.id,
      feeCents: feeCalc.feeCents,
      effectiveRate: (feeCalc.effectiveRate * 100).toFixed(2) + '%',
      creatorAmount,
      statementDescriptor,
    })
  } catch (err) {
    // If we can't update (e.g., invoice already finalized), log but don't fail
    logger.error('Failed to apply fee to invoice', err as Error, { invoiceId: invoice.id })
  }
}

export async function backfillStripeSubscriptionForInvoicePaid(invoice: Stripe.Invoice, stripeSubscriptionId: string) {
  const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)

  let creatorId: string | null = null
  let tierId: string | undefined = undefined
  let feeModel: string | undefined = undefined
  let feeMode: string | undefined = undefined
  let basePrice: number = invoice.amount_paid // Default fallback

  // 1. Try metadata first (Primary)
  const metadataValidation = validateCheckoutMetadata(stripeSubscription.metadata as Record<string, string>)
  if (metadataValidation.valid && metadataValidation.data) {
    const meta = metadataValidation.data
    creatorId = meta.creatorId
    tierId = meta.tierId
    feeModel = meta.feeModel
    feeMode = meta.feeMode
    const netAmount = parseMetadataAmount(meta.netAmount)
    const grossAmount = parseMetadataAmount(meta.grossAmount) || invoice.amount_paid
    basePrice = (feeMode === 'absorb' ? grossAmount : netAmount) || grossAmount
  } else {
    logger.warn('Invalid metadata for subscription, attempting fallback via transfer destination', { stripeSubscriptionId })

    // 2. Fallback: Find creator via transfer destination (Connected Account ID)
    const destination = stripeSubscription.transfer_data?.destination ||
      (invoice as any).transfer_data?.destination

    if (typeof destination === 'string') {
      const creatorProfile = await db.profile.findFirst({
        where: { stripeAccountId: destination },
        select: { userId: true }
      })
      if (creatorProfile) {
        creatorId = creatorProfile.userId
        logger.info('Recovered creatorId from destination', { creatorId, destination })
      }
    }
  }

  if (!creatorId) {
    throw new Error(`[invoice.paid] Could not identify creator for subscription ${stripeSubscriptionId} (missing metadata and transfer destination)`)
  }

  const subscriberEmail = await resolveStripeInvoiceCustomerEmail(invoice, 'invoice.paid')

  // Get or create subscriber
  let subscriber = await db.user.findUnique({ where: { email: subscriberEmail } })
  if (!subscriber) {
    try {
      subscriber = await db.user.create({ data: { email: subscriberEmail } })
    } catch {
      subscriber = await db.user.findUnique({ where: { email: subscriberEmail } })
    }
  }
  if (!subscriber) {
    throw new Error(`[invoice.paid] Could not find or create subscriber`)
  }

  // Get tier info
  const creatorProfile = await db.profile.findUnique({
    where: { userId: creatorId },
    select: { tiers: true, displayName: true, username: true },
  })

  // Try to find creator user for email sending
  const creatorUser = await db.user.findUnique({ where: { id: creatorId } })

  let tierName: string | null = null
  if (tierId && creatorProfile?.tiers) {
    const tiers = creatorProfile.tiers as any[]
    const tier = tiers.find(t => t.id === tierId)
    tierName = tier?.name || null
  }

  const periodEnd = invoice.lines.data[0]?.period?.end
    ? new Date(invoice.lines.data[0].period.end * 1000)
    : null

  const stripeCustomerId = typeof stripeSubscription.customer === 'string'
    ? stripeSubscription.customer
    : null

  // Create the subscription
  const subscription = await db.subscription.upsert({
    where: {
      subscriberId_creatorId_interval: {
        subscriberId: subscriber.id,
        creatorId,
        interval: 'month',
      },
    },
    create: {
      creatorId,
      subscriberId: subscriber.id,
      tierId: tierId || null,
      tierName,
      amount: basePrice,
      currency: invoice.currency.toUpperCase(),
      interval: 'month',
      status: 'pending',
      stripeSubscriptionId: stripeSubscriptionId,
      stripeCustomerId,
      feeModel: feeModel || null,
      feeMode: feeMode || null,
      currentPeriodEnd: periodEnd,
    },
    update: {
      status: 'pending',
      tierId: tierId || null,
      tierName,
      amount: basePrice,
      currency: invoice.currency.toUpperCase(),
      stripeSubscriptionId: stripeSubscriptionId,
      stripeCustomerId,
      feeModel: feeModel || null,
      feeMode: feeMode || null,
      canceledAt: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: periodEnd,
    },
  })

  // Send "New Subscriber" email since checkout.session.completed likely failed
  if (creatorUser) {
    logger.info('Sending new subscriber email for backfilled subscription', { subscriptionId: subscription.id })
    // We don't await this to avoid blocking the webhook
    sendNewSubscriberEmail(
      creatorUser.email,
      subscriber.email || 'Someone', // Use email if name unknown
      tierName,
      invoice.amount_paid,
      invoice.currency.toUpperCase()
    ).catch(err => logger.error('Failed to send backfill email', err as Error))
  }

  return subscription
}


// Handle invoice.paid (recurring payments)
export async function handleInvoicePaid(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice

  // Get subscription ID from invoice - use subscription_details in newer API versions
  const subscriptionId = (invoice as any).subscription_details?.subscription
    || (invoice as any).subscription

  if (!subscriptionId) return

  // Lock to prevent duplicate processing of same invoice
  const lockKey = `invoice:paid:${invoice.id}`
  const processed = await withLock(lockKey, 30000, async () => {
    // Check idempotency - already processed this invoice?
    const existingPayment = await db.payment.findFirst({
      where: { stripeEventId: event.id },
    })
    if (existingPayment) {
      logger.info('Already processed event, skipping', { eventId: event.id })
      return true
    }

    let subscription = await db.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
      include: {
        creator: {
          include: { profile: { select: { purpose: true, stripeAccountId: true } } },
        },
      },
    })

    logger.info('Subscription lookup result', { subscriptionId, found: !!subscription })

    // If checkout.session.completed was missed or failed, reconstruct from Stripe subscription metadata.
    if (!subscription) {
      logger.info('Attempting backfill for subscription', { subscriptionId })
      try {
        await backfillStripeSubscriptionForInvoicePaid(invoice, subscriptionId)
        logger.info('Backfill completed', { subscriptionId })
      } catch (backfillErr: any) {
        logger.error('Backfill FAILED', backfillErr, { subscriptionId })
        throw backfillErr
      }

      subscription = await db.subscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
        include: {
          creator: {
            include: { profile: { select: { purpose: true, stripeAccountId: true } } },
          },
        },
      })
      logger.info('Re-query after backfill', { subscriptionId, found: !!subscription })
    }

    if (!subscription) {
      logger.error('CRITICAL: No subscription found after backfill, triggering retry', null, { subscriptionId })
      throw new Error(`No subscription found for ${subscriptionId} after backfill attempt - checkout.session.completed may not have processed yet`)
    }

    // Retrieve Stripe subscription metadata for checkout evidence
    // Evidence was captured at initial checkout and stored in subscription metadata
    let checkoutIp: string | undefined
    let checkoutUserAgent: string | undefined
    let checkoutAcceptLanguage: string | undefined
    try {
      const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId)
      const metadata = stripeSubscription.metadata || {}
      checkoutIp = metadata.checkoutIp
      checkoutUserAgent = metadata.checkoutUserAgent
      checkoutAcceptLanguage = metadata.checkoutAcceptLanguage
    } catch (err) {
      logger.warn('Could not retrieve Stripe subscription metadata', { subscriptionId, error: (err as Error).message })
    }

    // Get actual fee from Stripe invoice (more reliable than recalculating)
    const invoiceAny = invoice as any
    const stripeActualFee = invoiceAny.application_fee_amount || 0

    // Calculate fees - use new model if subscription has it, else legacy
    let feeCents: number
    let netCents: number
    let grossCents: number | null = null
    let feeModel: string | null = null
    let feeEffectiveRate: number | null = null
    let subscriberFeeCents: number | null = null
    let creatorFeeCents: number | null = null
    let feeWasCapped = false

    if (subscription.feeModel) {
      // New fee model (split_v1, flat, or progressive)
      // IMPORTANT: Calculate fee on CREATOR'S PRICE (subscription.amount), not invoice total
      const creatorAmount = subscription.amount
      const creatorPurpose = subscription.creator?.profile?.purpose
      const feeCalc = calculateServiceFee(
        creatorAmount,
        invoice.currency.toUpperCase(),
        creatorPurpose,
        subscription.feeMode as any, // Pass stored feeMode for legacy, ignored for split_v1
        false // Cross-border handled in invoice.created
      )

      // Use actual Stripe fee if available, otherwise use calculated
      // This ensures we store what Stripe actually charged, not what we expected
      if (stripeActualFee > 0) {
        feeCents = stripeActualFee
        // Alert if mismatch - this indicates invoice.created webhook may have raced/failed
        if (stripeActualFee !== feeCalc.feeCents) {
          const mismatchPct = Math.abs((stripeActualFee - feeCalc.feeCents) / feeCalc.feeCents * 100)
          logger.error('ALERT: Fee mismatch detected', null, {
            subscriptionId: subscription.id,
            stripeActualFee,
            expectedFee: feeCalc.feeCents,
            mismatchPercent: mismatchPct.toFixed(1),
            creatorAmount,
          })
          // Create activity for monitoring/alerting systems
          await db.activity.create({
            data: {
              userId: subscription.creatorId,
              type: 'fee_mismatch_alert',
              payload: {
                subscriptionId: subscription.id,
                invoiceId: invoice.id,
                stripeActualFee,
                expectedFee: feeCalc.feeCents,
                creatorAmount,
                mismatchPercent: mismatchPct,
                currency: invoice.currency,
                feeModel: feeCalc.feeModel,
              },
            },
          })
        }
      } else {
        // Invoice.created webhook may have failed - use calculated fee
        feeCents = feeCalc.feeCents
        logger.error('ALERT: No application_fee on invoice, using calculated fee', null, { invoiceId: invoice.id, calculatedFee: feeCents, issue: 'Invoice.created webhook may have failed' })
        // Create activity for monitoring - this is a critical issue
        await db.activity.create({
          data: {
            userId: subscription.creatorId,
            type: 'fee_missing_alert',
            payload: {
              subscriptionId: subscription.id,
              invoiceId: invoice.id,
              calculatedFee: feeCents,
              creatorAmount,
              currency: invoice.currency,
              feeModel: feeCalc.feeModel,
              issue: 'invoice.created webhook may have failed to apply fee',
            },
          },
        })
      }

      grossCents = invoice.amount_paid
      netCents = feeCalc.netCents
      feeModel = feeCalc.feeModel
      feeEffectiveRate = feeCalc.effectiveRate
      feeWasCapped = feeCalc.feeWasCapped

      // Store split fee fields for v2 model
      if (feeCalc.feeModel === 'split_v1') {
        subscriberFeeCents = feeCalc.subscriberFeeCents
        creatorFeeCents = feeCalc.creatorFeeCents
      }
    } else {
      // Legacy model: fee deducted from creator's earnings
      const purpose = subscription.creator?.profile?.purpose as 'personal' | 'service' | null
      const legacyFees = calculateLegacyFee(invoice.amount_paid, purpose, invoice.currency.toUpperCase())
      feeCents = legacyFees.feeCents
      netCents = legacyFees.netCents
    }

    // Update subscription period, LTV, and activate if pending/past_due
    // IMPORTANT: LTV tracks creator's earnings (netCents), not gross amount paid
    const needsActivation = subscription.status === 'past_due' || subscription.status === 'pending'
    await db.subscription.update({
      where: { id: subscription.id },
      data: {
        // ACTIVATION: If subscription was pending (async payment) or past_due, payment success means it's active
        // This provides activation for async payments and recovery from past_due
        status: needsActivation ? 'active' : undefined,
        currentPeriodEnd: invoice.lines.data[0]?.period?.end
          ? new Date(invoice.lines.data[0].period.end * 1000)
          : null,
        ltvCents: { increment: netCents }, // Creator's earnings, not gross
      },
    })

    if (needsActivation) {
      logger.info('Activated subscription from past_due/pending to active', { subscriptionId: subscription.id, previousStatus: subscription.status })
    }

    // Create payment record with charge ID
    // Use invoice paid_at timestamp for accurate period-based reporting
    const paidAt = invoiceAny.status_transitions?.paid_at
      ? new Date(invoiceAny.status_transitions.paid_at * 1000)
      : new Date()

    // Get reporting currency data (USD conversion) for admin dashboard
    const reportingData = await getReportingCurrencyData(
      grossCents,
      feeCents,
      netCents,
      invoice.currency.toUpperCase()
    )

    const recurringPayment = await db.payment.create({
      data: {
        subscriptionId: subscription.id,
        creatorId: subscription.creatorId,
        subscriberId: subscription.subscriberId,
        grossCents,
        amountCents: invoice.amount_paid,
        currency: invoice.currency.toUpperCase(),
        feeCents,
        netCents,
        subscriberFeeCents,  // Split fee: subscriber's portion
        creatorFeeCents,     // Split fee: creator's portion
        feeModel,
        feeEffectiveRate,
        feeWasCapped,
        type: 'recurring',
        status: 'succeeded',
        occurredAt: paidAt,
        stripeEventId: event.id,
        stripePaymentIntentId: invoiceAny.payment_intent as string || null,
        stripeChargeId: invoiceAny.charge as string || null,
        // Reporting currency fields (USD normalized)
        ...reportingData,
      },
    })

    logger.info('Created recurring payment', { paymentId: recurringPayment.id, netCents, feeCents, grossCents })

    // Fetch FX data for cross-border payments (e.g., USD → NGN)
    // Do this async after payment creation so it doesn't block the main flow
    // Note: Transfer may not exist yet at webhook time - that's OK, activity.ts will backfill on-demand
    const creatorStripeAccountId = subscription.creator?.profile?.stripeAccountId
    if (recurringPayment.stripeChargeId && creatorStripeAccountId) {
      getChargeFxData(recurringPayment.stripeChargeId, creatorStripeAccountId)
        .then(async (result) => {
          if (result.status === 'fx_found') {
            await db.payment.update({
              where: { id: recurringPayment.id },
              data: {
                payoutCurrency: result.data.payoutCurrency,
                payoutAmountCents: result.data.payoutAmountCents,
                exchangeRate: result.data.exchangeRate,
              },
            })
            logger.info('Stored FX data for payment', { paymentId: recurringPayment.id, originalCurrency: result.data.originalCurrency, payoutCurrency: result.data.payoutCurrency, exchangeRate: result.data.exchangeRate })
          } else {
            // pending/no_fx/error - activity.ts will handle on-demand backfill
            logger.debug('FX lookup status', { paymentId: recurringPayment.id, status: result.status })
          }
        })
        .catch((err) => {
          logger.warn('Could not fetch FX data for payment', { paymentId: recurringPayment.id, error: err.message })
        })
    }

    // Create dispute evidence record for chargeback defense
    // Only create if we have at least some evidence from checkout
    if (checkoutIp || checkoutUserAgent) {
      await db.disputeEvidence.create({
        data: {
          paymentId: recurringPayment.id,
          checkoutIp,
          checkoutUserAgent,
          checkoutAcceptLanguage,
          checkoutTimestamp: subscription.createdAt, // Original subscription creation time
          confirmationEmailSent: true, // Renewal confirmation was sent
        },
      }).catch((err: any) => {
        // Non-fatal - don't fail the payment if evidence can't be saved
        logger.warn('Could not save dispute evidence for payment', { paymentId: recurringPayment.id, error: err.message })
      })
    }

    // Invalidate admin revenue cache to ensure fresh dashboard data
    await invalidateAdminRevenueCache()

    // ASYNC PAYMENT FOLLOW-UP: Complete conversion tracking and request acceptance
    // These were deferred in checkout.session.completed when payment_status !== 'paid'
    if (subscription.asyncViewId || subscription.asyncRequestId) {
      logger.info('Processing async payment follow-up', { subscriptionId: subscription.id })

      // Complete conversion tracking
      if (subscription.asyncViewId) {
        await db.pageView.update({
          where: { id: subscription.asyncViewId },
          data: { startedCheckout: true, completedCheckout: true },
        }).catch(() => { }) // Ignore if view doesn't exist

        logger.debug('Marked pageView as converted', { viewId: subscription.asyncViewId })
      }

      // Accept the request
      if (subscription.asyncRequestId) {
        await db.request.update({
          where: { id: subscription.asyncRequestId },
          data: {
            status: 'accepted',
            respondedAt: new Date(),
          },
        }).catch(() => { }) // Ignore if request doesn't exist

        // Get request details for activity logging
        const request = await db.request.findUnique({ where: { id: subscription.asyncRequestId } })
        if (request) {
          await db.activity.create({
            data: {
              userId: subscription.creatorId,
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

        logger.debug('Marked request as accepted', { requestId: subscription.asyncRequestId })
      }

      // Clear async follow-up data (one-time action)
      await db.subscription.update({
        where: { id: subscription.id },
        data: {
          asyncViewId: null,
          asyncRequestId: null,
        },
      })
    }

    // Create activity event
    // IMPORTANT: Show NET amount (what creator receives), not gross
    await db.activity.create({
      data: {
        userId: subscription.creatorId,
        type: 'payment_received',
        payload: {
          subscriptionId: subscription.id,
          paymentId: recurringPayment.id, // For exact payment lookup (FX data, payout status)
          amount: netCents,              // NET - what creator receives after fees
          grossAmount: invoice.amount_paid, // GROSS - what subscriber paid
          feeCents,                      // Platform fee taken
          currency: invoice.currency,
          provider: 'stripe',
        },
      },
    })

    // SALARY MODE: Track successful payments for unlock gate
    // After 2 successful payments, unlock salary mode feature
    // Only count real payments (amount_paid > 0), not $0 trials
    if (invoice.amount_paid > 0) {
      // Atomically increment counter and get new value
      const updatedProfile = await db.profile.update({
        where: { userId: subscription.creatorId },
        data: { totalSuccessfulPayments: { increment: 1 } },
        select: { totalSuccessfulPayments: true, paydayAlignmentUnlocked: true },
      })

      // Check if we should unlock (2+ payments AND not already unlocked)
      if (updatedProfile.totalSuccessfulPayments >= 2 && !updatedProfile.paydayAlignmentUnlocked) {
        // Atomic unlock: only update if still locked (prevents duplicate activities)
        const unlockResult = await db.profile.updateMany({
          where: {
            userId: subscription.creatorId,
            paydayAlignmentUnlocked: false, // Only unlock if still locked
          },
          data: { paydayAlignmentUnlocked: true },
        })

        // Only create activity if we actually unlocked (count > 0)
        if (unlockResult.count > 0) {
          logger.info('Unlocked Salary Mode for creator', { creatorId: subscription.creatorId, successfulPayments: updatedProfile.totalSuccessfulPayments })
          await db.activity.create({
            data: {
              userId: subscription.creatorId,
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

    // Schedule 7/3/1-day renewal reminder emails for chargeback prevention
    // Visa VAMP compliance: pre-billing notifications reduce friendly fraud
    try {
      await scheduleSubscriptionRenewalReminders(subscription.id)
      logger.debug('Scheduled renewal reminders', { subscriptionId: subscription.id })
    } catch (reminderErr) {
      // Don't fail the webhook if reminder scheduling fails
      logger.error('Failed to schedule renewal reminders', reminderErr as Error, { subscriptionId: subscription.id })
    }

    // PLATFORM DEBIT RECOVERY for subscription renewals
    // When a service provider's platform subscription fails, we accumulate debit
    // and recover it from their next client payment via a separate charge
    // Use lock to prevent concurrent recovery attempts
    const recoveryLockKey = `debit-recovery:${subscription.creatorId}`

    await withLock(recoveryLockKey, 15000, async () => {
      // Re-read profile inside lock to get current debit amount
      const creatorProfile = await db.profile.findUnique({
        where: { userId: subscription.creatorId },
        select: {
          displayName: true,
          platformDebitCents: true,
          platformCustomerId: true,
          purpose: true,
        },
      })

      if (!creatorProfile?.purpose ||
        creatorProfile.purpose !== 'service' ||
        !creatorProfile.platformDebitCents ||
        creatorProfile.platformDebitCents <= 0 ||
        !creatorProfile.platformCustomerId) {
        return // No debit to recover
      }

      // Recover up to $30 per payment (cap to prevent large unexpected charges)
      const debitToRecover = Math.min(creatorProfile.platformDebitCents, 3000)

      try {
        // Get the default payment method from the platform customer
        const customer = await stripe.customers.retrieve(creatorProfile.platformCustomerId)
        const defaultPaymentMethod = typeof customer !== 'string' && !customer.deleted
          ? customer.invoice_settings?.default_payment_method
          : null

        if (defaultPaymentMethod) {
          // Create a separate charge to recover the platform debit
          const paymentIntent = await stripe.paymentIntents.create({
            amount: debitToRecover,
            currency: 'usd',
            customer: creatorProfile.platformCustomerId,
            payment_method: defaultPaymentMethod as string,
            confirm: true,
            off_session: true,
            description: 'Platform subscription recovery',
            metadata: {
              type: 'platform_debit_recovery',
              userId: subscription.creatorId,
              originalDebitCents: creatorProfile.platformDebitCents.toString(),
            },
          })

          if (paymentIntent.status === 'succeeded') {
            // Clear the recovered debit
            await db.profile.update({
              where: { userId: subscription.creatorId },
              data: {
                platformDebitCents: { decrement: debitToRecover },
              },
            })

            // Create activity for audit trail
            await db.activity.create({
              data: {
                userId: subscription.creatorId,
                type: 'platform_debit_recovered',
                payload: {
                  amountCents: debitToRecover,
                  source: 'stripe_subscription_renewal',
                  paymentIntentId: paymentIntent.id,
                  invoiceId: invoice.id,
                },
              },
            })

            // Send recovery notification email
            const creatorUser = await db.user.findUnique({
              where: { id: subscription.creatorId },
              select: { email: true },
            })
            if (creatorUser) {
              const remainingDebit = creatorProfile.platformDebitCents - debitToRecover
              try {
                await sendPlatformDebitRecoveredNotification(
                  creatorUser.email,
                  creatorProfile.displayName || 'there',
                  debitToRecover,
                  Math.max(0, remainingDebit)
                )
              } catch (emailErr) {
                logger.error('Failed to send debit recovery email', emailErr as Error, { creatorId: subscription.creatorId })
              }
            }

            logger.info('Recovered platform debit from creator', { creatorId: subscription.creatorId, amountCents: debitToRecover })
          }
        } else {
          logger.debug('No payment method for debit recovery', { creatorId: subscription.creatorId, remainingDebitCents: creatorProfile.platformDebitCents })
        }
      } catch (recoveryErr: any) {
        // Recovery failed - debit stays, will try again on next payment
        // Don't fail the webhook - the main payment succeeded

        // Handle SCA authentication required
        if (recoveryErr.code === 'authentication_required' ||
          recoveryErr.type === 'StripeCardError' && recoveryErr.code === 'card_declined') {
          logger.info('SCA/authentication required for debit recovery, will retry later', { creatorId: subscription.creatorId })
          // Create activity noting SCA requirement
          await db.activity.create({
            data: {
              userId: subscription.creatorId,
              type: 'platform_debit_recovery_sca_required',
              payload: {
                amountCents: debitToRecover,
                source: 'stripe_subscription_renewal',
                invoiceId: invoice.id,
                errorCode: recoveryErr.code,
              },
            },
          })
          return
        }

        logger.error('Platform debit recovery failed', recoveryErr, { creatorId: subscription.creatorId })

        // Create activity for visibility
        await db.activity.create({
          data: {
            userId: subscription.creatorId,
            type: 'platform_debit_recovery_failed',
            payload: {
              attemptedAmountCents: debitToRecover,
              remainingDebitCents: creatorProfile.platformDebitCents,
              error: recoveryErr.message,
              invoiceId: invoice.id,
            },
          },
        })
      }
    })

    return true
  }) // End of withLock

  if (!processed) {
    logger.warn('Could not acquire lock for invoice, will retry', { invoiceId: invoice.id })
  }
}

// Handle invoice.payment_failed
export async function handleInvoicePaymentFailed(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice

  // Get subscription ID from invoice - use subscription_details in newer API versions
  const subscriptionId = (invoice as any).subscription_details?.subscription
    || (invoice as any).subscription

  if (!subscriptionId) return

  const subscription = await db.subscription.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    include: {
      subscriber: { select: { email: true } },
    },
  })

  if (!subscription) return

  // Update subscription status
  await db.subscription.update({
    where: { id: subscription.id },
    data: { status: 'past_due' },
  })

  // Get failure reason from invoice
  const lastError = (invoice as any).last_finalization_error
  const failureMessage = lastError?.message || 'Payment could not be processed'

  // Create activity for failed renewal payment
  await db.activity.create({
    data: {
      userId: subscription.creatorId,
      type: 'payment_failed',
      payload: {
        subscriptionId: subscription.id,
        subscriberEmail: subscription.subscriber?.email,
        tierName: subscription.tierName, // Stored directly on subscription
        amount: invoice.amount_due, // Amount that failed (in cents)
        currency: invoice.currency?.toUpperCase() || 'USD',
        provider: 'stripe',
        failureMessage,
        invoiceId: invoice.id,
      },
    },
  })

  logger.info('Stripe invoice payment failed', { subscriptionId: subscription.id, invoiceId: invoice.id })
}
