/**
 * Subscription Reminder Processors
 *
 * Handles sending notifications for subscription lifecycle and payouts.
 */

import { db } from '../../../db/client.js'
import type { ReminderChannel } from '@prisma/client'
import {
  sendRenewalReminderEmail,
  sendPaymentFailedEmail,
  sendPayoutCompletedEmail,
  sendPayoutFailedEmail,
} from '../../../services/email.js'
import {
  sendPayoutCompletedSms,
  sendPayoutFailedSms,
} from '../../../services/sms.js'
import { calculateServiceFee, calculateLegacyServiceFee } from '../../../services/fees.js'
import { isStripeCrossBorderSupported } from '../../../utils/constants.js'
import { decryptAccountNumber } from '../../../utils/encryption.js'
import { generateCancelUrl, generateManageUrl } from '../../../utils/cancelToken.js'

export async function processSubscriptionRenewalReminder(
  subscriptionId: string,
  _daysUntilRenewal: number
): Promise<boolean> {
  const subscription = await db.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      subscriber: true,
      creator: {
        include: {
          profile: {
            select: {
              displayName: true,
              purpose: true,
              countryCode: true, // Needed for cross-border fee calculation
            },
          },
        },
      },
    },
  })

  // Don't send if subscription is no longer active
  if (!subscription || subscription.status !== 'active') {
    return false
  }

  // Don't send if pending cancellation
  if (subscription.cancelAtPeriodEnd) {
    return false
  }

  const providerName = subscription.creator.profile?.displayName || 'a creator'
  const renewalDate = subscription.currentPeriodEnd || new Date()

  // Calculate the fee-inclusive amount the subscriber actually pays
  const baseAmount = subscription.amount
  let chargeAmount: number

  // Check cross-border status for correct fee buffer
  const countryCode = subscription.creator?.profile?.countryCode
  const isCrossBorder = countryCode ? isStripeCrossBorderSupported(countryCode) : false

  if (subscription.feeModel === 'split_v1') {
    // Split model: subscriber pays base + 4.5% (or more for cross-border)
    const feeCalc = calculateServiceFee(
      baseAmount,
      subscription.currency,
      subscription.creator.profile?.purpose,
      undefined,
      isCrossBorder
    )
    chargeAmount = feeCalc.grossCents
  } else if (subscription.feeModel && subscription.feeMode === 'pass_to_subscriber') {
    // Legacy pass_to_subscriber: subscriber pays base + 9%
    const legacyFee = calculateLegacyServiceFee(
      baseAmount,
      subscription.currency,
      subscription.creator.profile?.purpose as 'personal' | 'service' | null
    )
    chargeAmount = legacyFee.grossCents
  } else {
    // Legacy absorb or no feeModel: subscriber pays base only
    chargeAmount = baseAmount
  }

  // Generate signed cancel URL for 1-click cancellation without login
  const cancelUrl = generateCancelUrl(subscriptionId, subscription.manageTokenNonce)

  // Generate manage URL for our branded subscription management page
  const manageUrl = generateManageUrl(subscriptionId, subscription.manageTokenNonce)

  await sendRenewalReminderEmail(
    subscription.subscriber.email,
    providerName,
    chargeAmount,
    subscription.currency,
    renewalDate,
    cancelUrl,
    manageUrl
  )

  return true
}

export async function processSubscriptionPaymentFailedReminder(
  subscriptionId: string
): Promise<boolean> {
  const subscription = await db.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      subscriber: true,
      creator: {
        include: {
          profile: {
            select: {
              displayName: true,
              purpose: true,
              countryCode: true,
            },
          },
        },
      },
    },
  })

  if (!subscription) return false

  const providerName = subscription.creator.profile?.displayName || 'a creator'

  // Calculate next retry date (24h from now if still retrying)
  const retryDate = subscription.status === 'active'
    ? new Date(Date.now() + 24 * 60 * 60 * 1000)
    : null

  // Calculate the fee-inclusive amount
  const baseAmount = subscription.amount
  let chargeAmount: number

  const countryCode = subscription.creator?.profile?.countryCode
  const isCrossBorder = countryCode ? isStripeCrossBorderSupported(countryCode) : false

  if (subscription.feeModel === 'split_v1') {
    const feeCalc = calculateServiceFee(
      baseAmount,
      subscription.currency,
      subscription.creator.profile?.purpose,
      undefined,
      isCrossBorder
    )
    chargeAmount = feeCalc.grossCents
  } else if (subscription.feeModel && subscription.feeMode === 'pass_to_subscriber') {
    const legacyFee = calculateLegacyServiceFee(
      baseAmount,
      subscription.currency,
      subscription.creator.profile?.purpose as 'personal' | 'service' | null
    )
    chargeAmount = legacyFee.grossCents
  } else {
    chargeAmount = baseAmount
  }

  // Generate manage URL for our branded subscription management page
  const manageUrl = generateManageUrl(subscriptionId, subscription.manageTokenNonce)

  await sendPaymentFailedEmail(
    subscription.subscriber.email,
    providerName,
    chargeAmount,
    subscription.currency,
    retryDate,
    manageUrl
  )

  return true
}

export async function processSubscriptionPastDueReminder(
  subscriptionId: string
): Promise<boolean> {
  const subscription = await db.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      subscriber: true,
      creator: {
        include: {
          profile: {
            select: {
              displayName: true,
              purpose: true,
              countryCode: true,
            },
          },
        },
      },
    },
  })

  if (!subscription || subscription.status !== 'past_due') {
    return false
  }

  const providerName = subscription.creator.profile?.displayName || 'a creator'

  // Calculate the fee-inclusive amount
  const baseAmount = subscription.amount
  let chargeAmount: number

  const countryCode = subscription.creator?.profile?.countryCode
  const isCrossBorder = countryCode ? isStripeCrossBorderSupported(countryCode) : false

  if (subscription.feeModel === 'split_v1') {
    const feeCalc = calculateServiceFee(
      baseAmount,
      subscription.currency,
      subscription.creator.profile?.purpose,
      undefined,
      isCrossBorder
    )
    chargeAmount = feeCalc.grossCents
  } else if (subscription.feeModel && subscription.feeMode === 'pass_to_subscriber') {
    const legacyFee = calculateLegacyServiceFee(
      baseAmount,
      subscription.currency,
      subscription.creator.profile?.purpose as 'personal' | 'service' | null
    )
    chargeAmount = legacyFee.grossCents
  } else {
    chargeAmount = baseAmount
  }

  // Generate manage URL for our branded subscription management page
  const manageUrl = generateManageUrl(subscriptionId, subscription.manageTokenNonce)

  // Send payment failed with no retry date (indicating it's past due)
  await sendPaymentFailedEmail(
    subscription.subscriber.email,
    providerName,
    chargeAmount,
    subscription.currency,
    null, // No more retries
    manageUrl
  )

  return true
}

export async function processPayoutCompletedReminder(
  paymentId: string,
  channel: ReminderChannel
): Promise<boolean> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
  })

  if (!payment || payment.type !== 'payout' || payment.status !== 'succeeded') {
    return false
  }

  const user = await db.user.findUnique({
    where: { id: payment.creatorId },
    include: { profile: true },
  })

  if (!user || !user.profile) return false

  // Get phone number for SMS (stored in profile)
  const phone = user.profile.phone || null

  // Decrypt account number and get last 4 digits
  const accountNumber = decryptAccountNumber(user.profile.paystackAccountNumber)
  const bankLast4 = accountNumber?.slice(-4) || null

  if (channel === 'sms' && phone) {
    await sendPayoutCompletedSms(phone, payment.amountCents, payment.currency)
  } else {
    await sendPayoutCompletedEmail(
      user.email,
      user.profile.displayName,
      payment.amountCents,
      payment.currency,
      bankLast4
    )
  }

  return true
}

export async function processPayoutFailedReminder(
  paymentId: string,
  channel: ReminderChannel
): Promise<boolean> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
  })

  if (!payment || payment.type !== 'payout' || payment.status !== 'failed') {
    return false
  }

  const user = await db.user.findUnique({
    where: { id: payment.creatorId },
    include: { profile: true },
  })

  if (!user || !user.profile) return false

  // Get phone number for SMS (stored in profile)
  const phone = user.profile.phone || null

  if (channel === 'sms' && phone) {
    await sendPayoutFailedSms(phone, payment.amountCents, payment.currency)
  } else {
    await sendPayoutFailedEmail(
      user.email,
      user.profile.displayName,
      payment.amountCents,
      payment.currency
    )
  }

  return true
}
