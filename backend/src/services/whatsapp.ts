// Bird WhatsApp Service
// Sends WhatsApp messages via Bird's API using pre-approved templates
// Templates must be approved by Meta before use
// API Docs: https://docs.bird.com/api/channels-api/supported-channels/programmable-whatsapp

import { env } from '../config/env.js'
import { centsToDisplayAmount, isZeroDecimalCurrency } from '../utils/currency.js'

// ============================================
// CONFIGURATION
// ============================================

const BIRD_API_BASE = 'https://api.bird.com'

// Countries where WhatsApp is preferred (high WhatsApp adoption)
const WHATSAPP_PREFERRED_COUNTRIES = ['NG', 'KE', 'ZA', 'GH', 'TZ', 'UG', 'GB', 'IN', 'BR']

// Check if WhatsApp is enabled and configured
export function isWhatsAppEnabled(): boolean {
  return !!(
    env.ENABLE_WHATSAPP &&
    env.BIRD_ACCESS_KEY &&
    env.BIRD_WORKSPACE_ID &&
    env.BIRD_WHATSAPP_CHANNEL_ID
  )
}

// Check if WhatsApp should be used for a country
export function shouldUseWhatsApp(countryCode: string | null): boolean {
  if (!isWhatsAppEnabled()) return false
  if (!countryCode) return false
  return WHATSAPP_PREFERRED_COUNTRIES.includes(countryCode.toUpperCase())
}

// ============================================
// API CLIENT
// ============================================

interface BirdWhatsAppResponse {
  id: string
  status: 'accepted' | 'delivered' | 'failed' | 'sent'
}

interface WhatsAppTemplateParams {
  templateName: string
  languageCode?: string
  components?: Array<{
    type: 'body' | 'header' | 'button'
    parameters: Array<{
      type: 'text' | 'currency' | 'date_time'
      text?: string
      currency?: { code: string; amount_1000: number }
    }>
  }>
}

/**
 * Send a WhatsApp template message via Bird
 * Templates must be pre-approved by Meta
 */
async function sendWhatsAppTemplate(
  phoneNumber: string,
  template: WhatsAppTemplateParams
): Promise<BirdWhatsAppResponse> {
  if (!isWhatsAppEnabled()) {
    throw new Error('WhatsApp is not enabled or configured')
  }

  const url = `${BIRD_API_BASE}/workspaces/${env.BIRD_WORKSPACE_ID}/channels/${env.BIRD_WHATSAPP_CHANNEL_ID}/messages`

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
        type: 'hsm', // High-Structured Message (template)
        hsm: {
          templateName: template.templateName,
          language: {
            code: template.languageCode || 'en',
          },
          components: template.components || [],
        },
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`[whatsapp] Bird API error: ${response.status} ${errorText}`)
    throw new Error(`Bird WhatsApp failed: ${response.status}`)
  }

  const result = await response.json() as BirdWhatsAppResponse
  console.log(`[whatsapp] Template message sent to ${maskPhone(phoneNumber)}: ${result.id}`)
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
// WHATSAPP TEMPLATES
// Template names must match those approved in Meta/Bird
// ============================================

/**
 * New subscriber notification to creator
 * Template: new_subscriber
 * Variables: {{1}} = subscriber name, {{2}} = amount
 */
export async function sendNewSubscriberWhatsApp(
  to: string,
  subscriberName: string,
  amount: number,
  currency: string
): Promise<void> {
  const formattedAmount = formatAmount(amount, currency)

  await sendWhatsAppTemplate(to, {
    templateName: 'new_subscriber',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: subscriberName },
          { type: 'text', text: formattedAmount },
        ],
      },
    ],
  })
}

/**
 * Payment received notification to creator
 * Template: payment_received
 * Variables: {{1}} = amount, {{2}} = subscriber name
 */
export async function sendPaymentReceivedWhatsApp(
  to: string,
  subscriberName: string,
  amount: number,
  currency: string
): Promise<void> {
  const formattedAmount = formatAmount(amount, currency)

  await sendWhatsAppTemplate(to, {
    templateName: 'payment_received',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: formattedAmount },
          { type: 'text', text: subscriberName },
        ],
      },
    ],
  })
}

/**
 * Payout sent notification to creator
 * Template: payout_sent
 * Variables: {{1}} = amount
 */
export async function sendPayoutSentWhatsApp(
  to: string,
  amount: number,
  currency: string
): Promise<void> {
  const formattedAmount = formatAmount(amount, currency)

  await sendWhatsAppTemplate(to, {
    templateName: 'payout_sent',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: formattedAmount },
        ],
      },
    ],
  })
}

/**
 * Payout failed notification to creator
 * Template: payout_failed
 * Variables: {{1}} = amount
 */
export async function sendPayoutFailedWhatsApp(
  to: string,
  amount: number,
  currency: string
): Promise<void> {
  const formattedAmount = formatAmount(amount, currency)

  await sendWhatsAppTemplate(to, {
    templateName: 'payout_failed',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: formattedAmount },
        ],
      },
    ],
  })
}

/**
 * Payment failed notification to subscriber
 * Template: payment_failed
 * Variables: {{1}} = creator name
 */
export async function sendPaymentFailedWhatsApp(
  to: string,
  creatorName: string
): Promise<void> {
  await sendWhatsAppTemplate(to, {
    templateName: 'payment_failed',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: creatorName },
        ],
      },
    ],
  })
}

/**
 * Renewal reminder to subscriber
 * Template: renewal_reminder
 * Variables: {{1}} = amount, {{2}} = creator name
 */
export async function sendRenewalReminderWhatsApp(
  to: string,
  creatorName: string,
  amount: number,
  currency: string
): Promise<void> {
  const formattedAmount = formatAmount(amount, currency)

  await sendWhatsAppTemplate(to, {
    templateName: 'renewal_reminder',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: formattedAmount },
          { type: 'text', text: creatorName },
        ],
      },
    ],
  })
}

/**
 * Bank setup reminder to creator
 * Template: bank_setup_reminder
 * Variables: {{1}} = pending amount
 */
export async function sendBankSetupReminderWhatsApp(
  to: string,
  pendingAmount: number,
  currency: string
): Promise<void> {
  const formattedAmount = formatAmount(pendingAmount, currency)

  await sendWhatsAppTemplate(to, {
    templateName: 'bank_setup_reminder',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: formattedAmount },
        ],
      },
    ],
  })
}

export default {
  isWhatsAppEnabled,
  shouldUseWhatsApp,
  sendNewSubscriberWhatsApp,
  sendPaymentReceivedWhatsApp,
  sendPayoutSentWhatsApp,
  sendPayoutFailedWhatsApp,
  sendPaymentFailedWhatsApp,
  sendRenewalReminderWhatsApp,
  sendBankSetupReminderWhatsApp,
}
