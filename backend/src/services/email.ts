import { Resend } from 'resend'
import { env } from '../config/env.js'
import { centsToDisplayAmount, isZeroDecimalCurrency } from '../utils/currency.js'

const resend = new Resend(env.RESEND_API_KEY)

// ============================================
// EMAIL CONFIGURATION
// ============================================

const MAX_RETRIES = 3
const RETRY_DELAYS_MS = [1000, 3000, 5000] // 1s, 3s, 5s

// Track email send attempts for monitoring
interface EmailResult {
  success: boolean
  messageId?: string
  error?: string
  attempts: number
}

// ============================================
// RETRY WRAPPER
// ============================================

/**
 * Send email with automatic retry on failure
 * Retries up to 3 times with exponential backoff
 */
async function sendWithRetry(
  emailFn: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>
): Promise<EmailResult> {
  let lastError: string | undefined

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const { data, error } = await emailFn()

      if (error) {
        lastError = error.message
        console.error(`[email] Attempt ${attempt + 1} failed:`, error.message)

        // Don't retry on validation errors (bad email address, etc.)
        if (error.message.includes('validation') || error.message.includes('invalid')) {
          return { success: false, error: error.message, attempts: attempt + 1 }
        }

        // Wait before retry
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_DELAYS_MS[attempt])
        }
        continue
      }

      if (data?.id) {
        console.log(`[email] Sent successfully (attempt ${attempt + 1}): ${data.id}`)
        return { success: true, messageId: data.id, attempts: attempt + 1 }
      }

      lastError = 'No response data'
    } catch (err: any) {
      lastError = err.message || 'Unknown error'
      console.error(`[email] Attempt ${attempt + 1} threw:`, lastError)

      // Wait before retry
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAYS_MS[attempt])
      }
    }
  }

  console.error(`[email] All ${MAX_RETRIES} attempts failed:`, lastError)
  return { success: false, error: lastError, attempts: MAX_RETRIES }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================
// HELPERS
// ============================================

function escapeHtml(value: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;',
  }
  return value.replace(/[&<>"']/g, (ch) => map[ch]!)
}

function sanitizeEmailSubject(value: string): string {
  // Prevent header injection and keep subjects readable.
  return value.replace(/[\r\n]+/g, ' ').trim()
}

// Format amount in cents for display in emails (handles zero-decimal currencies)
function formatAmountForEmail(amountCents: number, currency: string): string {
  const displayAmount = centsToDisplayAmount(amountCents, currency)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: isZeroDecimalCurrency(currency) ? 0 : 2,
    maximumFractionDigits: isZeroDecimalCurrency(currency) ? 0 : 2,
  }).format(displayAmount)
}

// ============================================
// TEST / HEALTH CHECK
// ============================================

/**
 * Test email delivery - sends a test email to verify Resend is working
 */
export async function sendTestEmail(to: string): Promise<EmailResult> {
  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: 'NatePay Email Test',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #16a34a;">Email Working!</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 16px;">This is a test email from NatePay to verify email delivery is working correctly.</p>
          <p style="font-size: 14px; color: #888;">Sent at: ${new Date().toISOString()}</p>
        </div>
      `,
    })
  )
}

/**
 * Check if Resend API is configured and reachable
 */
export async function checkEmailHealth(): Promise<{ healthy: boolean; error?: string }> {
  try {
    // Resend doesn't have a direct health endpoint, so we check if the API key works
    // by attempting to list domains (minimal API call)
    const { error } = await resend.domains.list()
    if (error) {
      return { healthy: false, error: error.message }
    }
    return { healthy: true }
  } catch (err: any) {
    return { healthy: false, error: err.message || 'Failed to connect to Resend' }
  }
}

// ============================================
// EMAIL TEMPLATES
// ============================================

export async function sendOtpEmail(to: string, otp: string): Promise<EmailResult> {
  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(`${otp} is your Nate verification code`),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">Your verification code</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 24px;">Enter this code in the app to sign in:</p>
          <div style="background-color: #f5f5f5; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
            <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #1a1a1a;">${escapeHtml(otp)}</span>
          </div>
          <p style="font-size: 14px; color: #888;">This code expires in 15 minutes. If you didn't request this, you can safely ignore it.</p>
        </div>
      `,
    })
  )
}

export async function sendWelcomeEmail(to: string, displayName: string): Promise<EmailResult> {
  const safeName = escapeHtml(displayName)
  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: 'Welcome to Nate!',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">Welcome, ${safeName}!</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 24px;">Your page is live. Share it with your supporters and start receiving subscriptions.</p>
          <a href="${env.APP_URL}/dashboard" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">Go to Dashboard</a>
        </div>
      `,
    })
  )
}

export async function sendNewSubscriberEmail(
  to: string,
  subscriberName: string,
  tierName: string | null,
  amount: number,
  currency: string
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeSubscriberName = escapeHtml(subscriberName)
  const safeTierName = tierName ? escapeHtml(tierName) : null

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(`New subscriber: ${subscriberName}`),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">You have a new subscriber!</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 16px;"><strong>${safeSubscriberName}</strong> just subscribed${safeTierName ? ` to ${safeTierName}` : ''} for <strong>${escapeHtml(formattedAmount)}/month</strong>.</p>
          <a href="${env.APP_URL}/subscribers" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Subscribers</a>
        </div>
      `,
    })
  )
}

export async function sendRequestEmail(
  to: string,
  senderName: string,
  message: string | null,
  requestLink: string
): Promise<EmailResult> {
  const safeSenderName = escapeHtml(senderName)
  const safeMessage = message ? escapeHtml(message) : null
  const safeRequestLink = escapeHtml(requestLink)
  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(`${senderName} sent you a request`),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">${safeSenderName} sent you a request</h1>
          ${safeMessage ? `<p style="font-size: 16px; color: #4a4a4a; margin-bottom: 24px; font-style: italic;">&quot;${safeMessage}&quot;</p>` : ''}
          <a href="${safeRequestLink}" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Request</a>
        </div>
      `,
    })
  )
}

export async function sendUpdateEmail(
  to: string,
  creatorName: string,
  title: string | null,
  body: string
): Promise<EmailResult> {
  const safeCreatorName = escapeHtml(creatorName)
  const safeTitle = title ? escapeHtml(title) : null
  const safeBody = escapeHtml(body)
  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(title || `New update from ${creatorName}`),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <p style="font-size: 14px; color: #888; margin-bottom: 8px;">Update from ${safeCreatorName}</p>
          ${safeTitle ? `<h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">${safeTitle}</h1>` : ''}
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 24px; white-space: pre-wrap;">${safeBody}</p>
        </div>
      `,
    })
  )
}

// Payment reminder - sent 3 days before renewal
export async function sendRenewalReminderEmail(
  to: string,
  creatorName: string,
  amount: number,
  currency: string,
  renewalDate: Date
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeCreatorName = escapeHtml(creatorName)

  const formattedDate = renewalDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(`Subscription renewal reminder - ${creatorName}`),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">Your subscription renews soon</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 16px;">Your subscription to <strong>${safeCreatorName}</strong> will renew on <strong>${escapeHtml(formattedDate)}</strong> for <strong>${escapeHtml(formattedAmount)}</strong>.</p>
          <p style="font-size: 14px; color: #888; margin-bottom: 24px;">No action needed if you'd like to continue your subscription. If you need to update your payment method or cancel, visit your account settings.</p>
          <a href="${env.APP_URL}/settings" style="display: inline-block; background-color: #1a1a1a; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">Manage Subscription</a>
        </div>
      `,
    })
  )
}

// Payment failed - dunning email
export async function sendPaymentFailedEmail(
  to: string,
  creatorName: string,
  amount: number,
  currency: string,
  retryDate: Date | null
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeCreatorName = escapeHtml(creatorName)

  const retryMessage = retryDate
    ? `We'll automatically retry charging your card on ${retryDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`
    : 'Please update your payment method to continue your subscription.'

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(`Action required: Payment failed for ${creatorName} subscription`),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #dc2626;">Payment failed</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 16px;">We couldn't process your ${escapeHtml(formattedAmount)} payment for your subscription to <strong>${safeCreatorName}</strong>.</p>
          <p style="font-size: 14px; color: #888; margin-bottom: 24px;">${escapeHtml(retryMessage)}</p>
          <a href="${env.APP_URL}/settings" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">Update Payment Method</a>
        </div>
      `,
    })
  )
}

// Subscription canceled - supports different cancellation reasons
export async function sendSubscriptionCanceledEmail(
  to: string,
  creatorName: string,
  reason: 'payment_failed' | 'user_canceled' | 'creator_deactivated' | 'other' = 'other'
): Promise<EmailResult> {
  const safeCreatorName = escapeHtml(creatorName)

  // Different messages based on reason
  let reasonMessage: string
  switch (reason) {
    case 'payment_failed':
      reasonMessage = 'has been canceled due to payment issues'
      break
    case 'user_canceled':
      reasonMessage = 'has been canceled as requested'
      break
    case 'creator_deactivated':
      reasonMessage = 'has ended because the creator deactivated their account'
      break
    default:
      reasonMessage = 'has ended'
  }

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(`Subscription to ${creatorName} has ended`),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">Your subscription has ended</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 16px;">Your subscription to <strong>${safeCreatorName}</strong> ${reasonMessage}.</p>
          <p style="font-size: 14px; color: #888; margin-bottom: 24px;">You can resubscribe anytime to continue supporting ${safeCreatorName}.</p>
          <a href="${env.APP_URL}" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">Resubscribe</a>
        </div>
      `,
    })
  )
}

// ============================================
// REQUEST/INVOICE REMINDER EMAILS
// ============================================

// Request not opened reminder (sent to recipient)
export async function sendRequestUnopenedEmail(
  to: string,
  senderName: string,
  requestLink: string,
  isSecondReminder: boolean = false
): Promise<EmailResult> {
  const safeSenderName = escapeHtml(senderName)
  const safeRequestLink = escapeHtml(requestLink)
  const subject = isSecondReminder
    ? `Reminder: ${senderName} is waiting for your response`
    : `${senderName} sent you a request`

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(subject),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">${isSecondReminder ? 'Friendly reminder' : 'You have a request'}</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 24px;"><strong>${safeSenderName}</strong> sent you a request${isSecondReminder ? ' and is waiting for your response' : ''}.</p>
          <a href="${safeRequestLink}" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Request</a>
          <p style="font-size: 14px; color: #888; margin-top: 24px;">This request will expire if not responded to.</p>
        </div>
      `,
    })
  )
}

// Request opened but not paid reminder (sent to recipient)
export async function sendRequestUnpaidEmail(
  to: string,
  senderName: string,
  amount: number,
  currency: string,
  requestLink: string
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeSenderName = escapeHtml(senderName)
  const safeRequestLink = escapeHtml(requestLink)

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(`Complete your payment to ${senderName}`),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">Complete your payment</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 16px;">You viewed a request from <strong>${safeSenderName}</strong> for <strong>${escapeHtml(formattedAmount)}</strong> but haven't completed the payment yet.</p>
          <a href="${safeRequestLink}" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">Complete Payment</a>
        </div>
      `,
    })
  )
}

// Request expiring soon reminder (sent to recipient)
export async function sendRequestExpiringEmail(
  to: string,
  senderName: string,
  requestLink: string
): Promise<EmailResult> {
  const safeSenderName = escapeHtml(senderName)
  const safeRequestLink = escapeHtml(requestLink)

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(`Request from ${senderName} expires soon`),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #dc2626;">Request expiring soon</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 24px;">The request from <strong>${safeSenderName}</strong> will expire in 24 hours. After that, you won't be able to respond.</p>
          <a href="${safeRequestLink}" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">Respond Now</a>
        </div>
      `,
    })
  )
}

// Invoice due soon reminder (sent to recipient)
export async function sendInvoiceDueEmail(
  to: string,
  senderName: string,
  amount: number,
  currency: string,
  dueDate: Date,
  daysUntilDue: number,
  requestLink: string
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeSenderName = escapeHtml(senderName)
  const safeRequestLink = escapeHtml(requestLink)
  const formattedDate = dueDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const urgencyText = daysUntilDue === 1 ? 'tomorrow' : `in ${daysUntilDue} days`

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(`Invoice from ${senderName} due ${urgencyText}`),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">Invoice due ${urgencyText}</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 16px;">Your invoice from <strong>${safeSenderName}</strong> for <strong>${escapeHtml(formattedAmount)}</strong> is due on <strong>${escapeHtml(formattedDate)}</strong>.</p>
          <a href="${safeRequestLink}" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">Pay Now</a>
        </div>
      `,
    })
  )
}

// Invoice overdue reminder (sent to recipient)
export async function sendInvoiceOverdueEmail(
  to: string,
  senderName: string,
  amount: number,
  currency: string,
  dueDate: Date,
  daysOverdue: number,
  requestLink: string
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeSenderName = escapeHtml(senderName)
  const safeRequestLink = escapeHtml(requestLink)
  const formattedDate = dueDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  })

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(`Overdue: Invoice from ${senderName}`),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #dc2626;">Invoice overdue</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 16px;">Your invoice from <strong>${safeSenderName}</strong> for <strong>${escapeHtml(formattedAmount)}</strong> was due on ${escapeHtml(formattedDate)} (${daysOverdue} day${daysOverdue > 1 ? 's' : ''} ago).</p>
          <a href="${safeRequestLink}" style="display: inline-block; background-color: #dc2626; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">Pay Now</a>
        </div>
      `,
    })
  )
}

// ============================================
// PAYOUT NOTIFICATION EMAILS
// ============================================

// Payout completed - money hit their bank (sent to creator)
export async function sendPayoutCompletedEmail(
  to: string,
  displayName: string,
  amount: number,
  currency: string,
  bankLast4: string | null
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeName = escapeHtml(displayName)
  const bankInfo = bankLast4 ? ` ending in ${escapeHtml(bankLast4)}` : ''

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(`${formattedAmount} deposited to your account`),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #16a34a;">Money on the way!</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 16px;">Hey ${safeName}, <strong>${escapeHtml(formattedAmount)}</strong> has been deposited to your bank account${bankInfo}.</p>
          <p style="font-size: 14px; color: #888; margin-bottom: 24px;">Funds typically arrive within 1-2 business days.</p>
          <a href="${env.APP_URL}/dashboard" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Dashboard</a>
        </div>
      `,
    })
  )
}

// Payout failed (sent to creator)
export async function sendPayoutFailedEmail(
  to: string,
  displayName: string,
  amount: number,
  currency: string
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeName = escapeHtml(displayName)

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject('Payout failed - action required'),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #dc2626;">Payout failed</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 16px;">Hey ${safeName}, we couldn't complete your payout of <strong>${escapeHtml(formattedAmount)}</strong>.</p>
          <p style="font-size: 14px; color: #888; margin-bottom: 24px;">Please check that your bank details are correct. We'll retry the transfer automatically.</p>
          <a href="${env.APP_URL}/settings" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">Check Bank Details</a>
        </div>
      `,
    })
  )
}

// ============================================
// PAYROLL NOTIFICATION EMAILS
// ============================================

// New pay statement available (sent to creator)
export async function sendPayrollReadyEmail(
  to: string,
  displayName: string,
  periodStart: Date,
  periodEnd: Date,
  netAmount: number,
  currency: string
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(netAmount, currency)
  const safeName = escapeHtml(displayName)
  const periodLabel = `${periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(`Your pay statement is ready`),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">Pay statement ready</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 16px;">Hey ${safeName}, your pay statement for <strong>${escapeHtml(periodLabel)}</strong> is now available.</p>
          <div style="background-color: #f5f5f5; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
            <p style="font-size: 14px; color: #888; margin: 0 0 8px 0;">Net earnings</p>
            <p style="font-size: 28px; font-weight: 700; color: #1a1a1a; margin: 0;">${escapeHtml(formattedAmount)}</p>
          </div>
          <a href="${env.APP_URL}/payroll" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Statement</a>
          <p style="font-size: 14px; color: #888; margin-top: 24px;">Use this statement for income verification, taxes, or your records.</p>
        </div>
      `,
    })
  )
}

// ============================================
// ONBOARDING/SETUP REMINDER EMAILS
// ============================================

// Incomplete onboarding reminder (sent to creator)
export async function sendOnboardingIncompleteEmail(
  to: string,
  isSecondReminder: boolean = false
): Promise<EmailResult> {
  const subject = isSecondReminder
    ? "Don't forget to finish setting up your page"
    : 'Finish setting up your Nate page'

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(subject),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">${isSecondReminder ? 'Your page is waiting' : 'Almost there!'}</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 24px;">You started setting up your Nate page but didn't finish. Complete your profile to start receiving payments.</p>
          <a href="${env.APP_URL}/onboarding" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">Continue Setup</a>
        </div>
      `,
    })
  )
}

// Bank setup incomplete - blocking payouts (sent to creator)
export async function sendBankSetupIncompleteEmail(
  to: string,
  displayName: string,
  pendingAmount: number,
  currency: string
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(pendingAmount, currency)
  const safeName = escapeHtml(displayName)

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject('Add bank details to receive your earnings'),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #dc2626;">Your earnings are waiting</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 16px;">Hey ${safeName}, you have <strong>${escapeHtml(formattedAmount)}</strong> ready to be paid out, but we need your bank details first.</p>
          <a href="${env.APP_URL}/settings" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">Add Bank Details</a>
        </div>
      `,
    })
  )
}

// No subscribers after 7 days (sent to creator)
export async function sendNoSubscribersEmail(
  to: string,
  displayName: string,
  shareUrl: string
): Promise<EmailResult> {
  const safeName = escapeHtml(displayName)
  const safeShareUrl = escapeHtml(shareUrl)

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject('Tips to get your first subscriber'),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">Ready to share your page?</h1>
          <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 16px;">Hey ${safeName}, your page is set up and ready to go! Here are some tips to get your first subscriber:</p>
          <ul style="font-size: 16px; color: #4a4a4a; margin-bottom: 24px; padding-left: 20px;">
            <li style="margin-bottom: 8px;">Share your link on social media</li>
            <li style="margin-bottom: 8px;">Send it directly to clients or supporters</li>
            <li style="margin-bottom: 8px;">Add it to your email signature</li>
          </ul>
          <div style="background-color: #f5f5f5; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
            <p style="font-size: 14px; color: #888; margin: 0 0 8px 0;">Your page link:</p>
            <a href="${safeShareUrl}" style="font-size: 16px; color: #FF941A; word-break: break-all;">${safeShareUrl}</a>
          </div>
          <a href="${env.APP_URL}/dashboard" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">Go to Dashboard</a>
        </div>
      `,
    })
  )
}
