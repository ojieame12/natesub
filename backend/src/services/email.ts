// Email Service - All email sending functions
//
// Template infrastructure extracted to emailTemplates.ts for reusability
// This file contains the send* functions that compose and send emails

import { Resend, type CreateEmailOptions } from 'resend'
import { env } from '../config/env.js'
import { logEmailSent, logEmailFailed } from './systemLog.js'
import { emailQueue } from '../lib/queue.js'
import {
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  BRAND_NAME,
  BRAND_COLOR,
  withDefaultEmailAttachments,
  escapeHtml,
  sanitizeEmailSubject,
  formatAmountForEmail,
  sleep,
  baseTemplate,
  amountCard,
  alertBox,
} from './emailTemplates.js'

const resend = new Resend(env.RESEND_API_KEY)

// Rename original function to internal
export function _sendEmail(options: CreateEmailOptions): Promise<EmailResult> {
  return sendWithRetry(() => resend.emails.send(withDefaultEmailAttachments(options)))
}

// New public function adds to queue
async function sendEmail(options: CreateEmailOptions): Promise<EmailResult> {
  // In production with Redis, enqueue for async processing (higher throughput + better retries).
  // In tests, skip sending entirely. In local envs without Redis, send directly to avoid silently dropping emails.
  const shouldQueue = env.NODE_ENV !== 'test' && Boolean(env.REDIS_URL)

  if (!shouldQueue) {
    if (env.NODE_ENV === 'test') {
      return { success: true, attempts: 0, messageId: 'skipped_test' }
    }

    return _sendEmail(options)
  }

  try {
    // Add job to BullMQ
    // We only pass necessary data. Attachments are large/binary, so we handle them in the worker (loadInlineEmailLogoAttachment).
    // The worker will call _sendEmail which adds attachments.
    await emailQueue.add('send-email', {
      to: Array.isArray(options.to) ? options.to[0] : options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      from: options.from,
    })

    return { success: true, attempts: 0, messageId: 'queued' }
  } catch (err: any) {
    console.error('[email] Failed to queue email:', err)
    // Fallback: try sending directly if queue fails
    console.warn('[email] Falling back to direct send')
    return _sendEmail(options)
  }
}

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
        // Note: Actual logging happens in individual send functions with more context
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

// ============================================
// TEST / HEALTH CHECK
// ============================================

/**
 * Test email delivery - sends a test email to verify Resend is working
 */
export async function sendTestEmail(to: string): Promise<EmailResult> {
  return _sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: `${BRAND_NAME} Email Test`,
    html: baseTemplate({
      preheader: 'This is a test email to verify delivery is working.',
      headline: 'Email Working!',
      body: `
        <p style="margin: 0 0 16px 0;">This is a test email from ${BRAND_NAME} to verify email delivery is working correctly.</p>
        <p style="margin: 0; font-size: 14px; color: #888888;">Sent at: ${new Date().toISOString()}</p>
      `,
      ctaText: 'Go to Dashboard',
      ctaUrl: `${env.APP_URL}/dashboard`,
      ctaColor: '#16a34a',
    }),
  })
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
// AUTHENTICATION EMAILS
// ============================================

export async function sendOtpEmail(to: string, otp: string): Promise<EmailResult> {
  if (env.NODE_ENV === 'test') {
    return { success: true, attempts: 0, messageId: 'skipped_test' }
  }

  console.log(`[email] Sending OTP to ${to.substring(0, 3)}***@***`)

  // Auth OTPs are time-sensitive and should not depend on background workers.
  const result = await _sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(`${otp} is your ${BRAND_NAME} verification code`),
    html: baseTemplate({
      preheader: `Your verification code is ${otp}. It expires in ${env.MAGIC_LINK_EXPIRES_MINUTES} minutes.`,
      headline: 'Your verification code',
      body: `
        <p style="margin: 0 0 20px 0;">Enter this code in the app to sign in:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 20px 0;">
          <tr>
            <td style="background-color: #f5f5f5; border-radius: 12px; padding: 24px; text-align: center;">
              <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #1a1a1a; font-family: 'SF Mono', Monaco, 'Courier New', monospace;">
                ${escapeHtml(otp)}
              </span>
            </td>
          </tr>
        </table>
        <p style="margin: 0; font-size: 14px; color: #888888;">This code expires in ${env.MAGIC_LINK_EXPIRES_MINUTES} minutes. If you didn't request this, you can safely ignore it.</p>
      `,
    }),
  })

  console.log(`[email] OTP send result: success=${result.success}, messageId=${result.messageId || 'none'}, attempts=${result.attempts}`)

  if (!result.success) {
    console.error('[email] Failed to send OTP email:', { to, error: result.error })
    throw new Error('Failed to send verification code. Please try again.')
  }

  return result
}

// ============================================
// ONBOARDING EMAILS
// ============================================

export async function sendWelcomeEmail(to: string, displayName: string): Promise<EmailResult> {
  const safeName = escapeHtml(displayName)
  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: `Welcome to ${BRAND_NAME}!`,
    html: baseTemplate({
      preheader: `Welcome ${displayName}! Your page is live and ready to receive payments.`,
      headline: `Welcome, ${safeName}!`,
      body: `
          <p style="margin: 0 0 16px 0;">Your page is live. Share it with your clients and start receiving payments.</p>
          <p style="margin: 0; font-size: 14px; color: #888888;">Need help getting started? Check out our quick start guide.</p>
        `,
      ctaText: 'Go to Dashboard',
      ctaUrl: `${env.APP_URL}/dashboard`,
    }),
  })
}

export async function sendOnboardingIncompleteEmail(
  to: string,
  isSecondReminder: boolean = false
): Promise<EmailResult> {
  const subject = isSecondReminder
    ? "Don't forget to finish setting up your page"
    : `Finish setting up your ${BRAND_NAME} page`

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(subject),
    html: baseTemplate({
      preheader: 'Complete your profile to start receiving payments.',
      headline: isSecondReminder ? 'Your page is waiting' : 'Almost there!',
      body: `
          <p style="margin: 0 0 16px 0;">You started setting up your ${BRAND_NAME} page but didn't finish. Complete your profile to start receiving payments.</p>
          <p style="margin: 0; font-size: 14px; color: #888888;">It only takes a few minutes to complete.</p>
        `,
      ctaText: 'Continue Setup',
      ctaUrl: `${env.APP_URL}/onboarding`,
    }),
  })
}

export async function sendNoSubscribersEmail(
  to: string,
  displayName: string,
  shareUrl: string
): Promise<EmailResult> {
  const safeName = escapeHtml(displayName)
  const safeShareUrl = escapeHtml(shareUrl)

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject('Tips to get your first client'),
    html: baseTemplate({
      preheader: 'Your page is ready! Here are tips to get your first payment.',
      headline: 'Ready to share your page?',
      body: `
          <p style="margin: 0 0 16px 0;">Hey ${safeName}, your page is set up and ready to go! Here are some tips to get your first client:</p>
          <ul style="margin: 0 0 20px 0; padding-left: 20px; color: #4a4a4a;">
            <li style="margin-bottom: 8px;">Share your link on social media</li>
            <li style="margin-bottom: 8px;">Send it directly to clients</li>
            <li style="margin-bottom: 8px;">Add it to your email signature</li>
          </ul>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 20px 0;">
            <tr>
              <td style="background-color: #f5f5f5; border-radius: 8px; padding: 16px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; color: #888888;">Your page link:</p>
                <a href="${safeShareUrl}" style="font-size: 16px; color: ${BRAND_COLOR}; word-break: break-all; text-decoration: none;">${safeShareUrl}</a>
              </td>
            </tr>
          </table>
        `,
      ctaText: 'Go to Dashboard',
      ctaUrl: `${env.APP_URL}/dashboard`,
    }),
  })
}

// ============================================
// SUBSCRIBER/PAYMENT EMAILS
// ============================================

export async function sendNewSubscriberEmail(
  to: string,
  subscriberName: string,
  tierName: string | null,
  amount: number,
  currency: string,
  userId?: string
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeSubscriberName = escapeHtml(subscriberName)
  const safeTierName = tierName ? escapeHtml(tierName) : null

  const tierText = safeTierName ? ` to ${safeTierName}` : ''
  const subject = sanitizeEmailSubject(`New subscriber: ${subscriberName}`)

  const result = await sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject,
    html: baseTemplate({
      preheader: `${subscriberName} just subscribed for ${formattedAmount}/month.`,
      headline: 'You have a new subscriber!',
      body: `
          <p style="margin: 0 0 16px 0;">
            <strong>${safeSubscriberName}</strong> just subscribed${tierText} for <strong>${escapeHtml(formattedAmount)}/month</strong>.
          </p>
        `,
      ctaText: 'View Subscribers',
      ctaUrl: `${env.APP_URL}/subscribers`,
      ctaColor: '#16a34a',
    }),
  })

  // Log the email
  if (result.success) {
    logEmailSent({ to, subject, template: 'new_subscriber', messageId: result.messageId, userId })
  } else {
    logEmailFailed({ to, subject, template: 'new_subscriber', error: result.error || 'Unknown', userId })
  }

  return result
}

/**
 * Send subscription confirmation to the subscriber (person who paid)
 * Includes link to manage their subscription
 */
export async function sendSubscriptionConfirmationEmail(
  to: string,
  subscriberName: string,
  providerName: string,
  providerUsername: string,
  tierName: string | null,
  amount: number,
  currency: string
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeSubscriberName = escapeHtml(subscriberName.split(' ')[0] || 'there') // First name only
  const safeProviderName = escapeHtml(providerName)
  const safeTierName = tierName ? escapeHtml(tierName) : null
  const tierText = safeTierName ? ` (${safeTierName})` : ''

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(`You're subscribed to ${providerName}`),
    html: baseTemplate({
      preheader: `Thanks for subscribing! You'll be charged ${formattedAmount}/month.`,
      headline: `You're subscribed!`,
      body: `
          <p style="margin: 0 0 16px 0;">
            Hey ${safeSubscriberName}, thanks for subscribing to <strong>${safeProviderName}</strong>${tierText}.
          </p>

          ${amountCard('Monthly subscription', formattedAmount, '#16a34a')}

          <p style="margin: 0 0 8px 0; font-size: 14px; color: #4a4a4a;">
            <strong>What's next:</strong>
          </p>
          <ul style="margin: 0 0 20px 0; padding-left: 20px; color: #4a4a4a; font-size: 14px;">
            <li style="margin-bottom: 6px;">You'll be charged ${escapeHtml(formattedAmount)} each month</li>
            <li style="margin-bottom: 6px;">Cancel anytime - no questions asked</li>
            <li style="margin-bottom: 6px;">Manage your subscription from the link below</li>
          </ul>

          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 20px 0; border: 1px solid #e5e5e5; border-radius: 8px;">
            <tr>
              <td style="padding: 16px; background-color: #fafafa;">
                <p style="margin: 0 0 8px 0; font-size: 13px; color: #666666;">Need to update payment method or cancel?</p>
                <a href="${env.APP_URL}/my-subscriptions" style="color: ${BRAND_COLOR}; text-decoration: none; font-weight: 500;">
                  Manage your subscriptions →
                </a>
              </td>
            </tr>
          </table>
        `,
      ctaText: `View ${safeProviderName}'s Page`,
      ctaUrl: `${env.APP_URL}/${escapeHtml(providerUsername)}`,
      ctaColor: '#16a34a',
      footerText: 'You can cancel your subscription anytime from your account settings.',
    }),
  })
}

export async function sendRenewalReminderEmail(
  to: string,
  providerName: string,
  amount: number,
  currency: string,
  renewalDate: Date,
  cancelUrl?: string // Direct cancel link for 1-click cancellation
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeProviderName = escapeHtml(providerName)
  const formattedDate = renewalDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  // Visa-compliant: clearly show amount, date, and easy cancel option
  const cancelSection = cancelUrl
    ? `
          <p style="margin: 16px 0 0 0; font-size: 14px;">
            <a href="${escapeHtml(cancelUrl)}" style="color: #888888; text-decoration: underline;">Cancel subscription</a>
          </p>
        `
    : `
          <p style="margin: 16px 0 0 0; font-size: 14px; color: #888888;">
            To cancel, visit <a href="${env.APP_URL}/my-subscriptions" style="color: #888888; text-decoration: underline;">your subscriptions</a>.
          </p>
        `

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(`Upcoming charge: ${formattedAmount} on ${formattedDate}`),
    html: baseTemplate({
      preheader: `Your subscription to ${providerName} renews on ${formattedDate} for ${formattedAmount}.`,
      headline: 'Upcoming subscription renewal',
      body: `
          <p style="margin: 0 0 16px 0;">
            Your subscription to <strong>${safeProviderName}</strong> will automatically renew on <strong>${escapeHtml(formattedDate)}</strong>.
          </p>
          <p style="margin: 0 0 16px 0; font-size: 18px; font-weight: bold;">
            Amount: ${escapeHtml(formattedAmount)}
          </p>
          <p style="margin: 0; font-size: 14px; color: #888888;">
            No action needed if you'd like to continue. Your payment method will be charged automatically.
          </p>
          ${cancelSection}
        `,
      ctaText: 'Manage Subscription',
      ctaUrl: `${env.APP_URL}/my-subscriptions`,
      ctaColor: '#1a1a1a',
    }),
  })
}

export async function sendPaymentFailedEmail(
  to: string,
  providerName: string,
  amount: number,
  currency: string,
  retryDate: Date | null
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeProviderName = escapeHtml(providerName)

  const retryMessage = retryDate
    ? `We'll automatically retry on ${retryDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`
    : 'Please update your payment method to continue your subscription.'

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(`Action required: Payment failed for ${providerName}`),
    html: baseTemplate({
      preheader: `We couldn't process your ${formattedAmount} payment. Please update your payment method.`,
      headline: 'Payment failed',
      body: `
          <p style="margin: 0 0 16px 0;">
            We couldn't process your <strong>${escapeHtml(formattedAmount)}</strong> payment for your subscription to <strong>${safeProviderName}</strong>.
          </p>
          <p style="margin: 0; font-size: 14px; color: #888888;">${escapeHtml(retryMessage)}</p>
        `,
      ctaText: 'Update Payment Method',
      ctaUrl: `${env.APP_URL}/my-subscriptions`,
      ctaColor: '#dc2626',
    }),
  })
}

export async function sendSubscriptionCanceledEmail(
  to: string,
  providerName: string,
  reason: 'payment_failed' | 'user_canceled' | 'provider_deactivated' | 'other' = 'other'
): Promise<EmailResult> {
  const safeProviderName = escapeHtml(providerName)

  let reasonMessage: string
  switch (reason) {
    case 'payment_failed':
      reasonMessage = 'has been canceled due to payment issues'
      break
    case 'user_canceled':
      reasonMessage = 'has been canceled as requested'
      break
    case 'provider_deactivated':
      reasonMessage = 'has ended because the service provider deactivated their account'
      break
    default:
      reasonMessage = 'has ended'
  }

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(`Subscription to ${providerName} has ended`),
    html: baseTemplate({
      preheader: `Your subscription to ${providerName} ${reasonMessage}.`,
      headline: 'Your subscription has ended',
      body: `
          <p style="margin: 0 0 16px 0;">
            Your subscription to <strong>${safeProviderName}</strong> ${reasonMessage}.
          </p>
          <p style="margin: 0; font-size: 14px; color: #888888;">
            You can resubscribe anytime if you'd like to continue.
          </p>
        `,
      ctaText: 'Resubscribe',
      ctaUrl: env.APP_URL,
    }),
  })
}

/**
 * Send cancellation confirmation to subscriber
 * Visa-compliant confirmation that subscription will end at period end
 */
export async function sendCancellationConfirmationEmail(
  to: string,
  subscriberName: string,
  providerName: string,
  accessUntil: Date,
  resubscribeUrl: string
): Promise<EmailResult> {
  const safeSubscriberName = escapeHtml(subscriberName.split(' ')[0] || 'there')
  const safeProviderName = escapeHtml(providerName)
  const formattedDate = accessUntil.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(`Subscription canceled: ${providerName}`),
    html: baseTemplate({
      preheader: `Your subscription to ${providerName} has been canceled. Access until ${formattedDate}.`,
      headline: 'Subscription Canceled',
      body: `
          <p style="margin: 0 0 16px 0;">
            Hey ${safeSubscriberName}, your subscription to <strong>${safeProviderName}</strong> has been canceled as requested.
          </p>

          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 20px 0;">
            <tr>
              <td style="background-color: #FEF3C7; border-radius: 12px; padding: 20px; text-align: center; border-left: 4px solid #F59E0B;">
                <p style="margin: 0 0 8px 0; font-size: 14px; color: #92400E;">You'll have access until:</p>
                <p style="margin: 0; font-size: 24px; font-weight: 700; color: #78350F;">${escapeHtml(formattedDate)}</p>
              </td>
            </tr>
          </table>

          <p style="margin: 0 0 16px 0; font-size: 14px; color: #4a4a4a;">
            <strong>What happens next:</strong>
          </p>
          <ul style="margin: 0 0 20px 0; padding-left: 20px; color: #4a4a4a; font-size: 14px;">
            <li style="margin-bottom: 6px;">You won't be charged again</li>
            <li style="margin-bottom: 6px;">Access continues until ${escapeHtml(formattedDate)}</li>
            <li style="margin-bottom: 6px;">You can resubscribe anytime</li>
          </ul>

          <p style="margin: 0; font-size: 14px; color: #888888;">
            Changed your mind? Click below to resubscribe.
          </p>
        `,
      ctaText: 'Resubscribe',
      ctaUrl: resubscribeUrl,
      footerText: 'Thank you for your support.',
    }),
  })
}

// ============================================
// REQUEST EMAILS
// ============================================

export async function sendRequestEmail(
  to: string,
  senderName: string,
  message: string | null,
  requestLink: string
): Promise<EmailResult> {
  const safeSenderName = escapeHtml(senderName)
  const safeMessage = message ? escapeHtml(message) : null

  const messageHtml = safeMessage
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 16px 0;">
        <tr>
          <td style="background-color: #f8f8f8; border-radius: 8px; padding: 16px; border-left: 4px solid ${BRAND_COLOR};">
            <p style="margin: 0; font-style: italic; color: #4a4a4a;">"${safeMessage}"</p>
          </td>
        </tr>
      </table>`
    : ''

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(`${senderName} sent you a request`),
    html: baseTemplate({
      preheader: `${senderName} sent you a payment request.`,
      headline: `${safeSenderName} sent you a request`,
      body: `
          ${messageHtml}
          <p style="margin: 0; font-size: 14px; color: #888888;">Click below to view the details and respond.</p>
        `,
      ctaText: 'View Request',
      ctaUrl: requestLink,
    }),
  })
}

export async function sendRequestUnopenedEmail(
  to: string,
  senderName: string,
  requestLink: string,
  isSecondReminder: boolean = false
): Promise<EmailResult> {
  const safeSenderName = escapeHtml(senderName)
  const subject = isSecondReminder
    ? `Reminder: ${senderName} is waiting for your response`
    : `${senderName} sent you a request`

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(subject),
    html: baseTemplate({
      preheader: `${senderName} sent you a request${isSecondReminder ? ' and is waiting for your response' : ''}.`,
      headline: isSecondReminder ? 'Friendly reminder' : 'You have a request',
      body: `
          <p style="margin: 0 0 16px 0;">
            <strong>${safeSenderName}</strong> sent you a request${isSecondReminder ? ' and is waiting for your response' : ''}.
          </p>
          <p style="margin: 0; font-size: 14px; color: #888888;">This request will expire if not responded to.</p>
        `,
      ctaText: 'View Request',
      ctaUrl: requestLink,
    }),
  })
}

export async function sendRequestUnpaidEmail(
  to: string,
  senderName: string,
  amount: number,
  currency: string,
  requestLink: string
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeSenderName = escapeHtml(senderName)

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(`Complete your payment to ${senderName}`),
    html: baseTemplate({
      preheader: `You viewed a request for ${formattedAmount} but haven't completed payment.`,
      headline: 'Complete your payment',
      body: `
          <p style="margin: 0 0 16px 0;">
            You viewed a request from <strong>${safeSenderName}</strong> for <strong>${escapeHtml(formattedAmount)}</strong> but haven't completed the payment yet.
          </p>
        `,
      ctaText: 'Complete Payment',
      ctaUrl: requestLink,
    }),
  })
}

export async function sendRequestExpiringEmail(
  to: string,
  senderName: string,
  requestLink: string
): Promise<EmailResult> {
  const safeSenderName = escapeHtml(senderName)

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(`Request from ${senderName} expires soon`),
    html: baseTemplate({
      preheader: `The request from ${senderName} will expire in 24 hours.`,
      headline: 'Request expiring soon',
      body: `
          <p style="margin: 0 0 16px 0;">
            The request from <strong>${safeSenderName}</strong> will expire in <strong>24 hours</strong>. After that, you won't be able to respond.
          </p>
        `,
      ctaText: 'Respond Now',
      ctaUrl: requestLink,
      ctaColor: '#dc2626',
    }),
  })
}

// ============================================
// INVOICE EMAILS
// ============================================

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
  const formattedDate = dueDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const urgencyText = daysUntilDue === 1 ? 'tomorrow' : `in ${daysUntilDue} days`

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(`Invoice from ${senderName} due ${urgencyText}`),
    html: baseTemplate({
      preheader: `Your invoice for ${formattedAmount} is due ${urgencyText}.`,
      headline: `Invoice due ${urgencyText}`,
      body: `
          <p style="margin: 0 0 16px 0;">
            Your invoice from <strong>${safeSenderName}</strong> for <strong>${escapeHtml(formattedAmount)}</strong> is due on <strong>${escapeHtml(formattedDate)}</strong>.
          </p>
        `,
      ctaText: 'Pay Now',
      ctaUrl: requestLink,
    }),
  })
}

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
  const formattedDate = dueDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  })

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(`Overdue: Invoice from ${senderName}`),
    html: baseTemplate({
      preheader: `Your invoice for ${formattedAmount} is ${daysOverdue} days overdue.`,
      headline: 'Invoice overdue',
      body: `
          <p style="margin: 0 0 16px 0;">
            Your invoice from <strong>${safeSenderName}</strong> for <strong>${escapeHtml(formattedAmount)}</strong> was due on ${escapeHtml(formattedDate)} <strong>(${daysOverdue} day${daysOverdue > 1 ? 's' : ''} ago)</strong>.
          </p>
        `,
      ctaText: 'Pay Now',
      ctaUrl: requestLink,
      ctaColor: '#dc2626',
    }),
  })
}

// ============================================
// UPDATE EMAILS
// ============================================

export async function sendUpdateEmail(
  to: string,
  senderName: string,
  title: string | null,
  body: string,
  options?: {
    photoUrl?: string | null
    creatorUsername?: string
    deliveryId?: string  // For tracking pixel
    userId?: string      // For logging
  }
): Promise<EmailResult> {
  const safeSenderName = escapeHtml(senderName)
  const safeTitle = title ? escapeHtml(title) : null
  const safeBody = escapeHtml(body)

  const headlineText = safeTitle || `New update from ${safeSenderName}`
  const subject = sanitizeEmailSubject(title || `New update from ${senderName}`)

  // Build photo HTML if provided
  const photoHtml = options?.photoUrl ? `
    <div style="margin: 16px 0;">
      <img src="${escapeHtml(options.photoUrl)}" alt="Update image" style="max-width: 100%; height: auto; border-radius: 8px;" />
    </div>
  ` : ''

  // Build view online link if username provided
  const viewOnlineHtml = options?.creatorUsername ? `
    <p style="margin: 16px 0 0 0;">
      <a href="${env.APP_URL}/${escapeHtml(options.creatorUsername)}" style="color: ${BRAND_COLOR}; text-decoration: none;">View ${safeSenderName}'s page →</a>
    </p>
  ` : ''

  // Build tracking pixel HTML if deliveryId provided
  const trackingPixelHtml = options?.deliveryId ? `
    <img src="${env.API_URL || env.APP_URL}/updates/track/${options.deliveryId}" alt="" width="1" height="1" style="display:block;width:1px;height:1px;border:0;" />
  ` : ''

  const result = await sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject,
    html: baseTemplate({
      preheader: body.substring(0, 100) + (body.length > 100 ? '...' : ''),
      headline: headlineText,
      body: `
          <p style="margin: 0 0 8px 0; font-size: 14px; color: #888888;">From ${safeSenderName}</p>
          ${photoHtml}
          <p style="margin: 0; white-space: pre-wrap; line-height: 1.6;">${safeBody}</p>
          ${viewOnlineHtml}
          ${trackingPixelHtml}
        `,
      showUnsubscribe: true,  // Updates are marketing emails - must have unsubscribe
    }),
  })

  // Log the email
  if (result.success) {
    logEmailSent({ to, subject, template: 'update', messageId: result.messageId, userId: options?.userId })
  } else {
    logEmailFailed({ to, subject, template: 'update', error: result.error || 'Unknown', userId: options?.userId })
  }

  return result
}

// ============================================
// PAYOUT EMAILS
// ============================================

export async function sendPayoutCompletedEmail(
  to: string,
  displayName: string,
  amount: number,
  currency: string,
  bankLast4: string | null
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeName = escapeHtml(displayName)
  const bankInfo = bankLast4 ? ` ending in ****${escapeHtml(bankLast4)}` : ''

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(`${formattedAmount} deposited to your account`),
    html: baseTemplate({
      preheader: `${formattedAmount} has been deposited to your bank account.`,
      headline: 'Money on the way!',
      body: `
          <p style="margin: 0 0 16px 0;">
            Hey ${safeName}, <strong>${escapeHtml(formattedAmount)}</strong> has been deposited to your bank account${bankInfo}.
          </p>
          ${amountCard('Amount deposited', formattedAmount, '#16a34a')}
          <p style="margin: 0; font-size: 14px; color: #888888;">Funds typically arrive within 1-2 business days.</p>
        `,
      ctaText: 'View Dashboard',
      ctaUrl: `${env.APP_URL}/dashboard`,
      ctaColor: '#16a34a',
    }),
  })
}

export async function sendPayoutFailedEmail(
  to: string,
  displayName: string,
  amount: number,
  currency: string
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeName = escapeHtml(displayName)

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject('Payout failed - action required'),
    html: baseTemplate({
      preheader: `We couldn't complete your payout of ${formattedAmount}.`,
      headline: 'Payout failed',
      body: `
          <p style="margin: 0 0 16px 0;">
            Hey ${safeName}, we couldn't complete your payout of <strong>${escapeHtml(formattedAmount)}</strong>.
          </p>
          <p style="margin: 0; font-size: 14px; color: #888888;">
            Please check that your bank details are correct. We'll retry the transfer automatically.
          </p>
        `,
      ctaText: 'Check Bank Details',
      ctaUrl: `${env.APP_URL}/settings`,
      ctaColor: '#dc2626',
    }),
  })
}

export async function sendBankSetupIncompleteEmail(
  to: string,
  displayName: string,
  pendingAmount: number,
  currency: string
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(pendingAmount, currency)
  const safeName = escapeHtml(displayName)

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject('Add bank details to receive your earnings'),
    html: baseTemplate({
      preheader: `You have ${formattedAmount} ready to be paid out.`,
      headline: 'Your earnings are waiting',
      body: `
          <p style="margin: 0 0 16px 0;">
            Hey ${safeName}, you have <strong>${escapeHtml(formattedAmount)}</strong> ready to be paid out, but we need your bank details first.
          </p>
          ${amountCard('Pending payout', formattedAmount, BRAND_COLOR)}
        `,
      ctaText: 'Add Bank Details',
      ctaUrl: `${env.APP_URL}/settings`,
      ctaColor: '#dc2626',
    }),
  })
}

// ============================================
// PAYROLL EMAILS
// ============================================

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

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject('Your pay statement is ready'),
    html: baseTemplate({
      preheader: `Your pay statement for ${periodLabel} is ready. Net earnings: ${formattedAmount}`,
      headline: 'Pay statement ready',
      body: `
          <p style="margin: 0 0 16px 0;">
            Hey ${safeName}, your pay statement for <strong>${escapeHtml(periodLabel)}</strong> is now available.
          </p>
          ${amountCard('Net earnings', formattedAmount, '#16a34a')}
          <p style="margin: 0; font-size: 14px; color: #888888;">Use this statement for income verification, taxes, or your records.</p>
        `,
      ctaText: 'View Statement',
      ctaUrl: `${env.APP_URL}/payroll`,
    }),
  })
}

// ============================================
// PLATFORM BILLING EMAILS
// ============================================

/**
 * Send notification when platform subscription payment fails and debit is created
 * The service provider continues operating, but debit will be recovered from next client payment
 */
export async function sendPlatformDebitNotification(
  to: string,
  displayName: string,
  debitAmount: number,
  totalDebit: number
): Promise<EmailResult> {
  const safeName = escapeHtml(displayName)
  const formattedDebit = formatAmountForEmail(debitAmount, 'USD')
  const formattedTotal = formatAmountForEmail(totalDebit, 'USD')

  // Check if close to cap (within $10)
  const closeToCapWarning = totalDebit >= 2000 // $20 or more
    ? alertBox('⚠️ Your balance is approaching the $30 limit. After that, new payments will be paused until cleared.', 'warning')
    : ''

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject('Payment issue with your Nate plan'),
    html: baseTemplate({
      preheader: `Your $5 plan payment didn't go through. We'll recover it from your next client payment.`,
      headline: 'Plan payment issue',
      body: `
          <p style="margin: 0 0 16px 0;">
            Hey ${safeName}, we couldn't process your Nate plan payment of <strong>${formattedDebit}</strong>.
          </p>

          ${amountCard('Outstanding balance', formattedTotal, '#F59E0B')}

          ${alertBox('✓ <strong>Good news:</strong> You can still accept payments from your clients. This balance will be automatically recovered from your next client payment.', 'info')}

          <p style="margin: 0 0 16px 0;">
            If you'd like to clear this balance now and avoid recovery from your earnings, you can update your payment method below.
          </p>

          ${closeToCapWarning}
        `,
      ctaText: 'Update Payment Method',
      ctaUrl: `${env.APP_URL}/settings/billing`,
    }),
  })
}

/**
 * Send notification when platform debit is successfully recovered from a client payment
 */
export async function sendPlatformDebitRecoveredNotification(
  to: string,
  displayName: string,
  recoveredAmount: number,
  remainingDebit: number
): Promise<EmailResult> {
  const safeName = escapeHtml(displayName)
  const formattedRecovered = formatAmountForEmail(recoveredAmount, 'USD')
  const formattedRemaining = formatAmountForEmail(remainingDebit, 'USD')

  const bodyContent = remainingDebit > 0
    ? `
      <p style="margin: 0 0 16px 0;">
        Hey ${safeName}, we've recovered <strong>${formattedRecovered}</strong> of your outstanding platform balance from a recent client payment.
      </p>

      ${amountCard('Remaining balance', formattedRemaining, '#F59E0B')}

      <p style="margin: 0; font-size: 14px; color: #666666;">
        The remaining balance will be automatically recovered from your next client payment. To avoid this, update your payment method to clear the balance directly.
      </p>
    `
    : `
      <p style="margin: 0 0 16px 0;">
        Hey ${safeName}, we've recovered <strong>${formattedRecovered}</strong> from a recent client payment.
      </p>

      ${amountCard('Balance', '$0.00', '#10B981')}

      ${alertBox('✓ Your platform balance is now cleared. You\'re all caught up!', 'success')}

      <p style="margin: 0; font-size: 14px; color: #666666;">
        To prevent future balance issues, consider updating your payment method if the previous one expired or had insufficient funds.
      </p>
    `

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(remainingDebit > 0 ? 'Platform balance partially recovered' : 'Platform balance cleared ✓'),
    html: baseTemplate({
      preheader: remainingDebit > 0
        ? `We recovered ${formattedRecovered} from your last payment. ${formattedRemaining} remaining.`
        : `Your platform balance is now $0. All caught up!`,
      headline: remainingDebit > 0 ? 'Balance partially recovered' : 'Balance cleared',
      body: bodyContent,
      ctaText: remainingDebit > 0 ? 'Update Payment Method' : 'View Billing',
      ctaUrl: `${env.APP_URL}/settings/billing`,
      ctaColor: remainingDebit > 0 ? undefined : '#10B981',
    }),
  })
}

/**
 * Send notification when Stripe Connect verification is complete and payments are active
 */
export async function sendPaymentSetupCompleteEmail(
  to: string,
  displayName: string,
  shareUrl: string
): Promise<EmailResult> {
  const safeName = escapeHtml(displayName)
  const safeShareUrl = escapeHtml(shareUrl)

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject('Your payment account is now active!'),
    html: baseTemplate({
      preheader: `Great news! Your account is verified and you can now accept payments.`,
      headline: `You're ready to get paid, ${safeName}!`,
      body: `
          <p style="margin: 0 0 16px 0;">
            Your payment account has been verified and is now <strong style="color: #16a34a;">active</strong>. You can start accepting payments from clients immediately.
          </p>

          ${alertBox('✓ Identity verified', 'success')}

          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 20px 0;">
            <tr>
              <td style="background-color: #f5f5f5; border-radius: 8px; padding: 16px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; color: #888888;">Your page link:</p>
                <a href="${safeShareUrl}" style="font-size: 16px; color: ${BRAND_COLOR}; word-break: break-all; text-decoration: none;">${safeShareUrl}</a>
              </td>
            </tr>
          </table>

          <p style="margin: 0; font-size: 14px; color: #666666;">
            Share this link with your clients to start receiving payments. Funds are deposited to your bank account automatically.
          </p>
        `,
      ctaText: 'Go to Dashboard',
      ctaUrl: `${env.APP_URL}/dashboard`,
      ctaColor: '#16a34a',
    }),
  })
}

/**
 * Send notification when platform debit reaches the cap ($30) and payments are blocked
 */
export async function sendPlatformDebitCapReachedNotification(
  to: string,
  displayName: string,
  totalDebit: number
): Promise<EmailResult> {
  const safeName = escapeHtml(displayName)
  const formattedTotal = formatAmountForEmail(totalDebit, 'USD')

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject('Action required: Payment acceptance paused'),
    html: baseTemplate({
      preheader: `Your platform balance has reached $30. Update your payment method to continue accepting payments.`,
      headline: 'Payment acceptance paused',
      body: `
          <p style="margin: 0 0 16px 0;">
            Hey ${safeName}, your outstanding platform balance has reached the maximum limit.
          </p>

          ${amountCard('Outstanding balance', formattedTotal, '#DC2626')}

          ${alertBox('⚠️ <strong>Action required:</strong> New client payments are currently paused until this balance is cleared.', 'warning')}

          <p style="margin: 0 0 16px 0;">
            To resume accepting payments from your clients:
          </p>
          <ol style="margin: 0 0 16px 0; padding-left: 20px; color: #4a4a4a;">
            <li style="margin-bottom: 8px;">Click the button below to update your payment method</li>
            <li style="margin-bottom: 8px;">Clear the outstanding balance</li>
            <li>Start accepting payments again immediately</li>
          </ol>

          <p style="margin: 0; font-size: 14px; color: #666666;">
            Questions? Reply to this email and we'll help you get back on track.
          </p>
        `,
      ctaText: 'Clear Balance Now',
      ctaUrl: `${env.APP_URL}/settings/billing`,
      ctaColor: '#DC2626',
    }),
  })
}

// ============================================
// DISPUTE/CHARGEBACK EMAILS
// ============================================

/**
 * Notify creator when a dispute/chargeback is filed against them
 */
export async function sendDisputeCreatedEmail(
  to: string,
  displayName: string,
  amount: number,
  currency: string,
  reason: string
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeName = escapeHtml(displayName)
  const safeReason = escapeHtml(reason)

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(`Dispute filed: ${formattedAmount} on hold`),
    html: baseTemplate({
      preheader: `A subscriber has disputed a ${formattedAmount} payment. Funds are temporarily on hold.`,
      headline: 'Payment Dispute Filed',
      body: `
          <p style="margin: 0 0 16px 0;">
            Hey ${safeName}, a subscriber has filed a dispute (chargeback) with their bank for a recent payment.
          </p>

          ${amountCard('Amount on hold', formattedAmount, '#DC2626')}

          <div style="background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
            <p style="margin: 0; font-size: 14px; color: #92400E;">
              <strong>Reason cited:</strong> ${safeReason}
            </p>
          </div>

          <p style="margin: 0 0 16px 0;">
            <strong>What happens now:</strong>
          </p>
          <ul style="margin: 0 0 16px 0; padding-left: 20px; color: #4a4a4a;">
            <li style="margin-bottom: 8px;">The disputed amount is temporarily held</li>
            <li style="margin-bottom: 8px;">The payment processor will review the case</li>
            <li style="margin-bottom: 8px;">We'll notify you of the outcome</li>
          </ul>

          <p style="margin: 0; font-size: 14px; color: #666666;">
            If you have transaction records or communication with this subscriber, keep them handy in case they're needed.
          </p>
        `,
      ctaText: 'View Dashboard',
      ctaUrl: `${env.APP_URL}/dashboard`,
      ctaColor: '#DC2626',
    }),
  })
}

/**
 * Notify creator when a dispute is resolved (won or lost)
 */
export async function sendDisputeResolvedEmail(
  to: string,
  displayName: string,
  amount: number,
  currency: string,
  won: boolean
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeName = escapeHtml(displayName)

  const headline = won ? 'Dispute Won - Funds Restored' : 'Dispute Lost - Funds Deducted'
  const preheader = won
    ? `Good news! The ${formattedAmount} dispute was resolved in your favor.`
    : `The ${formattedAmount} dispute was resolved in the subscriber's favor.`

  const body = won
    ? `
        <p style="margin: 0 0 16px 0;">
          Great news, ${safeName}! The dispute has been resolved in your favor.
        </p>

        ${amountCard('Funds restored', formattedAmount, '#16A34A')}

        <p style="margin: 0; font-size: 14px; color: #666666;">
          The held funds have been restored to your account balance and will be included in your next payout.
        </p>
      `
    : `
        <p style="margin: 0 0 16px 0;">
          Hey ${safeName}, unfortunately the dispute was resolved in the subscriber's favor.
        </p>

        ${amountCard('Funds deducted', formattedAmount, '#DC2626')}

        <div style="background: #FEE2E2; border-left: 4px solid #DC2626; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
          <p style="margin: 0; font-size: 14px; color: #991B1B;">
            The subscriber's subscription has been automatically canceled to prevent future disputes.
          </p>
        </div>

        <p style="margin: 0; font-size: 14px; color: #666666;">
          If you believe this was an error, you may contact your payment processor directly. We're here to help if you need assistance.
        </p>
      `

  return sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(won ? `Dispute won: ${formattedAmount} restored` : `Dispute lost: ${formattedAmount} deducted`),
    html: baseTemplate({
      preheader,
      headline,
      body,
      ctaText: 'View Dashboard',
      ctaUrl: `${env.APP_URL}/dashboard`,
      ctaColor: won ? '#16A34A' : '#DC2626',
    }),
  })
}

// ============================================
// SUPPORT TICKET EMAILS
// ============================================

/**
 * Email sent when user submits a support ticket
 */
export async function sendSupportTicketConfirmationEmail(
  to: string,
  ticketId: string,
  subject: string
): Promise<EmailResult> {
  const result = await sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(`We received your request: ${subject}`),
    html: baseTemplate({
      preheader: 'Your support request has been submitted',
      headline: 'We got your message',
      body: `
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Thank you for reaching out. We've received your support request and will get back to you within 1-2 business days.
        </p>
        <p style="color: #6B7280; font-size: 14px; margin-top: 16px;">
          <strong>Subject:</strong> ${escapeHtml(subject)}
        </p>
        <p style="color: #6B7280; font-size: 14px;">
          <strong>Ticket ID:</strong> ${ticketId.slice(0, 8)}
        </p>
        <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-top: 16px;">
          If you need to add more information, simply reply to this email.
        </p>
      `,
    }),
  })

  if (result.success) {
    logEmailSent({ to, subject: `We received your request: ${subject}`, template: 'support_ticket_confirmation', messageId: result.messageId })
  } else {
    logEmailFailed({ to, subject: `We received your request: ${subject}`, template: 'support_ticket_confirmation', error: result.error || 'Unknown error' })
  }

  return result
}

/**
 * Email sent when admin replies to a support ticket
 */
export async function sendSupportTicketReplyEmail(
  to: string,
  ticketSubject: string,
  replyMessage: string
): Promise<EmailResult> {
  const result = await sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(`Re: ${ticketSubject}`),
    html: baseTemplate({
      preheader: 'NatePay Support has responded to your request',
      headline: 'We\'ve responded to your request',
      body: `
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          We've responded to your support request regarding "${escapeHtml(ticketSubject)}":
        </p>
        <div style="background: #F3F4F6; border-left: 4px solid #FF941A; padding: 16px; margin: 16px 0; border-radius: 0 8px 8px 0;">
          <p style="color: #374151; font-size: 15px; line-height: 1.6; white-space: pre-wrap; margin: 0;">
            ${escapeHtml(replyMessage)}
          </p>
        </div>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          If you have any follow-up questions, simply reply to this email.
        </p>
      `,
    }),
  })

  if (result.success) {
    logEmailSent({ to, subject: `Re: ${ticketSubject}`, template: 'support_ticket_reply', messageId: result.messageId })
  } else {
    logEmailFailed({ to, subject: `Re: ${ticketSubject}`, template: 'support_ticket_reply', error: result.error || 'Unknown error' })
  }

  return result
}

// ============================================
// ADMIN-CREATED ACCOUNTS
// ============================================

/**
 * Email sent when admin creates a creator account on someone's behalf
 * Includes their payment link and login instructions
 */
export async function sendCreatorAccountCreatedEmail(
  to: string,
  displayName: string,
  username: string,
  paymentLink: string,
  amount: number,
  currency: string
): Promise<EmailResult> {
  const safeName = escapeHtml(displayName)
  const formattedAmount = formatAmountForEmail(amount * 100, currency) // amount is in major units, convert to cents for formatting
  const subject = `Your ${BRAND_NAME} page is ready!`

  const result = await sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(subject),
    html: baseTemplate({
      preheader: `Your payment page is set up and ready to receive ${formattedAmount}/month subscriptions.`,
      headline: `Welcome, ${safeName}!`,
      body: `
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Great news! Your ${BRAND_NAME} page has been set up and is ready to accept payments.
        </p>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0;">
          <tr>
            <td style="background-color: #F9FAFB; border-radius: 12px; padding: 20px;">
              <p style="margin: 0 0 12px 0; font-size: 14px; color: #6B7280;">Your payment link:</p>
              <a href="${escapeHtml(paymentLink)}" style="font-size: 18px; color: #FF941A; font-weight: 600; text-decoration: none; word-break: break-all;">
                ${escapeHtml(paymentLink)}
              </a>
              <p style="margin: 16px 0 0 0; font-size: 14px; color: #6B7280;">
                Monthly subscription: <strong style="color: #111827;">${formattedAmount}</strong>
              </p>
            </td>
          </tr>
        </table>

        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Share this link with your clients and they can subscribe with just a few clicks. Payments go directly to your bank account.
        </p>

        <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-top: 20px;">
          <strong>To access your dashboard:</strong> Visit ${BRAND_NAME} and sign in with this email address. You'll receive a one-time code to verify your identity.
        </p>

        <p style="color: #6B7280; font-size: 14px; margin-top: 24px;">
          From your dashboard, you can customize your page, track your subscribers, and manage your payouts.
        </p>
      `,
      ctaText: 'Go to Dashboard',
      ctaUrl: `${env.APP_URL}/dashboard`,
      footerText: 'This account was set up on your behalf by NatePay support.',
    }),
  })

  if (result.success) {
    logEmailSent({ to, subject, template: 'creator_account_created', messageId: result.messageId })
  } else {
    logEmailFailed({ to, subject, template: 'creator_account_created', error: result.error || 'Unknown error' })
  }

  return result
}

// ============================================
// DISPUTE ENFORCEMENT EMAILS
// ============================================

/**
 * Email sent when creator's payouts are paused due to high dispute rate
 * Threshold: >2% with minimum 5 disputes
 */
export async function sendPayoutsPausedEmail(
  to: string,
  displayName: string,
  disputeRate: number,
  disputeCount: number,
  transactionCount: number
): Promise<EmailResult> {
  const safeName = escapeHtml(displayName)
  const ratePercent = (disputeRate * 100).toFixed(2)
  const subject = `Action Required: Payouts Paused Due to Disputes`

  const result = await sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(subject),
    html: baseTemplate({
      preheader: `Your dispute rate of ${ratePercent}% has triggered a payout pause.`,
      headline: `Payouts Paused`,
      body: `
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Hi ${safeName},
        </p>

        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Your account's dispute rate has exceeded our safety threshold, so we've temporarily paused payouts to your bank account.
        </p>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0;">
          <tr>
            <td style="background-color: #FEF2F2; border-radius: 12px; padding: 20px; border-left: 4px solid #EF4444;">
              <p style="margin: 0 0 12px 0; font-size: 14px; color: #991B1B; font-weight: 600;">Current Status</p>
              <p style="margin: 0; font-size: 14px; color: #7F1D1D;">
                Dispute Rate: <strong>${ratePercent}%</strong> (${disputeCount} disputes / ${transactionCount} transactions)<br>
                Threshold: 2.0%
              </p>
            </td>
          </tr>
        </table>

        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          <strong>What this means:</strong>
        </p>
        <ul style="color: #374151; font-size: 16px; line-height: 1.6; padding-left: 20px;">
          <li>Your subscribers can still pay you</li>
          <li>Funds are held safely in your account</li>
          <li>Payouts will resume once your dispute rate drops below 2%</li>
        </ul>

        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          <strong>What you can do:</strong>
        </p>
        <ul style="color: #374151; font-size: 16px; line-height: 1.6; padding-left: 20px;">
          <li>Review your recent disputes in your dashboard</li>
          <li>Ensure your billing descriptor is clear to subscribers</li>
          <li>Make cancellation easy to find</li>
          <li>Respond to dispute evidence requests promptly</li>
        </ul>

        <p style="color: #6B7280; font-size: 14px; margin-top: 24px;">
          High dispute rates can result in penalties from payment networks. We're pausing payouts to protect both you and our platform.
        </p>
      `,
      ctaText: 'View Disputes',
      ctaUrl: `${env.APP_URL}/dashboard/disputes`,
      footerText: 'If you believe this is an error, please contact support.',
    }),
  })

  if (result.success) {
    logEmailSent({ to, subject, template: 'payouts_paused', messageId: result.messageId })
  } else {
    logEmailFailed({ to, subject, template: 'payouts_paused', error: result.error || 'Unknown error' })
  }

  return result
}

/**
 * Email sent when creator's account is suspended due to critical dispute rate
 * Threshold: >3% dispute rate
 */
export async function sendAccountSuspendedEmail(
  to: string,
  displayName: string,
  disputeRate: number,
  disputeCount: number
): Promise<EmailResult> {
  const safeName = escapeHtml(displayName)
  const ratePercent = (disputeRate * 100).toFixed(2)
  const subject = `Account Suspended: Dispute Rate Critical`

  const result = await sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(subject),
    html: baseTemplate({
      preheader: `Your account has been suspended due to a ${ratePercent}% dispute rate.`,
      headline: `Account Suspended`,
      body: `
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Hi ${safeName},
        </p>

        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Due to an excessive dispute rate, we've had to suspend your account. This means:
        </p>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0;">
          <tr>
            <td style="background-color: #FEF2F2; border-radius: 12px; padding: 20px; border-left: 4px solid #DC2626;">
              <p style="margin: 0 0 12px 0; font-size: 14px; color: #991B1B; font-weight: 600;">Account Status: Suspended</p>
              <p style="margin: 0; font-size: 14px; color: #7F1D1D;">
                Dispute Rate: <strong>${ratePercent}%</strong> (${disputeCount} disputes)<br>
                Critical Threshold: 3.0%
              </p>
            </td>
          </tr>
        </table>

        <ul style="color: #374151; font-size: 16px; line-height: 1.6; padding-left: 20px;">
          <li><strong>Your payment page is disabled</strong> — new subscribers cannot sign up</li>
          <li><strong>Payouts are paused</strong> — funds are held pending review</li>
          <li><strong>Existing subscriptions</strong> — will not be renewed</li>
        </ul>

        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          <strong>To appeal this suspension:</strong>
        </p>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Please contact our support team with documentation showing how you'll prevent future disputes. Include any evidence that disputes were filed in error.
        </p>

        <p style="color: #6B7280; font-size: 14px; margin-top: 24px;">
          Payment networks impose significant penalties on platforms with high dispute rates. To protect our ability to serve all creators, we must enforce these limits.
        </p>
      `,
      ctaText: 'Contact Support',
      ctaUrl: `${env.APP_URL}/support?reason=dispute_suspension`,
      footerText: 'This action was taken automatically based on dispute rate thresholds.',
    }),
  })

  if (result.success) {
    logEmailSent({ to, subject, template: 'account_suspended', messageId: result.messageId })
  } else {
    logEmailFailed({ to, subject, template: 'account_suspended', error: result.error || 'Unknown error' })
  }

  return result
}

/**
 * Email sent when creator's payouts are resumed after dispute rate improves
 */
export async function sendPayoutsResumedEmail(
  to: string,
  displayName: string,
  newDisputeRate: number
): Promise<EmailResult> {
  const safeName = escapeHtml(displayName)
  const ratePercent = (newDisputeRate * 100).toFixed(2)
  const subject = `Good News: Payouts Resumed`

  const result = await sendEmail({
    from: env.EMAIL_FROM,
    to,
    subject: sanitizeEmailSubject(subject),
    html: baseTemplate({
      preheader: `Your dispute rate has improved and payouts are now active.`,
      headline: `Payouts Resumed!`,
      body: `
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Hi ${safeName},
        </p>

        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Great news! Your dispute rate has dropped to ${ratePercent}%, which is below our 2% threshold. We've resumed payouts to your bank account.
        </p>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0;">
          <tr>
            <td style="background-color: #F0FDF4; border-radius: 12px; padding: 20px; border-left: 4px solid #22C55E;">
              <p style="margin: 0; font-size: 14px; color: #166534;">
                ✓ Payouts are now active<br>
                ✓ Current dispute rate: ${ratePercent}%
              </p>
            </td>
          </tr>
        </table>

        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Any pending payouts will be processed on the next payout cycle. Thank you for addressing the dispute issues.
        </p>

        <p style="color: #6B7280; font-size: 14px; margin-top: 24px;">
          To keep your dispute rate low, ensure your billing descriptor is clear and cancellation is easy to find.
        </p>
      `,
      ctaText: 'View Dashboard',
      ctaUrl: `${env.APP_URL}/dashboard`,
    }),
  })

  if (result.success) {
    logEmailSent({ to, subject, template: 'payouts_resumed', messageId: result.messageId })
  } else {
    logEmailFailed({ to, subject, template: 'payouts_resumed', error: result.error || 'Unknown error' })
  }

  return result
}
