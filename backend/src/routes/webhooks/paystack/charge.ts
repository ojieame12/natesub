import { db } from '../../../db/client.js'
import { sendNewSubscriberEmail, sendSubscriptionConfirmationEmail } from '../../../services/email.js'
import { validatePaystackMetadata, sanitizeForLog } from '../../../utils/webhookValidation.js'
import { calculateLegacyFee } from '../../../services/fees.js'
import { withLock } from '../../../services/lock.js'
import { encryptAuthorizationCode } from '../../../utils/encryption.js'
import { addOneMonth, normalizeEmailAddress } from '../utils.js'
import { invalidateAdminRevenueCache } from '../../../utils/cache.js'

// Handle Paystack charge.success
export async function handlePaystackChargeSuccess(data: any, eventId: string) {
  const {
    reference,
    amount, // This is total amount subscriber paid (gross)
    currency,
    customer,
    authorization,
    metadata,
    paid_at, // ISO timestamp of when payment was made
  } = data

  // Parse paid_at for accurate occurredAt (Paystack provides ISO string)
  const occurredAt = paid_at ? new Date(paid_at) : new Date()

  // IDEMPOTENCY CHECK: Skip if we've already processed this event
  // This prevents double-processing on webhook retries
  const existingPayment = await db.payment.findFirst({
    where: { paystackEventId: eventId },
  })
  if (existingPayment) {
    console.log(`[paystack] Event ${eventId} already processed, skipping`)
    return
  }

  // Validate webhook metadata - provider signature already verified, this validates data integrity
  const metadataValidation = validatePaystackMetadata(metadata)
  if (!metadataValidation.valid) {
    console.error(`[paystack] Invalid metadata for event ${eventId}: ${metadataValidation.error}`)
    throw new Error(`Invalid metadata: ${metadataValidation.error}`)
  }

  const validatedMeta = metadataValidation.data!
  const creatorId = validatedMeta.creatorId
  const tierId = validatedMeta.tierId
  const requestId = metadata?.requestId // requestId not in schema but may be present
  const interval = validatedMeta.interval
  const viewId = validatedMeta.viewId

  // Fee metadata from validated schema
  const feeModel = validatedMeta.feeModel || null
  const feeMode = validatedMeta.feeMode || 'split' // Default to split for new subscriptions
  // Paystack metadata uses numbers, not strings
  const netAmount = validatedMeta.creatorAmount || 0
  const serviceFee = validatedMeta.serviceFee || 0
  const feeEffectiveRate = validatedMeta.feeEffectiveRate || null
  const feeWasCapped = validatedMeta.feeWasCapped === true

  // Split fee fields (v2 model)
  const subscriberFeeMeta = validatedMeta.subscriberFee || 0
  const creatorFeeMeta = validatedMeta.creatorFee || 0
  const baseAmountMeta = validatedMeta.baseAmount || 0

  // Checkout evidence for chargeback defense
  const checkoutIp = validatedMeta.checkoutIp
  const checkoutUserAgent = validatedMeta.checkoutUserAgent
  const checkoutAcceptLanguage = validatedMeta.checkoutAcceptLanguage

  console.log(`[paystack] Processing charge ${reference} for creator ${sanitizeForLog(creatorId)}`)

  // Server-side conversion tracking (more reliable than client-side)
  // Only update the specific view that was passed - no fallback to avoid overcounting
  if (viewId) {
    await db.pageView.update({
      where: { id: viewId },
      data: { startedCheckout: true, completedCheckout: true },
    }).catch(() => { }) // Ignore if view doesn't exist
  }

  // If this checkout was triggered by a request, finalize it
  if (requestId) {
    await db.request.update({
      where: { id: requestId },
      data: {
        status: 'accepted',
        respondedAt: new Date(),
        paystackTransactionRef: reference,
      },
    })

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
            provider: 'paystack',
          },
        },
      })
    }
  }

  // Get or create subscriber user
  const email = customer?.email ? normalizeEmailAddress(customer.email) : ''
  
  let subscriber = await db.user.findUnique({
    where: { email },
  })

  if (!subscriber && email) {
    subscriber = await db.user.create({
      data: { email },
    })
  }

  if (!subscriber) {
    console.error('Could not find or create subscriber for Paystack payment')
    return
  }

  // Get creator profile for tier info and bank details
  const creatorProfile = await db.profile.findUnique({
    where: { userId: creatorId },
  })

  let tierName: string | null = null
  if (tierId && creatorProfile?.tiers) {
    const tiers = creatorProfile.tiers as any[]
    const tier = tiers.find(t => t.id === tierId)
    tierName = tier?.name || null
  }

  // Calculate fees - use new model if metadata present, else legacy
  let feeCents: number
  let netCents: number
  let grossCents: number | null = null
  let basePrice: number  // Creator's set price - this is what fees are calculated on for renewals
  let subscriberFeeCents: number | null = null
  let creatorFeeCents: number | null = null

  const hasNewFeeModel = feeModel && netAmount > 0
  if (feeModel === 'split_v1' && hasNewFeeModel) {
    // New split fee model (4%/4%)
    grossCents = amount  // Total subscriber paid
    feeCents = serviceFee
    netCents = netAmount  // What creator receives
    subscriberFeeCents = subscriberFeeMeta || null
    creatorFeeCents = creatorFeeMeta || null
    basePrice = baseAmountMeta || netCents  // Creator's set price
  } else if (feeModel === 'flat' && hasNewFeeModel) {
    // Legacy flat fee model with feeMode
    grossCents = amount  // Total subscriber paid
    feeCents = serviceFee
    netCents = netAmount  // What creator receives (depends on feeMode)

    // CRITICAL: Store creator's set price for renewal fee calculation
    // In absorb mode: creator sets price = what subscriber pays (gross)
    // In pass_to_subscriber mode: creator sets price = what they receive (net)
    basePrice = feeMode === 'absorb' ? amount : netCents
  } else if (feeModel?.startsWith('progressive') && hasNewFeeModel) {
    // Legacy progressive model (backward compatibility)
    grossCents = amount
    feeCents = serviceFee
    netCents = netAmount
    basePrice = feeMode === 'absorb' ? amount : netCents
  } else {
    // Legacy model: fee deducted from creator's earnings
    const purpose = creatorProfile?.purpose as 'personal' | 'service' | null
    const legacyFees = calculateLegacyFee(amount, purpose, currency?.toUpperCase() || 'NGN')
    feeCents = legacyFees.feeCents
    netCents = legacyFees.netCents
    basePrice = amount  // Legacy used gross as base
  }

  // Create or update subscription (upsert based on unique constraint)
  const subscriptionInterval = interval === 'month' ? 'month' : 'one_time'

  // DISTRIBUTED LOCK: Prevent race conditions when processing concurrent webhooks
  // Lock key based on subscriber + creator to prevent duplicate subscriptions
  const lockKey = `sub:${subscriber.id}:${creatorId}:${subscriptionInterval}`
  const subscription = await withLock(lockKey, 30000, async () => {
    // Use transaction to ensure atomic creation of subscription + payment + activity
    return await db.$transaction(async (tx) => {
      // IMPORTANT: Store creator's SET PRICE for fee calculation on renewals
      // This ensures recurring billing calculates fees correctly regardless of feeMode
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
          currency: currency?.toUpperCase() || 'NGN',
          interval: subscriptionInterval,
          status: 'active',
          ltvCents: netCents, // Initialize LTV with creator's earnings (net)
          // SECURITY: Encrypt authorization code at rest
          paystackAuthorizationCode: encryptAuthorizationCode(authorization?.authorization_code || null),
          paystackCustomerCode: customer?.customer_code || null,
          feeModel: feeModel || null,
          feeMode: feeMode || null, // Lock fee mode at subscription creation for consistent renewals
          currentPeriodEnd: interval === 'month'
            ? addOneMonth(new Date()) // Proper calendar month, not 30 days
            : null,
        },
        update: {
          // Note: feeMode is NOT updated - it stays locked to the value at subscription creation
          // SECURITY: Encrypt authorization code at rest
          paystackAuthorizationCode: encryptAuthorizationCode(authorization?.authorization_code || null),
          paystackCustomerCode: customer?.customer_code || null,
          ltvCents: { increment: netCents }, // LTV is creator's earnings (net)
          currentPeriodEnd: interval === 'month'
            ? addOneMonth(new Date()) // Proper calendar month, not 30 days
            : undefined,
        },
      })

      // Create payment record with idempotency key
      const paystackPayment = await tx.payment.create({
        data: {
          subscriptionId: newSubscription.id,
          creatorId,
          subscriberId: subscriber.id,
          grossCents,
          amountCents: grossCents || amount,
          currency: currency?.toUpperCase() || 'NGN',
          feeCents,
          netCents,
          subscriberFeeCents,   // Split fee: subscriber's portion
          creatorFeeCents,      // Split fee: creator's portion
          feeModel: feeModel || null,
          feeEffectiveRate,
          feeWasCapped,
          type: subscriptionInterval === 'month' ? 'recurring' : 'one_time',
          status: 'succeeded',
          occurredAt,
          paystackEventId: eventId,
          paystackTransactionRef: reference,
        },
      })

      // Create dispute evidence record for chargeback defense
      // Only create if we have at least some evidence from checkout
      if (checkoutIp || checkoutUserAgent) {
        await tx.disputeEvidence.create({
          data: {
            paymentId: paystackPayment.id,
            checkoutIp,
            checkoutUserAgent,
            checkoutAcceptLanguage,
            checkoutTimestamp: occurredAt,
            confirmationEmailSent: true, // We send confirmation email below
          },
        }).catch((err: any) => {
          // Non-fatal - don't fail the payment if evidence can't be saved
          console.warn(`[paystack] Could not save dispute evidence for payment ${paystackPayment.id}:`, err.message)
        })
      }

      // Create activity event
      await tx.activity.create({
        data: {
          userId: creatorId,
          type: 'subscription_created',
          payload: {
            subscriptionId: newSubscription.id,
            subscriberEmail: customer?.email,
            tierName,
            amount: netCents, // Show creator their earnings
            currency,
            provider: 'paystack',
          },
        },
      })

      return newSubscription
    })
  })

  // If lock couldn't be acquired, another process is handling this
  if (!subscription) {
    console.log(`[paystack] Lock not acquired for ${lockKey}, skipping (another process handling)`)
    return
  }

  // Invalidate admin revenue cache after payment creation
  await invalidateAdminRevenueCache()

  // Note: Creator payout is handled automatically by Paystack subaccount split
  // Platform fee is deducted based on subaccount's percentage_charge
  // Creator receives the rest directly from Paystack on T+1 settlement
  // No manual transfer needed

  // TODO: Platform debit recovery for Paystack needs alternative approach with subaccounts
  // Options: 1) Separate invoice, 2) Adjust pricing, 3) Post-settlement recovery

  // Send notification email to creator
  const creator = await db.user.findUnique({
    where: { id: creatorId },
    include: { profile: { select: { displayName: true, username: true } } },
  })
  if (creator) {
    await sendNewSubscriberEmail(
      creator.email,
      customer?.email || 'Someone',
      tierName,
      netCents, // Show creator their earnings
      currency?.toUpperCase() || 'NGN'
    )

    // Send confirmation email to subscriber with manage subscription link
    if (customer?.email) {
      try {
        await sendSubscriptionConfirmationEmail(
          customer.email,
          customer.first_name || customer.email.split('@')[0] || 'there',
          creator.profile?.displayName || creator.email,
          creator.profile?.username || '',
          tierName,
          netCents,
          currency?.toUpperCase() || 'NGN'
        )
      } catch (emailErr) {
        console.error(`[paystack] Failed to send subscriber confirmation email:`, emailErr)
      }
    }
  }
}

// Handle Paystack charge.failed
export async function handlePaystackChargeFailed(data: any) {
  const { metadata, reference } = data

  const subscriptionId = metadata?.subscriptionId

  if (subscriptionId) {
    // This is a failed recurring charge
    await db.subscription.update({
      where: { id: subscriptionId },
      data: { status: 'past_due' },
    })

    console.log(`Paystack charge failed for subscription ${subscriptionId}, ref: ${reference}`)
  }
}
