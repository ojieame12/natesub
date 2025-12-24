import Stripe from 'stripe'
import { stripe } from '../../../services/stripe.js'
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
    console.log(`[invoice.created] No subscription found for ${stripeSubscriptionId}`)
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
        console.log(`[invoice.created] Set statement descriptor "${statementDescriptor}" for legacy subscription ${subscription.id}`)
      } catch (err) {
        console.error(`[invoice.created] Failed to set statement descriptor for legacy invoice ${invoice.id}:`, err)
      }
    } else {
      console.log(`[invoice.created] Skipping legacy subscription ${subscription.id} (no feeModel, no displayName)`)
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

    console.log(`[invoice.created] Applied fee ${feeCalc.feeCents} (${(feeCalc.effectiveRate * 100).toFixed(2)}%) on creator amount ${creatorAmount} to invoice ${invoice.id}${statementDescriptor ? ` with descriptor "${statementDescriptor}"` : ''}`)
  } catch (err) {
    // If we can't update (e.g., invoice already finalized), log but don't fail
    console.error(`[invoice.created] Failed to apply fee to invoice ${invoice.id}:`, err)
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
    console.warn(`[invoice.paid] Invalid metadata for ${stripeSubscriptionId}, attempting fallback via transfer destination...`)

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
        console.log(`[invoice.paid] Recovered creatorId ${creatorId} from destination ${destination}`)
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
    console.log(`[invoice.paid] Sending new subscriber email for backfilled subscription ${subscription.id}`)
    // We don't await this to avoid blocking the webhook
    sendNewSubscriberEmail(
      creatorUser.email,
      subscriber.email || 'Someone', // Use email if name unknown
      tierName,
      invoice.amount_paid,
      invoice.currency.toUpperCase()
    ).catch(err => console.error('[invoice.paid] Failed to send backfill email:', err))
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
      console.log(`[invoice.paid] Already processed event ${event.id}, skipping`)
      return true
    }

    let subscription = await db.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
      include: {
        creator: {
          include: { profile: { select: { purpose: true } } },
        },
      },
    })

    // If checkout.session.completed was missed or failed, reconstruct from Stripe subscription metadata.
    if (!subscription) {
      await backfillStripeSubscriptionForInvoicePaid(invoice, subscriptionId)
      subscription = await db.subscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
        include: {
          creator: {
            include: { profile: { select: { purpose: true } } },
          },
        },
      })
    }

    if (!subscription) return true // Nothing to process

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
      console.warn(`[invoice.paid] Could not retrieve Stripe subscription metadata for ${subscriptionId}:`, err)
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
          console.error(`[ALERT][invoice.paid] Fee mismatch for sub ${subscription.id}: Stripe=${stripeActualFee}, expected=${feeCalc.feeCents} (${mismatchPct.toFixed(1)}% diff) on creator amount ${creatorAmount}`)
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
        console.error(`[ALERT][invoice.paid] No application_fee on invoice ${invoice.id}, using calculated: ${feeCents}. Invoice.created webhook may have failed.`)
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
      console.log(`[invoice.paid] Activated subscription ${subscription.id} from ${subscription.status} to active`)
    }

    // Create payment record with charge ID
    // Use invoice paid_at timestamp for accurate period-based reporting
    const paidAt = invoiceAny.status_transitions?.paid_at
      ? new Date(invoiceAny.status_transitions.paid_at * 1000)
      : new Date()

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
      },
    })

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
        console.warn(`[invoice.paid] Could not save dispute evidence for payment ${recurringPayment.id}:`, err.message)
      })
    }

    // Invalidate admin revenue cache to ensure fresh dashboard data
    await invalidateAdminRevenueCache()

    // ASYNC PAYMENT FOLLOW-UP: Complete conversion tracking and request acceptance
    // These were deferred in checkout.session.completed when payment_status !== 'paid'
    if (subscription.asyncViewId || subscription.asyncRequestId) {
      console.log(`[invoice.paid] Processing async payment follow-up for subscription ${subscription.id}`)

      // Complete conversion tracking
      if (subscription.asyncViewId) {
        await db.pageView.update({
          where: { id: subscription.asyncViewId },
          data: { startedCheckout: true, completedCheckout: true },
        }).catch(() => { }) // Ignore if view doesn't exist

        console.log(`[invoice.paid] Marked pageView ${subscription.asyncViewId} as converted`)
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
              },
            },
          })
        }

        console.log(`[invoice.paid] Marked request ${subscription.asyncRequestId} as accepted`)
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
    await db.activity.create({
      data: {
        userId: subscription.creatorId,
        type: 'payment_received',
        payload: {
          subscriptionId: subscription.id,
          amount: invoice.amount_paid,
          currency: invoice.currency,
        },
      },
    })

    // Schedule 7/3/1-day renewal reminder emails for chargeback prevention
    // Visa VAMP compliance: pre-billing notifications reduce friendly fraud
    try {
      await scheduleSubscriptionRenewalReminders(subscription.id)
      console.log(`[invoice.paid] Scheduled renewal reminders for subscription ${subscription.id}`)
    } catch (reminderErr) {
      // Don't fail the webhook if reminder scheduling fails
      console.error(`[invoice.paid] Failed to schedule renewal reminders for ${subscription.id}:`, reminderErr)
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
                console.error(`[invoice.paid] Failed to send debit recovery email:`, emailErr)
              }
            }

            console.log(`[invoice.paid] Recovered $${(debitToRecover / 100).toFixed(2)} platform debit from creator ${subscription.creatorId}`)
          }
        } else {
          console.log(`[invoice.paid] No payment method for debit recovery, debit remains: $${(creatorProfile.platformDebitCents / 100).toFixed(2)}`)
        }
      } catch (recoveryErr: any) {
        // Recovery failed - debit stays, will try again on next payment
        // Don't fail the webhook - the main payment succeeded

        // Handle SCA authentication required
        if (recoveryErr.code === 'authentication_required' ||
          recoveryErr.type === 'StripeCardError' && recoveryErr.code === 'card_declined') {
          console.log(`[invoice.paid] SCA/authentication required for debit recovery from ${subscription.creatorId}, will retry later`)
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

        console.error(`[invoice.paid] Platform debit recovery failed for ${subscription.creatorId}:`, recoveryErr.message)

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
    console.log(`[invoice.paid] Could not acquire lock for invoice ${invoice.id}, will retry`)
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
  })

  if (!subscription) return

  await db.subscription.update({
    where: { id: subscription.id },
    data: { status: 'past_due' },
  })
}
