// Email Template Infrastructure
// Clean, minimal, Apple-inspired design system
//
// ============================================
// EMAIL CLIENT COMPATIBILITY NOTES
// ============================================
//
// FONTS:
// - Google Fonts (Barlow) removed - Gmail, Outlook, Yahoo strip <link> and @import
// - Using system font stack: SF Pro → Segoe UI → Roboto → Helvetica → Arial
// - This ensures native, clean typography on all platforms
//
// LAYOUT:
// - All layouts use tables (not divs/flexbox) for Outlook compatibility
// - MSO conditional comments wrap container for Outlook width handling
// - border-radius gracefully degrades (ignored in Outlook Windows)
// - No box-shadow (stripped in Outlook)
//
// DARK MODE:
// - prefers-color-scheme media query works in: Apple Mail, iOS Mail, Outlook.com
// - Does NOT work in: Outlook Windows, Gmail app
// - Inline styles provide fallback colors
//
// MOBILE:
// - Media queries work in: iOS Mail, Apple Mail, Android Gmail
// - May not work in: Outlook app, some webmail
// - Base design is responsive without media queries (fluid width)
//
// SPECIAL CHARACTERS:
// - Checkmarks use HTML entity &#10003; (more reliable than Unicode)
// - Emojis avoided in templates (render inconsistently)
//
// TESTED CLIENT MATRIX:
// ✓ Gmail (web, iOS, Android)
// ✓ Apple Mail (macOS, iOS)
// ✓ Outlook (web, Windows 2016+, Mac)
// ✓ Yahoo Mail
// ✓ Outlook.com
// ============================================
//
// Design principles:
// - System fonts for reliability
// - Light, airy aesthetic with whites and soft grays
// - Generous breathing room and whitespace
// - Status badges for context at a glance
// - Premium receipt-style cards for transactions

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

export const BRAND_NAME = 'Nate'
export const BRAND_COLOR = '#FF941A'
export const BRAND_COLOR_DARK = '#E8850F'

// Design tokens - Apple-inspired palette
const COLORS = {
  // Primary
  brand: '#FF941A',
  brandDark: '#E8850F',

  // Neutrals (softer, warmer grays)
  white: '#FFFFFF',
  bg: '#FAFAFA',
  bgSubtle: '#F5F5F7',
  border: '#E8E8ED',
  borderLight: '#F0F0F5',

  // Text (softer than pure black)
  textPrimary: '#1D1D1F',
  textSecondary: '#6E6E73',
  textTertiary: '#86868B',
  textMuted: '#AEAEB2',

  // Status
  success: '#34C759',
  successBg: '#F0FDF4',
  successText: '#166534',

  warning: '#FF9500',
  warningBg: '#FFFBEB',
  warningText: '#92400E',

  error: '#FF3B30',
  errorBg: '#FEF2F2',
  errorText: '#991B1B',

  info: '#007AFF',
  infoBg: '#EFF6FF',
  infoText: '#1E40AF',
}

// Typography - System fonts first (Barlow won't load in most email clients)
// Email clients strip Google Fonts, so we lead with reliable system fonts
// The font stack degrades gracefully: SF Pro (Apple) → Segoe (Windows) → Roboto (Android) → Helvetica/Arial
const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
const FONT_STACK_MONO = "'SF Mono', 'Consolas', 'Monaco', 'Courier New', monospace"

// ============================================
// LOGO HANDLING
// ============================================

const EMAIL_LOGO_FALLBACK_URL = new URL('/logo-email.png', env.PUBLIC_PAGE_URL).toString()

function resolveEmailLogoUrl(): string {
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

  if (lower.startsWith('data:')) {
    console.warn('[email] EMAIL_LOGO_URL uses a data: URI; Gmail blocks this. Falling back to hosted logo-email.png.')
    return EMAIL_LOGO_FALLBACK_URL
  }

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
  return value.replace(/[\r\n]+/g, ' ').trim()
}

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
// STATUS BADGES
// ============================================

export type StatusBadgeType = 'success' | 'warning' | 'error' | 'info' | 'reminder'

export function statusBadge(text: string, type: StatusBadgeType = 'info'): string {
  const styles: Record<StatusBadgeType, { bg: string; text: string; border: string }> = {
    success: { bg: COLORS.successBg, text: COLORS.successText, border: COLORS.success },
    warning: { bg: COLORS.warningBg, text: COLORS.warningText, border: COLORS.warning },
    error: { bg: COLORS.errorBg, text: COLORS.errorText, border: COLORS.error },
    info: { bg: COLORS.infoBg, text: COLORS.infoText, border: COLORS.info },
    reminder: { bg: '#FFF7ED', text: '#C2410C', border: COLORS.brand },
  }
  const s = styles[type]

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
      <tr>
        <td style="background-color: ${s.bg}; border: 1px solid ${s.border}; border-radius: 100px; padding: 6px 14px;">
          <span style="font-family: ${FONT_STACK}; font-size: 12px; font-weight: 600; color: ${s.text}; text-transform: uppercase; letter-spacing: 0.5px;">
            ${escapeHtml(text)}
          </span>
        </td>
      </tr>
    </table>
  `
}

// ============================================
// BASE EMAIL TEMPLATE
// ============================================

export interface BaseTemplateOptions {
  preheader?: string
  headline: string
  body: string
  ctaText?: string
  ctaUrl?: string
  ctaColor?: string
  ctaSecondaryText?: string      // Secondary link text
  ctaSecondaryUrl?: string       // Secondary link URL
  footerText?: string
  showUnsubscribe?: boolean
  badge?: { text: string; type: StatusBadgeType }  // Status badge at top
}

/**
 * Base email template - Clean, minimal, Apple-inspired design
 *
 * Features:
 * - Barlow font via Google Fonts
 * - Light header with subtle border
 * - Generous whitespace and breathing room
 * - Pill-shaped CTA buttons
 * - Minimal, elegant footer
 */
export function baseTemplate(options: BaseTemplateOptions): string {
  const {
    preheader,
    headline,
    body,
    ctaText,
    ctaUrl,
    ctaColor = COLORS.brand,
    ctaSecondaryText,
    ctaSecondaryUrl,
    footerText,
    showUnsubscribe = false,
    badge,
  } = options

  const currentYear = new Date().getFullYear()

  // Preheader - hidden text for inbox preview
  const preheaderHtml = preheader ? `
    <!--[if mso]><table role="presentation" width="0" style="display:none;"><tr><td><![endif]-->
    <div style="display: none; max-height: 0px; overflow: hidden; mso-hide: all;">
      ${escapeHtml(preheader)}
      ${'&nbsp;'.repeat(100)}
    </div>
    <!--[if mso]></td></tr></table><![endif]-->
  ` : ''

  // Status badge
  const badgeHtml = badge ? statusBadge(badge.text, badge.type) : ''

  // Primary CTA - Pill-shaped button
  const ctaHtml = ctaText && ctaUrl ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 32px 0 16px 0;">
      <tr>
        <td style="border-radius: 100px; background-color: ${ctaColor};">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(ctaUrl)}" style="height: 52px; width: 220px; v-text-anchor: middle;" arcsize="50%" strokecolor="${ctaColor}" fillcolor="${ctaColor}">
          <w:anchorlock/>
          <center style="color: #ffffff; font-family: ${FONT_STACK}; font-size: 15px; font-weight: 600;">
            ${escapeHtml(ctaText)}
          </center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="${escapeHtml(ctaUrl)}" style="display: inline-block; background-color: ${ctaColor}; color: #ffffff !important; text-decoration: none; padding: 16px 36px; border-radius: 100px; font-weight: 600; font-size: 15px; font-family: ${FONT_STACK}; mso-padding-alt: 16px 36px;">
            ${escapeHtml(ctaText)}
          </a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>
  ` : ''

  // Secondary CTA - Text link
  const ctaSecondaryHtml = ctaSecondaryText && ctaSecondaryUrl ? `
    <p style="margin: 0; font-size: 14px;">
      <a href="${escapeHtml(ctaSecondaryUrl)}" style="color: ${COLORS.textSecondary}; text-decoration: underline; font-family: ${FONT_STACK};">
        ${escapeHtml(ctaSecondaryText)}
      </a>
    </p>
  ` : ''

  // Footer
  const unsubscribeHtml = showUnsubscribe ? `
    <a href="${env.APP_URL}/unsubscribe" style="color: ${COLORS.textMuted}; text-decoration: underline; font-size: 13px;">Unsubscribe</a>
    <span style="color: ${COLORS.textMuted}; margin: 0 8px;">·</span>
  ` : ''

  const footerExtraHtml = footerText ? `
    <p style="margin: 0 0 16px 0; color: ${COLORS.textSecondary}; font-size: 14px;">${escapeHtml(footerText)}</p>
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
  <style type="text/css">
    /* Outlook-specific table fixes */
    table { border-collapse: collapse; }
    td { font-family: 'Segoe UI', Arial, sans-serif; }
  </style>
  <![endif]-->
  <style type="text/css">
    /* Reset - these work across most clients */
    body, table, td, p, a, li, blockquote { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; border-collapse: collapse; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; }

    /* Dark mode - Apple Mail, iOS Mail, Outlook.com (not Windows Outlook) */
    @media (prefers-color-scheme: dark) {
      .email-bg { background-color: #1D1D1F !important; }
      .email-container { background-color: #2C2C2E !important; }
      .email-header { background-color: #2C2C2E !important; border-color: #3A3A3C !important; }
      .text-primary { color: #F5F5F7 !important; }
      .text-secondary { color: #A1A1A6 !important; }
      .card-bg { background-color: #3A3A3C !important; }
    }

    /* Mobile - works in iOS Mail, Apple Mail, some Android */
    @media screen and (max-width: 600px) {
      .mobile-padding { padding: 24px 20px !important; }
      .mobile-full-width { width: 100% !important; }
      .mobile-headline { font-size: 24px !important; }
    }
  </style>
</head>
<body class="email-bg" style="margin: 0; padding: 0; background-color: ${COLORS.bg}; font-family: ${FONT_STACK};">
  ${preheaderHtml}

  <!-- Email wrapper -->
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" class="email-bg" style="background-color: ${COLORS.bg};">
    <tr>
      <td align="center" style="padding: 40px 20px;">

        <!--[if mso]>
        <table role="presentation" cellpadding="0" cellspacing="0" width="520" align="center" style="border-collapse: collapse;">
        <tr><td style="background-color: ${COLORS.white};">
        <![endif]-->

        <!-- Email container - border-radius gracefully ignored in Outlook -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" class="email-container" style="max-width: 520px; background-color: ${COLORS.white}; border-radius: 16px;">

          <!-- Header - Light with thin border -->
          <tr>
            <td class="email-header" style="padding: 28px 32px; border-bottom: 1px solid ${COLORS.borderLight};">
              <a href="${env.APP_URL}" style="text-decoration: none; display: inline-block;">
                <img
                  src="${escapeHtml(getEmailLogoSrc())}"
                  alt="${BRAND_NAME}"
                  width="80"
                  height="27"
                  style="display: block; border: 0; width: 80px; height: 27px;"
                >
              </a>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td class="mobile-padding" style="padding: 40px 40px 48px 40px;">

              <!-- Status Badge -->
              ${badgeHtml}

              <!-- Headline -->
              <h1 class="text-primary mobile-headline" style="margin: 0 0 20px 0; font-size: 28px; font-weight: 600; color: ${COLORS.textPrimary}; line-height: 1.2; letter-spacing: -0.3px; font-family: ${FONT_STACK};">
                ${headline}
              </h1>

              <!-- Body Content -->
              <div class="text-secondary" style="font-size: 16px; color: ${COLORS.textSecondary}; line-height: 1.65; font-family: ${FONT_STACK};">
                ${body}
              </div>

              <!-- CTA Buttons -->
              ${ctaHtml}
              ${ctaSecondaryHtml}

            </td>
          </tr>

          <!-- Footer - Minimal -->
          <tr>
            <td style="padding: 24px 40px 32px 40px; border-top: 1px solid ${COLORS.borderLight};">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="font-family: ${FONT_STACK};">
                    ${footerExtraHtml}
                    <p style="margin: 0; font-size: 13px; color: ${COLORS.textMuted}; line-height: 1.6;">
                      ${unsubscribeHtml}
                      <a href="${env.APP_URL}/help" style="color: ${COLORS.textMuted}; text-decoration: none;">Help</a>
                      <span style="margin: 0 8px;">·</span>
                      <a href="${env.APP_URL}/privacy" style="color: ${COLORS.textMuted}; text-decoration: none;">Privacy</a>
                      <span style="margin: 0 8px;">·</span>
                      <a href="${env.APP_URL}/terms" style="color: ${COLORS.textMuted}; text-decoration: none;">Terms</a>
                    </p>
                    <p style="margin: 12px 0 0 0; font-size: 12px; color: ${COLORS.textMuted};">
                      © ${currentYear} ${BRAND_NAME}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- End email container -->

        <!--[if mso]>
        </td></tr></table>
        <![endif]-->

      </td>
    </tr>
  </table>
  <!-- End email wrapper -->

</body>
</html>
  `.trim()
}

// ============================================
// REUSABLE COMPONENTS - Premium Design
// ============================================

/**
 * Amount Card - Hero display for money amounts
 * Clean, centered, with subtle background
 */
export function amountCard(label: string, amount: string, color: string = COLORS.textPrimary): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 28px 0;">
      <tr>
        <td class="card-bg" style="background-color: ${COLORS.bgSubtle}; border-radius: 16px; padding: 28px 24px; text-align: center;">
          <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 500; color: ${COLORS.textTertiary}; text-transform: uppercase; letter-spacing: 0.5px; font-family: ${FONT_STACK};">
            ${escapeHtml(label)}
          </p>
          <p style="margin: 0; font-size: 36px; font-weight: 700; color: ${color}; letter-spacing: -1px; font-family: ${FONT_STACK};">
            ${escapeHtml(amount)}
          </p>
        </td>
      </tr>
    </table>
  `
}

/**
 * Receipt Card - Transaction details in receipt style
 */
export function receiptCard(rows: Array<{ label: string; value: string; highlight?: boolean }>): string {
  const rowsHtml = rows.map((row, index) => {
    const isLast = index === rows.length - 1
    const borderStyle = isLast ? '' : `border-bottom: 1px solid ${COLORS.borderLight};`
    const fontWeight = row.highlight ? '600' : '400'
    const valueColor = row.highlight ? COLORS.textPrimary : COLORS.textSecondary

    return `
      <tr>
        <td style="padding: 14px 0; ${borderStyle}">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="font-size: 14px; color: ${COLORS.textTertiary}; font-family: ${FONT_STACK};">
                ${escapeHtml(row.label)}
              </td>
              <td align="right" style="font-size: 14px; font-weight: ${fontWeight}; color: ${valueColor}; font-family: ${FONT_STACK};">
                ${escapeHtml(row.value)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `
  }).join('')

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" class="card-bg" style="margin: 24px 0; background-color: ${COLORS.bgSubtle}; border-radius: 16px; overflow: hidden;">
      <tr>
        <td style="padding: 8px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            ${rowsHtml}
          </table>
        </td>
      </tr>
    </table>
  `
}

/**
 * Date Chip - Highlighted date display for reminders
 */
export function dateChip(date: string, label?: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
      <tr>
        <td style="background-color: ${COLORS.bgSubtle}; border: 1px solid ${COLORS.border}; border-radius: 12px; padding: 16px 24px; text-align: center;">
          ${label ? `<p style="margin: 0 0 4px 0; font-size: 12px; font-weight: 500; color: ${COLORS.textTertiary}; text-transform: uppercase; letter-spacing: 0.5px; font-family: ${FONT_STACK};">${escapeHtml(label)}</p>` : ''}
          <p style="margin: 0; font-size: 18px; font-weight: 600; color: ${COLORS.textPrimary}; font-family: ${FONT_STACK};">
            ${escapeHtml(date)}
          </p>
        </td>
      </tr>
    </table>
  `
}

/**
 * Countdown Chip - "In X days" urgency indicator
 */
export function countdownChip(days: number, urgent: boolean = false): string {
  const bgColor = urgent ? COLORS.warningBg : COLORS.bgSubtle
  const textColor = urgent ? COLORS.warningText : COLORS.textSecondary
  const borderColor = urgent ? COLORS.warning : COLORS.border
  const text = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 0 20px 0;">
      <tr>
        <td style="background-color: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 100px; padding: 8px 16px;">
          <span style="font-size: 13px; font-weight: 600; color: ${textColor}; font-family: ${FONT_STACK};">
            ${text}
          </span>
        </td>
      </tr>
    </table>
  `
}

/**
 * Identity Block - Creator/subscriber avatar + name
 * Uses table-based centering for Outlook compatibility (no flexbox)
 */
export function identityBlock(name: string, label?: string, avatarUrl?: string): string {
  // Avatar: image or initial in colored circle (table-based for Outlook)
  const avatarHtml = avatarUrl
    ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)}" width="44" height="44" style="display: block; border-radius: 22px; width: 44px; height: 44px;">`
    : `<table role="presentation" cellpadding="0" cellspacing="0" width="44" height="44" style="border-radius: 22px; background-color: ${COLORS.brand};">
         <tr>
           <td align="center" valign="middle" style="width: 44px; height: 44px; border-radius: 22px; background-color: ${COLORS.brand};">
             <span style="font-size: 18px; font-weight: 600; color: #ffffff; font-family: ${FONT_STACK};">${escapeHtml(name.charAt(0).toUpperCase())}</span>
           </td>
         </tr>
       </table>`

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
      <tr>
        <td style="vertical-align: middle; padding-right: 14px; width: 44px;">
          ${avatarHtml}
        </td>
        <td style="vertical-align: middle;">
          <p style="margin: 0; font-size: 16px; font-weight: 600; color: ${COLORS.textPrimary}; font-family: ${FONT_STACK};">
            ${escapeHtml(name)}
          </p>
          ${label ? `<p style="margin: 4px 0 0 0; font-size: 13px; color: ${COLORS.textTertiary}; font-family: ${FONT_STACK};">${escapeHtml(label)}</p>` : ''}
        </td>
      </tr>
    </table>
  `
}

/**
 * Quote Card - Styled message/description block
 */
export function quoteCard(message: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0;">
      <tr>
        <td style="background-color: ${COLORS.bgSubtle}; border-left: 3px solid ${COLORS.brand}; border-radius: 0 12px 12px 0; padding: 20px 24px;">
          <p style="margin: 0; font-size: 15px; color: ${COLORS.textSecondary}; line-height: 1.6; font-style: italic; font-family: ${FONT_STACK};">
            "${escapeHtml(message)}"
          </p>
        </td>
      </tr>
    </table>
  `
}

/**
 * Checklist - Action items with checkmarks
 * Uses HTML entity &#10003; for cross-client checkmark compatibility
 */
export function checklist(items: string[]): string {
  const itemsHtml = items.map(item => `
    <tr>
      <td style="padding: 8px 0; vertical-align: top; width: 24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="20" height="20">
          <tr>
            <td align="center" valign="middle" style="width: 20px; height: 20px; background-color: ${COLORS.successBg}; border-radius: 10px; font-size: 12px; color: ${COLORS.success}; font-family: ${FONT_STACK};">&#10003;</td>
          </tr>
        </table>
      </td>
      <td style="padding: 8px 0 8px 8px; vertical-align: middle;">
        <span style="font-size: 15px; color: ${COLORS.textSecondary}; font-family: ${FONT_STACK};">${escapeHtml(item)}</span>
      </td>
    </tr>
  `).join('')

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
      ${itemsHtml}
    </table>
  `
}

/**
 * Steps List - Numbered action steps
 */
export function stepsList(steps: string[]): string {
  const stepsHtml = steps.map((step, index) => `
    <tr>
      <td style="padding: 10px 0; vertical-align: top; width: 32px;">
        <span style="display: inline-block; width: 24px; height: 24px; background-color: ${COLORS.bgSubtle}; border-radius: 50%; text-align: center; line-height: 24px; font-size: 13px; font-weight: 600; color: ${COLORS.textSecondary}; font-family: ${FONT_STACK};">${index + 1}</span>
      </td>
      <td style="padding: 10px 0; vertical-align: middle;">
        <span style="font-size: 15px; color: ${COLORS.textSecondary}; font-family: ${FONT_STACK};">${escapeHtml(step)}</span>
      </td>
    </tr>
  `).join('')

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
      ${stepsHtml}
    </table>
  `
}

/**
 * Info Row - Simple label: value pair
 */
export function infoRow(label: string, value: string): string {
  return `
    <p style="margin: 0 0 10px 0; font-size: 15px; font-family: ${FONT_STACK};">
      <span style="color: ${COLORS.textTertiary};">${escapeHtml(label)}:</span>
      <strong style="color: ${COLORS.textPrimary}; font-weight: 500;">${escapeHtml(value)}</strong>
    </p>
  `
}

/**
 * Alert Box - Contextual messages (warning, info, success)
 */
export function alertBox(message: string, type: 'warning' | 'info' | 'success' | 'error' = 'warning'): string {
  const styles = {
    warning: { bg: COLORS.warningBg, border: COLORS.warning, text: COLORS.warningText },
    info: { bg: COLORS.infoBg, border: COLORS.info, text: COLORS.infoText },
    success: { bg: COLORS.successBg, border: COLORS.success, text: COLORS.successText },
    error: { bg: COLORS.errorBg, border: COLORS.error, text: COLORS.errorText },
  }
  const s = styles[type]

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0;">
      <tr>
        <td style="background-color: ${s.bg}; border-left: 3px solid ${s.border}; border-radius: 0 12px 12px 0; padding: 16px 20px;">
          <p style="margin: 0; font-size: 14px; color: ${s.text}; line-height: 1.5; font-family: ${FONT_STACK};">${message}</p>
        </td>
      </tr>
    </table>
  `
}

/**
 * Divider - Subtle horizontal line
 */
export function divider(): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 28px 0;">
      <tr>
        <td style="border-top: 1px solid ${COLORS.borderLight};"></td>
      </tr>
    </table>
  `
}

/**
 * Text Link - Inline link with brand color
 */
export function textLink(text: string, url: string): string {
  return `<a href="${escapeHtml(url)}" style="color: ${COLORS.brand}; text-decoration: none; font-weight: 500;">${escapeHtml(text)}</a>`
}

/**
 * Muted Text - Secondary/helper text
 */
export function mutedText(text: string): string {
  return `<p style="margin: 16px 0 0 0; font-size: 14px; color: ${COLORS.textTertiary}; font-family: ${FONT_STACK};">${escapeHtml(text)}</p>`
}

/**
 * OTP Code Display - Large, spaced monospace code
 */
export function otpCode(code: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 28px 0;">
      <tr>
        <td style="background-color: ${COLORS.bgSubtle}; border-radius: 16px; padding: 28px 24px; text-align: center;">
          <p style="margin: 0; font-size: 40px; font-weight: 600; color: ${COLORS.textPrimary}; letter-spacing: 8px; font-family: ${FONT_STACK_MONO};">
            ${escapeHtml(code)}
          </p>
        </td>
      </tr>
    </table>
  `
}
