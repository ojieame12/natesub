// Bird SMS Service (formerly MessageBird)
// Sends SMS messages for critical payment notifications
// API Docs: https://docs.bird.com/api/channels-api/supported-channels/programmable-sms

import { env } from '../config/env.js'
import { centsToDisplayAmount, isZeroDecimalCurrency } from '../utils/currency.js'

// ============================================
// CONFIGURATION
// ============================================

const BIRD_API_BASE = 'https://api.bird.com'

// Countries where SMS is preferred (lower email open rates)
const SMS_PREFERRED_COUNTRIES = ['NG', 'KE', 'ZA', 'GH', 'TZ', 'UG']

// Check if SMS is enabled and configured
export function isSmsEnabled(): boolean {
  return !!(
    env.ENABLE_SMS &&
    env.BIRD_ACCESS_KEY &&
    env.BIRD_WORKSPACE_ID &&
    env.BIRD_CHANNEL_ID
  )
}

// Check if SMS should be used for a country
export function shouldUseSms(countryCode: string | null): boolean {
  if (!isSmsEnabled()) return false
  if (!countryCode) return false
  return SMS_PREFERRED_COUNTRIES.includes(countryCode.toUpperCase())
}

// ============================================
// API CLIENT
// ============================================

interface BirdMessageResponse {
  id: string
  status: 'accepted' | 'delivered' | 'failed'
}

async function sendBirdMessage(
  phoneNumber: string,
  message: string
): Promise<BirdMessageResponse> {
  if (!isSmsEnabled()) {
    throw new Error('SMS is not enabled or configured')
  }

  const url = `${BIRD_API_BASE}/workspaces/${env.BIRD_WORKSPACE_ID}/channels/${env.BIRD_CHANNEL_ID}/messages`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `AccessKey ${env.BIRD_ACCESS_KEY}`,
    },
    body: JSON.stringify({
      receiver: {
        contacts: [
          { identifierValue: phoneNumber }
        ],
      },
      body: {
        type: 'text',
        text: { text: message },
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`[sms] Bird API error: ${response.status} ${errorText}`)
    throw new Error(`Bird SMS failed: ${response.status}`)
  }

  const result = await response.json() as BirdMessageResponse
  console.log(`[sms] Message sent to ${maskPhone(phoneNumber)}: ${result.id}`)
  return result
}

// ============================================
// HELPERS
// ============================================

function maskPhone(phone: string): string {
  if (phone.length < 6) return '****'
  return phone.slice(0, 4) + '****' + phone.slice(-2)
}

function formatAmount(amountCents: number, currency: string): string {
  const displayAmount = centsToDisplayAmount(amountCents, currency)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: isZeroDecimalCurrency(currency) ? 0 : 2,
    maximumFractionDigits: isZeroDecimalCurrency(currency) ? 0 : 2,
  }).format(displayAmount)
}

// ============================================
// SMS TEMPLATES (Short, actionable messages)
// ============================================

// Request/Invoice reminders
export async function sendRequestReminderSms(
  to: string,
  senderName: string,
  isUrgent: boolean = false
): Promise<void> {
  const message = isUrgent
    ? `REMINDER: ${senderName} is waiting for your response. This request expires soon. Tap to respond.`
    : `${senderName} sent you a payment request. Tap to view and respond.`

  await sendBirdMessage(to, message)
}

export async function sendInvoiceDueSms(
  to: string,
  senderName: string,
  amount: number,
  currency: string,
  daysUntilDue: number
): Promise<void> {
  const formattedAmount = formatAmount(amount, currency)
  const urgency = daysUntilDue === 1 ? 'tomorrow' : `in ${daysUntilDue} days`

  const message = `Invoice from ${senderName} for ${formattedAmount} is due ${urgency}. Tap to pay now.`

  await sendBirdMessage(to, message)
}

export async function sendInvoiceOverdueSms(
  to: string,
  senderName: string,
  amount: number,
  currency: string,
  daysOverdue: number
): Promise<void> {
  const formattedAmount = formatAmount(amount, currency)

  const message = `OVERDUE: Invoice from ${senderName} for ${formattedAmount} is ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} past due. Tap to pay.`

  await sendBirdMessage(to, message)
}

// Payout notifications
export async function sendPayoutCompletedSms(
  to: string,
  amount: number,
  currency: string
): Promise<void> {
  const formattedAmount = formatAmount(amount, currency)

  const message = `${formattedAmount} has been sent to your bank account. Funds arrive within 1-2 business days.`

  await sendBirdMessage(to, message)
}

export async function sendPayoutFailedSms(
  to: string,
  amount: number,
  currency: string
): Promise<void> {
  const formattedAmount = formatAmount(amount, currency)

  const message = `Payout of ${formattedAmount} failed. Please check your bank details in settings. We'll retry automatically.`

  await sendBirdMessage(to, message)
}

// Payment received (for creators)
export async function sendPaymentReceivedSms(
  to: string,
  subscriberName: string,
  amount: number,
  currency: string
): Promise<void> {
  const formattedAmount = formatAmount(amount, currency)

  const message = `You received ${formattedAmount} from ${subscriberName}!`

  await sendBirdMessage(to, message)
}

// Subscription renewal reminder
export async function sendRenewalReminderSms(
  to: string,
  creatorName: string,
  amount: number,
  currency: string
): Promise<void> {
  const formattedAmount = formatAmount(amount, currency)

  const message = `Your ${formattedAmount} subscription to ${creatorName} renews in 3 days. Tap to manage.`

  await sendBirdMessage(to, message)
}

// Payment failed (for subscribers)
export async function sendPaymentFailedSms(
  to: string,
  creatorName: string
): Promise<void> {
  const message = `Payment failed for your subscription to ${creatorName}. Update your payment method to continue.`

  await sendBirdMessage(to, message)
}

// Bank setup reminder
export async function sendBankSetupReminderSms(
  to: string,
  pendingAmount: number,
  currency: string
): Promise<void> {
  const formattedAmount = formatAmount(pendingAmount, currency)

  const message = `You have ${formattedAmount} waiting! Add your bank details to receive your earnings.`

  await sendBirdMessage(to, message)
}

// OTP / Verification (if needed)
export async function sendVerificationSms(
  to: string,
  code: string
): Promise<void> {
  const message = `Your verification code is: ${code}. Valid for 15 minutes. Don't share this code.`

  await sendBirdMessage(to, message)
}

export default {
  isSmsEnabled,
  shouldUseSms,
  sendRequestReminderSms,
  sendInvoiceDueSms,
  sendInvoiceOverdueSms,
  sendPayoutCompletedSms,
  sendPayoutFailedSms,
  sendPaymentReceivedSms,
  sendRenewalReminderSms,
  sendPaymentFailedSms,
  sendBankSetupReminderSms,
  sendVerificationSms,
}
