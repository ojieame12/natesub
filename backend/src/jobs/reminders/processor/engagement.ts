/**
 * Engagement Reminder Processors
 *
 * Handles sending notifications for onboarding and engagement reminders.
 */

import { db } from '../../../db/client.js'
import { env } from '../../../config/env.js'
import type { ReminderChannel } from '@prisma/client'
import {
  sendOnboardingIncompleteEmail,
  sendBankSetupIncompleteEmail,
  sendNoSubscribersEmail,
  sendPayrollReadyEmail,
} from '../../../services/email.js'
import { sendBankSetupReminderSms } from '../../../services/sms.js'

export async function processOnboardingIncompleteReminder(
  userId: string,
  isSecondReminder: boolean
): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  })

  // Don't send if user has completed profile
  if (!user || user.profile) {
    return false
  }

  await sendOnboardingIncompleteEmail(user.email, isSecondReminder)

  return true
}

export async function processBankSetupIncompleteReminder(
  userId: string,
  channel: ReminderChannel
): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  })

  if (!user || !user.profile) return false

  // Check if bank details are missing
  const hasBankDetails =
    (user.profile.paymentProvider === 'paystack' && user.profile.paystackAccountNumber) ||
    (user.profile.paymentProvider === 'stripe' && user.profile.stripeAccountId)

  if (hasBankDetails) return false

  // Calculate pending earnings
  const pendingPayments = await db.payment.aggregate({
    where: {
      creatorId: userId,
      status: 'succeeded',
      type: { in: ['recurring', 'one_time'] },
    },
    _sum: { netCents: true },
  })

  const pendingAmount = pendingPayments._sum.netCents || 0
  if (pendingAmount === 0) return false

  // Get phone number for SMS (stored in profile)
  const phone = user.profile.phone || null

  if (channel === 'sms' && phone) {
    await sendBankSetupReminderSms(phone, pendingAmount, user.profile.currency)
  } else {
    await sendBankSetupIncompleteEmail(
      user.email,
      user.profile.displayName,
      pendingAmount,
      user.profile.currency
    )
  }

  return true
}

export async function processNoSubscribersReminder(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  })

  if (!user || !user.profile) return false

  // Check if user has any subscribers
  const subscriberCount = await db.subscription.count({
    where: { creatorId: userId },
  })

  if (subscriberCount > 0) return false

  const shareUrl = user.profile.shareUrl || `${env.PUBLIC_PAGE_URL}/${user.profile.username}`

  await sendNoSubscribersEmail(user.email, user.profile.displayName, shareUrl)

  return true
}

export async function processPayrollReadyReminder(payrollPeriodId: string): Promise<boolean> {
  const period = await db.payrollPeriod.findUnique({
    where: { id: payrollPeriodId },
    include: {
      user: { include: { profile: true } },
    },
  })

  if (!period || !period.user.profile) return false

  await sendPayrollReadyEmail(
    period.user.email,
    period.user.profile.displayName,
    period.periodStart,
    period.periodEnd,
    period.netCents,
    period.currency
  )

  return true
}
