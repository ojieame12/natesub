// Unified Notification Service
// Routes notifications to the best channel (email, SMS, WhatsApp) based on:
// 1. User preferences
// 2. Country/region
// 3. Channel availability
//
// Channel priority by region:
// - Africa (NG, KE, ZA, GH, TZ, UG): WhatsApp > SMS > Email
// - UK/EU: WhatsApp > Email > SMS
// - US/Other: Email > SMS > WhatsApp

import { db } from '../db/client.js'
import { isSmsEnabled, sendPaymentReceivedSms, sendPayoutCompletedSms, sendPayoutFailedSms } from './sms.js'
import { isWhatsAppEnabled, sendNewSubscriberWhatsApp, sendPaymentReceivedWhatsApp, sendPayoutSentWhatsApp, sendPayoutFailedWhatsApp } from './whatsapp.js'
import { sendNewSubscriberEmail, sendPayoutCompletedEmail, sendPayoutFailedEmail } from './email.js'

// ============================================
// TYPES
// ============================================

type NotificationChannel = 'email' | 'sms' | 'whatsapp'

interface NotificationResult {
  sent: boolean
  channel: NotificationChannel | null
  error?: string
}

interface UserContactInfo {
  email: string
  phone?: string | null
  displayName?: string | null
  countryCode?: string | null
}

// ============================================
// CHANNEL SELECTION
// ============================================

/**
 * Determine the best notification channel for a user
 * Priority varies by region - African markets prefer WhatsApp/SMS
 */
function getBestChannel(
  user: UserContactInfo,
  notificationType: 'critical' | 'important' | 'informational'
): NotificationChannel {
  const countryCode = user.countryCode?.toUpperCase() || null

  // African markets: WhatsApp preferred, SMS fallback
  const africaMarkets = ['NG', 'KE', 'ZA', 'GH', 'TZ', 'UG']
  const whatsappMarkets = [...africaMarkets, 'GB', 'IN', 'BR']

  // Critical notifications (payout, payment failed): Try WhatsApp/SMS first
  if (notificationType === 'critical') {
    if (user.phone) {
      if (isWhatsAppEnabled() && countryCode && whatsappMarkets.includes(countryCode)) {
        return 'whatsapp'
      }
      if (isSmsEnabled() && countryCode && africaMarkets.includes(countryCode)) {
        return 'sms'
      }
    }
    return 'email'
  }

  // Important notifications: Prefer WhatsApp in supported regions
  if (notificationType === 'important') {
    if (user.phone && isWhatsAppEnabled() && countryCode && whatsappMarkets.includes(countryCode)) {
      return 'whatsapp'
    }
    return 'email'
  }

  // Informational: Email is fine
  return 'email'
}

// ============================================
// NOTIFICATION FUNCTIONS
// ============================================

/**
 * Notify creator of new subscriber
 * Channel: WhatsApp > Email
 */
export async function notifyNewSubscriber(
  creatorId: string,
  subscriberName: string,
  tierName: string | null,
  amountCents: number,
  currency: string
): Promise<NotificationResult> {
  try {
    const creator = await db.user.findUnique({
      where: { id: creatorId },
      include: { profile: { select: { displayName: true, phone: true, countryCode: true } } },
    })

    if (!creator) {
      return { sent: false, channel: null, error: 'Creator not found' }
    }

    const userInfo: UserContactInfo = {
      email: creator.email,
      phone: creator.profile?.phone,
      displayName: creator.profile?.displayName,
      countryCode: creator.profile?.countryCode,
    }

    const channel = getBestChannel(userInfo, 'important')

    if (channel === 'whatsapp' && userInfo.phone) {
      await sendNewSubscriberWhatsApp(
        userInfo.phone,
        subscriberName,
        amountCents,
        currency
      )
      console.log(`[notifications] New subscriber notification sent via WhatsApp to ${creatorId}`)
      return { sent: true, channel: 'whatsapp' }
    }

    // Fallback to email
    await sendNewSubscriberEmail(
      creator.email,
      subscriberName,
      tierName,
      amountCents,
      currency
    )
    console.log(`[notifications] New subscriber notification sent via email to ${creatorId}`)
    return { sent: true, channel: 'email' }
  } catch (error: any) {
    console.error(`[notifications] Failed to notify new subscriber:`, error.message)
    return { sent: false, channel: null, error: error.message }
  }
}

/**
 * Notify creator of payment received
 * Channel: WhatsApp/SMS > Email (critical for African markets)
 */
export async function notifyPaymentReceived(
  creatorId: string,
  subscriberName: string,
  amountCents: number,
  currency: string
): Promise<NotificationResult> {
  try {
    const creator = await db.user.findUnique({
      where: { id: creatorId },
      include: { profile: { select: { displayName: true, phone: true, countryCode: true } } },
    })

    if (!creator) {
      return { sent: false, channel: null, error: 'Creator not found' }
    }

    const userInfo: UserContactInfo = {
      email: creator.email,
      phone: creator.profile?.phone,
      displayName: creator.profile?.displayName,
      countryCode: creator.profile?.countryCode,
    }

    const channel = getBestChannel(userInfo, 'important')

    if (channel === 'whatsapp' && userInfo.phone) {
      await sendPaymentReceivedWhatsApp(
        userInfo.phone,
        subscriberName,
        amountCents,
        currency
      )
      return { sent: true, channel: 'whatsapp' }
    }

    if (channel === 'sms' && userInfo.phone) {
      await sendPaymentReceivedSms(
        userInfo.phone,
        subscriberName,
        amountCents,
        currency
      )
      return { sent: true, channel: 'sms' }
    }

    // Email is handled by webhook directly for now
    // Could add email fallback here if needed
    return { sent: false, channel: null, error: 'No mobile channel available' }
  } catch (error: any) {
    console.error(`[notifications] Failed to notify payment received:`, error.message)
    return { sent: false, channel: null, error: error.message }
  }
}

/**
 * Notify creator of payout sent to bank
 * Channel: WhatsApp/SMS > Email (critical - money movement)
 */
export async function notifyPayoutCompleted(
  creatorId: string,
  amountCents: number,
  currency: string,
  bankLast4?: string | null
): Promise<NotificationResult> {
  try {
    const creator = await db.user.findUnique({
      where: { id: creatorId },
      include: { profile: { select: { displayName: true, phone: true, countryCode: true } } },
    })

    if (!creator) {
      return { sent: false, channel: null, error: 'Creator not found' }
    }

    const userInfo: UserContactInfo = {
      email: creator.email,
      phone: creator.profile?.phone,
      displayName: creator.profile?.displayName,
      countryCode: creator.profile?.countryCode,
    }

    const channel = getBestChannel(userInfo, 'critical')

    if (channel === 'whatsapp' && userInfo.phone) {
      await sendPayoutSentWhatsApp(userInfo.phone, amountCents, currency)
      console.log(`[notifications] Payout notification sent via WhatsApp to ${creatorId}`)
      return { sent: true, channel: 'whatsapp' }
    }

    if (channel === 'sms' && userInfo.phone) {
      await sendPayoutCompletedSms(userInfo.phone, amountCents, currency)
      console.log(`[notifications] Payout notification sent via SMS to ${creatorId}`)
      return { sent: true, channel: 'sms' }
    }

    // Email fallback
    await sendPayoutCompletedEmail(
      creator.email,
      userInfo.displayName || 'there',
      amountCents,
      currency,
      bankLast4 || null
    )
    console.log(`[notifications] Payout notification sent via email to ${creatorId}`)
    return { sent: true, channel: 'email' }
  } catch (error: any) {
    console.error(`[notifications] Failed to notify payout completed:`, error.message)
    return { sent: false, channel: null, error: error.message }
  }
}

/**
 * Notify creator of payout failure
 * Channel: WhatsApp/SMS > Email (critical - action required)
 */
export async function notifyPayoutFailed(
  creatorId: string,
  amountCents: number,
  currency: string
): Promise<NotificationResult> {
  try {
    const creator = await db.user.findUnique({
      where: { id: creatorId },
      include: { profile: { select: { displayName: true, phone: true, countryCode: true } } },
    })

    if (!creator) {
      return { sent: false, channel: null, error: 'Creator not found' }
    }

    const userInfo: UserContactInfo = {
      email: creator.email,
      phone: creator.profile?.phone,
      displayName: creator.profile?.displayName,
      countryCode: creator.profile?.countryCode,
    }

    const channel = getBestChannel(userInfo, 'critical')

    if (channel === 'whatsapp' && userInfo.phone) {
      await sendPayoutFailedWhatsApp(userInfo.phone, amountCents, currency)
      console.log(`[notifications] Payout failed notification sent via WhatsApp to ${creatorId}`)
      return { sent: true, channel: 'whatsapp' }
    }

    if (channel === 'sms' && userInfo.phone) {
      await sendPayoutFailedSms(userInfo.phone, amountCents, currency)
      console.log(`[notifications] Payout failed notification sent via SMS to ${creatorId}`)
      return { sent: true, channel: 'sms' }
    }

    // Email fallback
    await sendPayoutFailedEmail(
      creator.email,
      userInfo.displayName || 'there',
      amountCents,
      currency
    )
    console.log(`[notifications] Payout failed notification sent via email to ${creatorId}`)
    return { sent: true, channel: 'email' }
  } catch (error: any) {
    console.error(`[notifications] Failed to notify payout failed:`, error.message)
    return { sent: false, channel: null, error: error.message }
  }
}

export default {
  notifyNewSubscriber,
  notifyPaymentReceived,
  notifyPayoutCompleted,
  notifyPayoutFailed,
}
