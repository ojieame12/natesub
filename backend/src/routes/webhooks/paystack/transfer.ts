import { db } from '../../../db/client.js'
import { scheduleReminder } from '../../../jobs/reminders.js'
import { notifyPayoutCompleted, notifyPayoutFailed } from '../../../services/notifications.js'
import { alertPayoutFailed } from '../../../services/slack.js'

// Handle Paystack transfer.success - update payout record
export async function handlePaystackTransferSuccess(data: any) {
  const { reference, amount, currency, recipient } = data

  // Find the payout record by reference
  const payout = await db.payment.findFirst({
    where: {
      paystackTransactionRef: reference,
      type: 'payout',
    },
  })

  if (!payout) {
    console.log(`[paystack] Transfer success but no payout record found: ${reference}`)
    return
  }

  // IDEMPOTENCY: Skip if already marked as succeeded
  if (payout.status === 'succeeded') {
    console.log(`[paystack] Transfer ${reference} already marked succeeded, skipping`)
    return
  }

  // SECURITY: Verify amount and currency match our payout record
  // Mismatches could indicate data corruption, webhook tampering, or bugs
  const webhookCurrency = currency?.toUpperCase()
  const payoutCurrency = payout.currency?.toUpperCase()

  // Amount from Paystack is in smallest unit (kobo/cents), same as our amountCents
  const amountMismatch = amount !== payout.amountCents
  const currencyMismatch = webhookCurrency && payoutCurrency && webhookCurrency !== payoutCurrency

  if (amountMismatch || currencyMismatch) {
    // Log critical alert - this should never happen in normal operation
    // All details captured in log for investigation
    console.error(`[paystack] CRITICAL: Transfer amount/currency mismatch!`, {
      reference,
      payoutId: payout.id,
      webhookAmount: amount,
      payoutAmount: payout.amountCents,
      webhookCurrency,
      payoutCurrency,
      creatorId: payout.creatorId,
    })

    // Mark payout as disputed (requires manual investigation)
    // This prevents incorrect balance tracking while preserving the record
    await db.payment.update({
      where: { id: payout.id },
      data: { status: 'disputed' },
    })

    // Create activity for ops team to investigate
    await db.activity.create({
      data: {
        userId: payout.creatorId,
        type: 'payout_mismatch',
        payload: {
          payoutId: payout.id,
          reference,
          webhookAmount: amount,
          payoutAmount: payout.amountCents,
          webhookCurrency,
          payoutCurrency,
        },
      },
    })

    // Throw to trigger webhook retry and alert ops team
    throw new Error(`Transfer amount/currency mismatch for ${reference}`)
  }

  // Update payout status to succeeded
  await db.payment.update({
    where: { id: payout.id },
    data: { status: 'succeeded' },
  })

  // Schedule payout completed email notification (sends immediately)
  await scheduleReminder({
    userId: payout.creatorId,
    entityType: 'payment',
    entityId: payout.id,
    type: 'payout_completed',
    scheduledFor: new Date(), // Send immediately
  })

  // Send real-time notification (WhatsApp/SMS preferred for African markets)
  notifyPayoutCompleted(
    payout.creatorId,
    payout.amountCents,
    payout.currency
  ).catch(err => console.error('[paystack] Notification failed:', err))

  // Create activity for creator (only on first processing)
  await db.activity.create({
    data: {
      userId: payout.creatorId,
      type: 'payout_completed',
      payload: {
        payoutId: payout.id,
        amount: amount,
        currency: payout.currency,
        reference,
        recipientName: recipient?.name,
      },
    },
  })

  console.log(`[paystack] Transfer succeeded: ${reference}, amount: ${amount}`)
}

// Handle Paystack transfer.failed - update payout record and notify creator
export async function handlePaystackTransferFailed(data: any) {
  const { reference, reason, recipient } = data

  // Find the payout record
  const payout = await db.payment.findFirst({
    where: {
      paystackTransactionRef: reference,
      type: 'payout',
    },
  })

  if (!payout) {
    console.log(`[paystack] Transfer failed but no payout record found: ${reference}`)
    return
  }

  // IDEMPOTENCY: Skip if already marked as failed
  // (also skip if succeeded - a success can't become a failure)
  if (payout.status === 'failed' || payout.status === 'succeeded') {
    console.log(`[paystack] Transfer ${reference} already in final state (${payout.status}), skipping`)
    return
  }

  // Update payout status to failed
  await db.payment.update({
    where: { id: payout.id },
    data: { status: 'failed' },
  })

  // Update creator's payout status to indicate issue
  const creatorProfile = await db.profile.findUnique({
    where: { userId: payout.creatorId },
  })

  if (creatorProfile) {
    await db.profile.update({
      where: { id: creatorProfile.id },
      data: { payoutStatus: 'restricted' },
    })
  }

  // Schedule payout failed email notification (sends immediately)
  await scheduleReminder({
    userId: payout.creatorId,
    entityType: 'payment',
    entityId: payout.id,
    type: 'payout_failed',
    scheduledFor: new Date(), // Send immediately
  })

  // Send real-time notification (WhatsApp/SMS preferred for African markets)
  notifyPayoutFailed(
    payout.creatorId,
    payout.amountCents,
    payout.currency
  ).catch(err => console.error('[paystack] Notification failed:', err))

  // Get creator details for Slack alert
  const creator = await db.user.findUnique({
    where: { id: payout.creatorId },
    select: { email: true },
  })

  // Alert ops team via Slack
  alertPayoutFailed({
    creatorEmail: creator?.email || 'unknown',
    creatorName: creatorProfile?.displayName || 'Unknown Creator',
    amount: payout.amountCents,
    currency: payout.currency,
    error: reason || 'Transfer failed',
    paystackTransferCode: reference,
  }).catch(err => console.error('[slack] Failed to send payout failed alert:', err))

  // Create activity for creator notification (only on first processing)
  await db.activity.create({
    data: {
      userId: payout.creatorId,
      type: 'payout_failed',
      payload: {
        payoutId: payout.id,
        amount: payout.amountCents,
        currency: payout.currency,
        reference,
        reason: reason || 'Transfer failed',
        recipientName: recipient?.name,
      },
    },
  })

  console.log(`[paystack] Transfer failed: ${reference}, reason: ${reason}`)
}

// Handle Paystack transfer.requires_otp - mark payout as needing OTP finalization
export async function handlePaystackTransferRequiresOtp(data: any) {
  const { reference, transfer_code: transferCode } = data

  // Find the payout record
  const payout = await db.payment.findFirst({
    where: {
      paystackTransactionRef: reference,
      type: 'payout',
    },
  })

  if (!payout) {
    console.log(`[paystack] Transfer requires OTP but no payout record found: ${reference}`)
    return
  }

  // Update payout to otp_pending status and store transfer code
  await db.payment.update({
    where: { id: payout.id },
    data: {
      status: 'otp_pending',
      paystackTransferCode: transferCode,
    },
  })

  // Create activity for creator notification
  await db.activity.create({
    data: {
      userId: payout.creatorId,
      type: 'payout_otp_required',
      payload: {
        payoutId: payout.id,
        amount: payout.amountCents,
        currency: payout.currency,
        reference,
        transferCode,
        message: 'Transfer requires OTP verification. Please check your email/phone for the OTP.',
      },
    },
  })

  console.log(`[paystack] Transfer requires OTP: ${reference}, transfer_code: ${transferCode}`)
}
