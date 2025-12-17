import { db } from '../../../db/client.js'
import { sendNewSubscriberEmail, sendSubscriptionConfirmationEmail, sendPlatformDebitRecoveredNotification } from '../../../services/email.js'
import { validatePaystackMetadata, sanitizeForLog } from '../../../utils/webhookValidation.js'
import { calculateLegacyFee } from '../../../services/fees.js'
import { withLock } from '../../../services/lock.js'
import { encryptAuthorizationCode, decryptAccountNumber } from '../../../utils/encryption.js'
import { addOneMonth, normalizeEmailAddress } from '../utils.js'
import { getUSDRate, convertUSDCentsToLocal, convertLocalCentsToUSD, isLocalCurrency } from '../../../services/fx.js'
import { initiateTransfer, createTransferRecipient } from '../../../services/paystack.js'

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
  const feeMode = validatedMeta.feeMode || 'pass_to_subscriber'
  // Paystack metadata uses numbers, not strings
  const netAmount = validatedMeta.creatorAmount || 0
  const serviceFee = validatedMeta.serviceFee || 0
  const feeEffectiveRate = validatedMeta.feeEffectiveRate || null
  const feeWasCapped = validatedMeta.feeWasCapped === true

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

  const hasNewFeeModel = feeModel && netAmount > 0
  if (feeModel === 'flat' && hasNewFeeModel) {
    // New flat fee model with feeMode
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
    const legacyFees = calculateLegacyFee(amount, purpose)
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
      await tx.payment.create({
        data: {
          subscriptionId: newSubscription.id,
          creatorId,
          subscriberId: subscriber.id,
          grossCents,
          amountCents: grossCents || amount,
          currency: currency?.toUpperCase() || 'NGN',
          feeCents,
          netCents,
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

  // For new fee model: Platform received full payment, now transfer to creator
  // This is done AFTER the transaction to ensure we don't transfer if DB write fails
  // Supports both 'flat' and 'progressive' fee models
  if (feeModel && creatorProfile?.paystackBankCode && creatorProfile?.paystackAccountNumber) {
    // Lock to prevent duplicate payout processing on webhook retry
    const payoutReference = `PAYOUT-${reference}`
    const payoutLockKey = `payout:${payoutReference}`

    await withLock(payoutLockKey, 30000, async () => {
      // Idempotency check: ensure we don't double-transfer on webhook retry
      const existingPayout = await db.payment.findFirst({
        where: {
          paystackTransactionRef: payoutReference,
          type: 'payout',
        },
      })

      if (existingPayout) {
        console.log(`[paystack] Payout ${payoutReference} already exists, skipping transfer`)
        return
      }

      // PLATFORM DEBIT RECOVERY for Paystack
      // When a service provider's platform subscription fails, we accumulate debit (in USD cents)
      // and recover it by reducing their transfer amount (in local currency)
      // IMPORTANT: Must convert USD debit to local currency before subtracting
      let platformDebitRecoveredLocal = 0  // Amount in local currency (NGN kobo, KES cents, etc.)
      let platformDebitRecoveredUSD = 0    // Amount in USD cents (for decrementing platformDebitCents)

      if (creatorProfile?.purpose === 'service' && (creatorProfile.platformDebitCents || 0) > 0) {
        const localCurrency = currency?.toUpperCase() || 'NGN'

        // Only convert if it's actually a local currency (NGN, KES, ZAR, GHS)
        if (isLocalCurrency(localCurrency)) {
          // Get current FX rate
          const fxRate = await getUSDRate(localCurrency)

          // Convert USD debit cap ($30 = 3000 cents) to local currency
          const debitCapLocal = convertUSDCentsToLocal(3000, fxRate)

          // Convert creator's USD debit to local currency
          const debitInLocal = convertUSDCentsToLocal(creatorProfile.platformDebitCents || 0, fxRate)

          // Cap recovery at: debit amount, $30 equivalent, or net transfer amount
          const maxRecoveryLocal = Math.min(debitInLocal, debitCapLocal, netCents)
          platformDebitRecoveredLocal = maxRecoveryLocal

          // Convert back to USD for decrementing platformDebitCents
          platformDebitRecoveredUSD = convertLocalCentsToUSD(maxRecoveryLocal, fxRate)

          console.log(`[paystack] FX debit recovery: ${platformDebitRecoveredUSD} USD cents = ${platformDebitRecoveredLocal} ${localCurrency} (rate: ${fxRate})`)
        } else {
          // USD or other non-local currency - direct subtraction (shouldn't happen for Paystack)
          const maxRecovery = Math.min(creatorProfile.platformDebitCents || 0, 3000, netCents)
          platformDebitRecoveredLocal = maxRecovery
          platformDebitRecoveredUSD = maxRecovery
        }
      }

      // Calculate final transfer amount after debit recovery (in local currency)
      const finalTransferAmount = netCents - platformDebitRecoveredLocal

      try {
        // Decrypt the stored account number
        const accountNumber = decryptAccountNumber(creatorProfile.paystackAccountNumber)
        const bankCode = creatorProfile.paystackBankCode

        if (!accountNumber || !bankCode) {
          console.error(`[paystack] Could not decrypt account number for creator ${creatorId}`)
          // Record failed payout for manual intervention
          await db.payment.create({
            data: {
              subscriptionId: subscription.id,
              creatorId,
              subscriberId: subscriber.id,
              amountCents: finalTransferAmount,
              currency: currency?.toUpperCase() || 'NGN',
              feeCents: 0,
              netCents: finalTransferAmount,
              feeModel: feeModel || null,
              feeEffectiveRate,
              feeWasCapped,
              platformDebitRecoveredCents: platformDebitRecoveredLocal,
              type: 'payout',
              status: 'failed',
              paystackTransactionRef: payoutReference,
            },
          })
        } else {
          // Create payout record FIRST (before transfer attempt)
          // This ensures we track all payout attempts for retry/audit
          const payoutRecord = await db.payment.create({
            data: {
              subscriptionId: subscription.id,
              creatorId,
              subscriberId: subscriber.id,
              amountCents: finalTransferAmount,
              currency: currency?.toUpperCase() || 'NGN',
              feeCents: 0,
              netCents: finalTransferAmount,
              feeModel: feeModel || null,
              feeEffectiveRate,
              feeWasCapped,
              platformDebitRecoveredCents: platformDebitRecoveredLocal,
              type: 'payout',
              status: 'pending', // Will be updated by transfer.success/failed webhook
              paystackTransactionRef: payoutReference,
            },
          })

          try {
            // Create transfer recipient if not exists (cached by Paystack)
            const { recipientCode } = await createTransferRecipient({
              name: creatorProfile.displayName,
              accountNumber,
              bankCode,
              currency: currency?.toUpperCase() || 'NGN',
            })

            // Initiate transfer to creator (reduced by debit recovery)
            const transferResult = await initiateTransfer({
              amount: finalTransferAmount,
              recipientCode,
              reason: `Payment from ${customer?.email || 'subscriber'}`,
              reference: payoutReference,
            })

            // Store transfer code and handle OTP requirement
            const transferStatus = transferResult.status === 'otp' ? 'otp_pending' : 'pending'
            await db.payment.update({
              where: { id: payoutRecord.id },
              data: {
                paystackTransferCode: transferResult.transferCode,
                status: transferStatus as any,
              },
            })

            // Clear platform debit if recovered (decrement in USD cents)
            if (platformDebitRecoveredUSD > 0) {
              const remainingDebit = (creatorProfile.platformDebitCents || 0) - platformDebitRecoveredUSD

              await db.profile.update({
                where: { userId: creatorId },
                data: {
                  platformDebitCents: { decrement: platformDebitRecoveredUSD },
                },
              })

              // Create activity for audit trail
              await db.activity.create({
                data: {
                  userId: creatorId,
                  type: 'platform_debit_recovered',
                  payload: {
                    amountUSDCents: platformDebitRecoveredUSD,
                    amountLocalCents: platformDebitRecoveredLocal,
                    localCurrency: currency?.toUpperCase() || 'NGN',
                    source: 'paystack_payment',
                    transactionRef: reference,
                    originalNetCents: netCents,
                    finalTransferAmount,
                  },
                },
              })

              // Send recovery notification email
              const creatorUser = await db.user.findUnique({
                where: { id: creatorId },
                select: { email: true },
              })
              if (creatorUser) {
                try {
                  await sendPlatformDebitRecoveredNotification(
                    creatorUser.email,
                    creatorProfile.displayName || 'there',
                    platformDebitRecoveredUSD, // Send USD amount for email display
                    Math.max(0, remainingDebit)
                  )
                } catch (emailErr) {
                  console.error(`[paystack] Failed to send debit recovery email:`, emailErr)
                }
              }

              console.log(`[paystack] Recovered $${(platformDebitRecoveredUSD / 100).toFixed(2)} USD (${platformDebitRecoveredLocal} local) platform debit, transferring ${finalTransferAmount} to creator ${creatorId}`)
            }

            if (transferResult.status === 'otp') {
              console.log(`[paystack] Transfer ${payoutReference} requires OTP finalization`)
            } else {
              console.log(`[paystack] Initiated transfer of ${finalTransferAmount} to creator ${creatorId}`)
            }
          } catch (transferErr) {
            // Transfer failed - update payout record for manual retry
            console.error(`[paystack] Transfer failed for creator ${creatorId}:`, transferErr)
            await db.payment.update({
              where: { id: payoutRecord.id },
              data: { status: 'failed' },
            })
          }
        }
      } catch (err) {
        // Outer catch for unexpected errors (e.g., DB issues)
        console.error(`[paystack] Failed to process payout for creator ${creatorId}:`, err)
      }
    }) // End withLock for payout
  }

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
