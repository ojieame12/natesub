// Email Template Infrastructure
// Base template, helpers, and HTML generation utilities for all email types
//
// Extracted from email.ts to reduce file size and enable reuse

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Attachment, CreateEmailOptions } from 'resend'
import { env } from '../config/env.js'
import { centsToDisplayAmount, isZeroDecimalCurrency } from '../utils/currency.js'

// ============================================
// EMAIL CONFIGURATION
// ============================================

export const MAX_RETRIES = 3
export const RETRY_DELAYS_MS = [1000, 3000, 5000] // 1s, 3s, 5s

// Email logo: use a publicly reachable HTTPS URL (Gmail blocks `data:` URIs).
export const BRAND_NAME = 'Nate'
export const BRAND_COLOR = '#FF941A'
export const BRAND_COLOR_DARK = '#E8850F'

const EMAIL_LOGO_FALLBACK_URL = new URL('/logo-email.png', env.PUBLIC_PAGE_URL).toString()

function resolveEmailLogoUrl(): string {
  // Prefer a publicly reachable origin. Public pages are typically unauthenticated and safe for image hosting.
  const configured = env.EMAIL_LOGO_URL?.trim()
  if (!configured) return EMAIL_LOGO_FALLBACK_URL

  const lower = configured.toLowerCase()

  const getPathname = (value: string): string | null => {
    try {
      return new URL(value).pathname.toLowerCase()
    } catch {
      return null
    }
  }

  // Gmail blocks/strips `data:` image URIs, so base64 logos won't render.
  if (lower.startsWith('data:')) {
    console.warn('[email] EMAIL_LOGO_URL uses a data: URI; Gmail blocks this. Falling back to hosted logo-email.png.')
    return EMAIL_LOGO_FALLBACK_URL
  }

  // Gmail frequently blocks SVG images in <img>. Prefer PNG.
  const pathname = getPathname(configured) || lower
  if (pathname.endsWith('.svg')) {
    console.warn('[email] EMAIL_LOGO_URL points to an SVG; Gmail may block this. Falling back to hosted logo-email.png.')
    return EMAIL_LOGO_FALLBACK_URL
  }

  return configured
}

const EMAIL_LOGO_URL = resolveEmailLogoUrl()
const USE_INLINE_EMAIL_LOGO = EMAIL_LOGO_URL === EMAIL_LOGO_FALLBACK_URL
const INLINE_EMAIL_LOGO_CID = 'nate-logo'

function loadInlineEmailLogoAttachment(): Attachment | null {
  try {
    const filePath = join(process.cwd(), 'assets', 'logo-email.png')
    const content = readFileSync(filePath)
    return {
      filename: 'logo-email.png',
      content,
      contentType: 'image/png',
      inlineContentId: INLINE_EMAIL_LOGO_CID,
    }
  } catch (err: any) {
    console.warn('[email] Inline logo asset unavailable; falling back to remote logo URL.', err?.message || err)
    return null
  }
}

const INLINE_EMAIL_LOGO_ATTACHMENT: Attachment | null = USE_INLINE_EMAIL_LOGO ? loadInlineEmailLogoAttachment() : null

function getEmailLogoSrc(): string {
  return INLINE_EMAIL_LOGO_ATTACHMENT ? `cid:${INLINE_EMAIL_LOGO_CID}` : EMAIL_LOGO_URL
}

export function withDefaultEmailAttachments(options: CreateEmailOptions): CreateEmailOptions {
  if (!INLINE_EMAIL_LOGO_ATTACHMENT) return options

  const existing = options.attachments || []
  const hasInlineLogo = existing.some(att => att.inlineContentId === INLINE_EMAIL_LOGO_CID)
  if (hasInlineLogo) return options

  return { ...options, attachments: [INLINE_EMAIL_LOGO_ATTACHMENT, ...existing] }
}

// ============================================
// HELPERS
// ============================================

export function escapeHtml(value: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;',
  }
  return value.replace(/[&<>"']/g, (ch) => map[ch]!)
}

export function sanitizeEmailSubject(value: string): string {
  // Prevent header injection and keep subjects readable.
  return value.replace(/[\r\n]+/g, ' ').trim()
}

// Format amount in cents for display in emails (handles zero-decimal currencies)
export function formatAmountForEmail(amountCents: number, currency: string): string {
  const displayAmount = centsToDisplayAmount(amountCents, currency)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: isZeroDecimalCurrency(currency) ? 0 : 2,
    maximumFractionDigits: isZeroDecimalCurrency(currency) ? 0 : 2,
  }).format(displayAmount)
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================
// BASE EMAIL TEMPLATE
// ============================================

export interface BaseTemplateOptions {
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
 * Logo uses a public URL (PNG recommended) since many email clients block `data:` URIs and/or SVG.
 */
export function baseTemplate(options: BaseTemplateOptions): string {
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
            <td bgcolor="#000000" style="padding: 0; background-color: #000000;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="#000000" style="background-color: #000000;">
                <tr>
                  <td align="center" bgcolor="#000000" style="padding: 28px 24px; background-color: #000000;">
                    <a href="${env.APP_URL}" style="text-decoration: none; display: inline-block;">
                      <img
                        src="${escapeHtml(getEmailLogoSrc())}"
                        alt="${BRAND_NAME}"
                        width="85"
                        height="29"
                        style="display: block; border: 0; width: 85px; height: 29px; color: #ffffff; font-size: 20px; font-weight: 700;"
                      >
                    </a>
                  </td>
                </tr>
              </table>
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

// ============================================
// REUSABLE HTML COMPONENTS
// ============================================

// Helper to create highlighted card/box for amounts
export function amountCard(label: string, amount: string, color: string = '#1a1a1a'): string {
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
export function infoRow(label: string, value: string): string {
  return `
    <p style="margin: 0 0 8px 0;">
      <span style="color: #888888;">${escapeHtml(label)}:</span>
      <strong style="color: #1a1a1a;">${escapeHtml(value)}</strong>
    </p>
  `
}

// Helper for alert/warning boxes
export function alertBox(message: string, type: 'warning' | 'info' | 'success' = 'warning'): string {
  const colors = {
    warning: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
    info: { bg: '#DBEAFE', border: '#3B82F6', text: '#1E40AF' },
    success: { bg: '#D1FAE5', border: '#10B981', text: '#065F46' },
  }
  const c = colors[type]
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 20px 0;">
      <tr>
        <td style="background-color: ${c.bg}; border-left: 4px solid ${c.border}; border-radius: 8px; padding: 16px;">
          <p style="margin: 0; font-size: 14px; color: ${c.text};">${message}</p>
        </td>
      </tr>
    </table>
  `
}
