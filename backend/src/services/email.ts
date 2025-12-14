import { Resend } from 'resend'
import { env } from '../config/env.js'
import { centsToDisplayAmount, isZeroDecimalCurrency } from '../utils/currency.js'

const resend = new Resend(env.RESEND_API_KEY)

// ============================================
// EMAIL CONFIGURATION
// ============================================

const MAX_RETRIES = 3
const RETRY_DELAYS_MS = [1000, 3000, 5000] // 1s, 3s, 5s

// Logo configuration - uses multiple fallback strategies for maximum compatibility
// Primary: Hosted image, Fallback: Styled text logo
const LOGO_URL = `${env.APP_URL}/logo-email.png` // 200x50px recommended, PNG with transparency
const BRAND_NAME = 'Nate'
const BRAND_COLOR = '#FF941A'
const BRAND_COLOR_DARK = '#E8850F'

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
// BASE EMAIL TEMPLATE
// ============================================

interface BaseTemplateOptions {
  preheader?: string           // Hidden preview text shown in inbox
  headline: string             // Main heading
  body: string                 // Main content (can include HTML)
  ctaText?: string            // Button text
  ctaUrl?: string             // Button URL
  ctaColor?: string           // Button color (default: brand orange)
  footerText?: string         // Additional footer text
  showUnsubscribe?: boolean   // Show unsubscribe link (for marketing emails)
}

/**
 * Base email template with consistent branding
 * Uses bulletproof logo rendering with multiple fallback strategies:
 * 1. Hosted image (most visual)
 * 2. Alt text fallback (if images blocked)
 * 3. Text-based logo backup in header background
 */
function baseTemplate(options: BaseTemplateOptions): string {
  const {
    preheader,
    headline,
    body,
    ctaText,
    ctaUrl,
    ctaColor = BRAND_COLOR,
    footerText,
    showUnsubscribe = false,
  } = options

  const currentYear = new Date().getFullYear()

  // Preheader - hidden text that appears in email preview
  const preheaderHtml = preheader ? `
    <!--[if mso]><table role="presentation" width="0" style="display:none;"><tr><td><![endif]-->
    <div style="display: none; max-height: 0px; overflow: hidden; mso-hide: all;">
      ${escapeHtml(preheader)}
      ${'&nbsp;'.repeat(100)}
    </div>
    <!--[if mso]></td></tr></table><![endif]-->
  ` : ''

  // CTA Button with Outlook compatibility
  const ctaHtml = ctaText && ctaUrl ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
      <tr>
        <td style="border-radius: 8px; background-color: ${ctaColor};">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(ctaUrl)}" style="height: 48px; width: 200px; v-text-anchor: middle;" arcsize="17%" strokecolor="${ctaColor}" fillcolor="${ctaColor}">
          <w:anchorlock/>
          <center style="color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; font-weight: 600;">
            ${escapeHtml(ctaText)}
          </center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="${escapeHtml(ctaUrl)}" style="display: inline-block; background-color: ${ctaColor}; color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; mso-padding-alt: 14px 32px;">
            ${escapeHtml(ctaText)}
          </a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>
  ` : ''

  // Footer with optional unsubscribe
  const unsubscribeHtml = showUnsubscribe ? `
    <p style="margin: 0 0 8px 0;">
      <a href="${env.APP_URL}/unsubscribe" style="color: #888888; text-decoration: underline;">Unsubscribe</a>
    </p>
  ` : ''

  const footerExtraHtml = footerText ? `
    <p style="margin: 0 0 16px 0; color: #666666;">${escapeHtml(footerText)}</p>
  ` : ''

  return `
<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
  <title>${escapeHtml(headline)}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    /* Reset styles */
    body, table, td, p, a, li, blockquote { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; }

    /* Dark mode support */
    @media (prefers-color-scheme: dark) {
      .dark-mode-bg { background-color: #1a1a1a !important; }
      .dark-mode-text { color: #ffffff !important; }
      .dark-mode-text-secondary { color: #cccccc !important; }
    }

    /* Mobile styles */
    @media screen and (max-width: 600px) {
      .mobile-padding { padding: 24px 16px !important; }
      .mobile-full-width { width: 100% !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  ${preheaderHtml}

  <!-- Email wrapper -->
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 24px 16px;">

        <!-- Email container -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

          <!-- Logo Header -->
          <tr>
            <td align="center" style="padding: 32px 24px 24px 24px; border-bottom: 1px solid #f0f0f0;">
              <!--[if mso]>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center">
              <![endif]-->

              <!-- Logo with multiple fallback strategies -->
              <!-- Strategy 1: Hosted image -->
              <a href="${env.APP_URL}" style="text-decoration: none; display: inline-block;">
                <!--[if mso]>
                <img src="${LOGO_URL}" alt="${BRAND_NAME}" width="100" height="32" style="display: block; border: 0;">
                <![endif]-->
                <!--[if !mso]><!-->
                <img src="${LOGO_URL}"
                     alt="${BRAND_NAME}"
                     width="100"
                     height="32"
                     style="display: block; border: 0; max-width: 100px; height: auto;"
                     onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                <!-- Fallback: Styled text logo (shown if image fails) -->
                <div style="display: none; font-size: 28px; font-weight: 700; color: ${BRAND_COLOR}; letter-spacing: -0.5px;">
                  ${BRAND_NAME}
                </div>
                <!--<![endif]-->
              </a>

              <!--[if mso]>
              </td></tr></table>
              <![endif]-->
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td class="mobile-padding" style="padding: 32px 40px 40px 40px;">

              <!-- Headline -->
              <h1 style="margin: 0 0 20px 0; font-size: 24px; font-weight: 600; color: #1a1a1a; line-height: 1.3;">
                ${headline}
              </h1>

              <!-- Body Content -->
              <div style="font-size: 16px; color: #4a4a4a; line-height: 1.6;">
                ${body}
              </div>

              <!-- CTA Button -->
              ${ctaHtml}

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #fafafa; border-top: 1px solid #f0f0f0;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="font-size: 13px; color: #888888; line-height: 1.5;">
                    ${footerExtraHtml}
                    ${unsubscribeHtml}
                    <p style="margin: 0 0 8px 0;">
                      <a href="${env.APP_URL}/help" style="color: #888888; text-decoration: none;">Help</a>
                      &nbsp;&middot;&nbsp;
                      <a href="${env.APP_URL}/privacy" style="color: #888888; text-decoration: none;">Privacy</a>
                      &nbsp;&middot;&nbsp;
                      <a href="${env.APP_URL}/terms" style="color: #888888; text-decoration: none;">Terms</a>
                    </p>
                    <p style="margin: 0; color: #aaaaaa;">
                      &copy; ${currentYear} ${BRAND_NAME}. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- End email container -->

      </td>
    </tr>
  </table>
  <!-- End email wrapper -->

</body>
</html>
  `.trim()
}

// Helper to create highlighted card/box for amounts
function amountCard(label: string, amount: string, color: string = '#1a1a1a'): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 20px 0;">
      <tr>
        <td style="background-color: #f8f8f8; border-radius: 12px; padding: 20px; text-align: center;">
          <p style="margin: 0 0 8px 0; font-size: 14px; color: #888888;">${escapeHtml(label)}</p>
          <p style="margin: 0; font-size: 32px; font-weight: 700; color: ${color};">${escapeHtml(amount)}</p>
        </td>
      </tr>
    </table>
  `
}

// Helper for info rows (label: value pairs)
function infoRow(label: string, value: string): string {
  return `
    <p style="margin: 0 0 8px 0;">
      <span style="color: #888888;">${escapeHtml(label)}:</span>
      <strong style="color: #1a1a1a;">${escapeHtml(value)}</strong>
    </p>
  `
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
// AUTHENTICATION EMAILS
// ============================================

export async function sendOtpEmail(to: string, otp: string): Promise<EmailResult> {
  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(`${otp} is your ${BRAND_NAME} verification code`),
      html: baseTemplate({
        preheader: `Your verification code is ${otp}. It expires in 15 minutes.`,
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
          <p style="margin: 0; font-size: 14px; color: #888888;">This code expires in 15 minutes. If you didn't request this, you can safely ignore it.</p>
        `,
      }),
    })
  )
}

// ============================================
// ONBOARDING EMAILS
// ============================================

export async function sendWelcomeEmail(to: string, displayName: string): Promise<EmailResult> {
  const safeName = escapeHtml(displayName)
  return sendWithRetry(() =>
    resend.emails.send({
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
  )
}

export async function sendOnboardingIncompleteEmail(
  to: string,
  isSecondReminder: boolean = false
): Promise<EmailResult> {
  const subject = isSecondReminder
    ? "Don't forget to finish setting up your page"
    : `Finish setting up your ${BRAND_NAME} page`

  return sendWithRetry(() =>
    resend.emails.send({
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
  )
}

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
  )
}

// ============================================
// SUBSCRIBER/PAYMENT EMAILS
// ============================================

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

  const tierText = safeTierName ? ` to ${safeTierName}` : ''

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(`New subscriber: ${subscriberName}`),
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
  )
}

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
      html: baseTemplate({
        preheader: `Your subscription to ${creatorName} renews on ${formattedDate}.`,
        headline: 'Your subscription renews soon',
        body: `
          <p style="margin: 0 0 16px 0;">
            Your subscription to <strong>${safeCreatorName}</strong> will renew on <strong>${escapeHtml(formattedDate)}</strong> for <strong>${escapeHtml(formattedAmount)}</strong>.
          </p>
          <p style="margin: 0; font-size: 14px; color: #888888;">
            No action needed if you'd like to continue. To update your payment method or cancel, visit your account settings.
          </p>
        `,
        ctaText: 'Manage Subscription',
        ctaUrl: `${env.APP_URL}/settings`,
        ctaColor: '#1a1a1a',
      }),
    })
  )
}

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
    ? `We'll automatically retry on ${retryDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`
    : 'Please update your payment method to continue your subscription.'

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(`Action required: Payment failed for ${creatorName}`),
      html: baseTemplate({
        preheader: `We couldn't process your ${formattedAmount} payment. Please update your payment method.`,
        headline: 'Payment failed',
        body: `
          <p style="margin: 0 0 16px 0;">
            We couldn't process your <strong>${escapeHtml(formattedAmount)}</strong> payment for your subscription to <strong>${safeCreatorName}</strong>.
          </p>
          <p style="margin: 0; font-size: 14px; color: #888888;">${escapeHtml(retryMessage)}</p>
        `,
        ctaText: 'Update Payment Method',
        ctaUrl: `${env.APP_URL}/settings`,
        ctaColor: '#dc2626',
      }),
    })
  )
}

export async function sendSubscriptionCanceledEmail(
  to: string,
  creatorName: string,
  reason: 'payment_failed' | 'user_canceled' | 'creator_deactivated' | 'other' = 'other'
): Promise<EmailResult> {
  const safeCreatorName = escapeHtml(creatorName)

  let reasonMessage: string
  switch (reason) {
    case 'payment_failed':
      reasonMessage = 'has been canceled due to payment issues'
      break
    case 'user_canceled':
      reasonMessage = 'has been canceled as requested'
      break
    case 'creator_deactivated':
      reasonMessage = 'has ended because the service provider deactivated their account'
      break
    default:
      reasonMessage = 'has ended'
  }

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(`Subscription to ${creatorName} has ended`),
      html: baseTemplate({
        preheader: `Your subscription to ${creatorName} ${reasonMessage}.`,
        headline: 'Your subscription has ended',
        body: `
          <p style="margin: 0 0 16px 0;">
            Your subscription to <strong>${safeCreatorName}</strong> ${reasonMessage}.
          </p>
          <p style="margin: 0; font-size: 14px; color: #888888;">
            You can resubscribe anytime to continue supporting ${safeCreatorName}.
          </p>
        `,
        ctaText: 'Resubscribe',
        ctaUrl: env.APP_URL,
      }),
    })
  )
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

  return sendWithRetry(() =>
    resend.emails.send({
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
  )
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

  return sendWithRetry(() =>
    resend.emails.send({
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
  )
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

  return sendWithRetry(() =>
    resend.emails.send({
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
  )
}

export async function sendRequestExpiringEmail(
  to: string,
  senderName: string,
  requestLink: string
): Promise<EmailResult> {
  const safeSenderName = escapeHtml(senderName)

  return sendWithRetry(() =>
    resend.emails.send({
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
  )
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

  return sendWithRetry(() =>
    resend.emails.send({
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
  )
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

  return sendWithRetry(() =>
    resend.emails.send({
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
  )
}

// ============================================
// UPDATE EMAILS
// ============================================

export async function sendUpdateEmail(
  to: string,
  creatorName: string,
  title: string | null,
  body: string
): Promise<EmailResult> {
  const safeCreatorName = escapeHtml(creatorName)
  const safeTitle = title ? escapeHtml(title) : null
  const safeBody = escapeHtml(body)

  const headlineText = safeTitle || `New update from ${safeCreatorName}`

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(title || `New update from ${creatorName}`),
      html: baseTemplate({
        preheader: body.substring(0, 100) + (body.length > 100 ? '...' : ''),
        headline: headlineText,
        body: `
          <p style="margin: 0 0 8px 0; font-size: 14px; color: #888888;">From ${safeCreatorName}</p>
          <p style="margin: 0; white-space: pre-wrap; line-height: 1.6;">${safeBody}</p>
        `,
      }),
    })
  )
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

  return sendWithRetry(() =>
    resend.emails.send({
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
  )
}

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
  )
}

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
  )
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

  return sendWithRetry(() =>
    resend.emails.send({
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
  )
}
