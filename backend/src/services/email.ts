import { Resend } from 'resend'
import { env } from '../config/env.js'
import { centsToDisplayAmount, isZeroDecimalCurrency } from '../utils/currency.js'

const resend = new Resend(env.RESEND_API_KEY)

// ============================================
// EMAIL CONFIGURATION
// ============================================

const MAX_RETRIES = 3
const RETRY_DELAYS_MS = [1000, 3000, 5000] // 1s, 3s, 5s

// Logo configuration - embedded base64 SVG for guaranteed rendering
// This ensures the logo ALWAYS displays, even if images are blocked
const BRAND_NAME = 'Nate'
const BRAND_COLOR = '#FF941A'
const BRAND_COLOR_DARK = '#E8850F'

// Base64-encoded SVG logo (dark text version for email white backgrounds)
// This is the Nate logo with #1a1a1a text and orange/yellow gradient accent
const LOGO_BASE64 = 'PHN2ZyB3aWR0aD0iODUiIGhlaWdodD0iMjkiIHZpZXdCb3g9IjAgMCA4NSAyOSIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTgwLjEwMDQgMTUuNTUzNUM4MC4xMDA0IDE2LjA3MzkgNzkuOTk0NCAxNi40NDk3IDc5Ljc4MjQgMTYuNjgxQzc5LjU3MDQgMTYuODkzIDc5LjE4NDkgMTYuOTk5IDc4LjYyNiAxNi45OTlINjkuNjYzOUM2OS44NzU5IDE3LjczMTQgNzAuMzQ4MSAxOC4zMzg1IDcxLjA4MDUgMTguODIwM0M3MS44MTI5IDE5LjI4MjkgNzIuNzY2OSAxOS41MTQyIDczLjk0MjYgMTkuNTE0MkM3NC45ODMzIDE5LjUxNDIgNzUuOTQ3IDE5LjM4ODkgNzYuODMzNiAxOS4xMzgzQzc3LjcyMDEgMTguODg3OCA3OC4xNzMxIDE4Ljc2MjUgNzguMTkyMyAxOC43NjI1Qzc4LjcxMjcgMTguNzYyNSA3OC45NzI5IDE5LjA0MiA3OC45NzI5IDE5LjYwMDlWMjEuMjc3N0M3OC45NzI5IDIxLjkxMzcgNzguNzcwNSAyMi4zNTY5IDc4LjM2NTggMjIuNjA3NUM3Ny4zNDQzIDIzLjI0MzUgNzUuNzE1NyAyMy41NjE1IDczLjQ4IDIzLjU2MTVDNzEuMDcwOSAyMy41NjE1IDY5LjA2NjUgMjIuODQ4NCA2Ny40NjY4IDIxLjQyMjJDNjUuODg2NCAxOS45OTYgNjUuMDk2MiAxOC4wNTkgNjUuMDk2MiAxNS42MTEzQzY1LjA5NjIgMTMuMzk0OSA2NS44MDkzIDExLjUxNTggNjcuMjM1NSA5Ljk3MzkyQzY4LjY4MSA4LjQzMjA2IDcwLjQ4MzEgNy42NjExMyA3Mi42NDE3IDcuNjYxMTNDNzUuMDMxNSA3LjY2MTEzIDc2Ljg3MjEgOC4zNzQyNCA3OC4xNjM0IDkuODAwNDZDNzkuNDU0NyAxMS4yMDc0IDgwLjEwMDQgMTMuMTI1MSA4MC4xMDA0IDE1LjU1MzVaTTcyLjY5OTUgMTEuNTM1QzcxLjg1MTUgMTEuNTM1IDcxLjE1NzYgMTEuNzY2MyA3MC42MTggMTIuMjI4OUM3MC4wOTc2IDEyLjY3MjIgNjkuNzY5OSAxMy4yNjk2IDY5LjYzNSAxNC4wMjEzSDc1LjYxOTRDNzUuNTIzIDEzLjI2OTYgNzUuMjI0MyAxMi42NzIyIDc0LjcyMzIgMTIuMjI4OUM3NC4yNDEzIDExLjc2NjMgNzMuNTY2OCAxMS41MzUgNzIuNjk5NSAxMS41MzVaIiBmaWxsPSIjMWExYTFhIi8+CjxwYXRoIGQ9Ik02My45NjEgMTguOTA3NEM2NC40MjM1IDE4LjkwNzQgNjQuNjU0OCAxOS4xNzczIDY0LjY1NDggMTkuNzE2OVYyMS40MjI2QzY0LjY1NDggMjEuODg1MSA2NC41ODczIDIyLjIyMjQgNjQuNDUyNCAyMi40MzQ0QzY0LjMzNjggMjIuNjQ2NCA2NC4wNTczIDIyLjgzOTIgNjMuNjE0IDIzLjAxMjZDNjIuOTM5NSAyMy4yODI1IDYyLjA1MjkgMjMuNDE3NCA2MC45NTQzIDIzLjQxNzRDNTcuMTM4MiAyMy40MTc0IDU1LjIzMDIgMjEuMzQ1NSA1NS4yMzAyIDE3LjIwMThWMTIuMjI5M0g1NC4wMTZDNTMuNDc2MyAxMi4yMjkzIDUzLjA4MTIgMTIuMTEzNiA1Mi44MzA3IDExLjg4MjRDNTIuNTk5NCAxMS42NTExIDUyLjQ4MzggMTEuMjU2IDUyLjQ4MzggMTAuNjk3MVY5Ljc3MTk0QzUyLjQ4MzggOS4yMTMwMiA1Mi41OTk0IDguODE3OTIgNTIuODMwNyA4LjU4NjY0QzUzLjA4MTIgOC4zNTUzNiA1My40NzYzIDguMjM5NzIgNTQuMDE2IDguMjM5NzJINTUuMjMwMlY2LjAxMzY3QzU1LjIzMDIgNS40NzQwMiA1NS4zNDU4IDUuMDg4NTUgNTUuNTc3MSA0Ljg1NzI3QzU1LjgwODQgNC42MDY3MiA1Ni4yMDM1IDQuNDgxNDUgNTYuNzYyNCA0LjQ4MTQ1SDU4LjMyMzVDNTguODgyNSA0LjQ4MTQ1IDU5LjI3NzYgNC42MDY3MiA1OS41MDg4IDQuODU3MjdDNTkuNzQwMSA1LjA4ODU1IDU5Ljg1NTggNS40NzQwMiA1OS44NTU4IDYuMDEzNjdWOC4yMzk3Mkg2Mi44MDQ2QzYzLjM0NDIgOC4yMzk3MiA2My43Mjk3IDguMzU1MzYgNjMuOTYxIDguNTg2NjRDNjQuMjExNSA4LjgxNzkyIDY0LjMzNjggOS4yMTMwMiA2NC4zMzY4IDkuNzcxOTRWMTAuNjk3MUM2NC4zMzY4IDExLjI1NiA2NC4yMTE1IDExLjY1MTEgNjMuOTYxIDExLjg4MjRDNjMuNzI5NyAxMi4xMTM2IDYzLjM0NDIgMTIuMjI5MyA2Mi44MDQ2IDEyLjIyOTNINTkuODU1OFYxNi42NTI1QzU5Ljg1NTggMTcuNTk2OSA2MC4wMTk2IDE4LjI2MTggNjAuMzQ3MiAxOC42NDcyQzYwLjY5NDIgMTkuMDEzNCA2MS4yNTMxIDE5LjE5NjUgNjIuMDI0IDE5LjE5NjVDNjIuNDA5NSAxOS4xOTY1IDYyLjc5NDkgMTkuMTQ4NCA2My4xODA0IDE5LjA1MkM2My41ODUxIDE4Ljk1NTYgNjMuODQ1MyAxOC45MDc0IDYzLjk2MSAxOC45MDc0WiIgZmlsbD0iIzFhMWExYSIvPgo8cGF0aCBkPSJNNTAuMzEzOCA3Ljk1MDIzQzUwLjkxMTMgNy45NTAyMyA1MS4yMSA4LjI5NzE1IDUxLjIxIDguOTkwOThWMjIuMjMxN0M1MS4yMSAyMi45MjU1IDUwLjkxMTMgMjMuMjcyNCA1MC4zMTM4IDIzLjI3MjRDNDkuOTA5MSAyMy4yNzI0IDQ5LjQ1NjIgMjMuMTA4NiA0OC45NTUgMjIuNzgxQzQ4LjQ1MzkgMjIuNDM0IDQ4LjAxMDcgMjEuOTcxNSA0Ny42MjUyIDIxLjM5MzNDNDcuMTA0OCAyMi4wMSA0Ni4zNzI0IDIyLjUzMDQgNDUuNDI4MSAyMi45NTQ0QzQ0LjQ4MzcgMjMuMzU5MiA0My40NjIyIDIzLjU2MTUgNDIuMzYzNiAyMy41NjE1QzQwLjEwODYgMjMuNTYxNSAzOC4yNjgxIDIyLjgxOTUgMzYuODQxOCAyMS4zMzU1QzM1LjQxNTYgMTkuODMyMiAzNC43MDI1IDE3LjkyNDEgMzQuNzAyNSAxNS42MTEzQzM0LjcwMjUgMTMuMzM3MSAzNS40MTU2IDExLjQ0ODMgMzYuODQxOCA5Ljk0NTAxQzM4LjI4NzMgOC40MjI0MiA0MC4xMjc5IDcuNjYxMTMgNDIuMzYzNiA3LjY2MTEzQzQzLjQ2MjIgNy42NjExMyA0NC40ODM3IDcuODczMTQgNDUuNDI4MSA4LjI5NzE1QzQ2LjM3MjQgOC43MDE4OSA0Ny4xMDQ4IDkuMjEyNjMgNDcuNjI1MiA5LjgyOTM3QzQ4LjAxMDcgOS4yNTExNyA0OC40NTM5IDguNzk4MjUgNDguOTU1IDguNDcwNjFDNDkuNDU2MiA4LjEyMzY5IDQ5LjkwOTEgNy45NTAyMyA1MC4zMTM4IDcuOTUwMjNaTTQwLjQyNjcgMTguMzU3OEM0MS4xMjA1IDE5LjA1MTYgNDEuOTc4MSAxOS4zOTg1IDQyLjk5OTYgMTkuMzk4NUM0NC4wMjExIDE5LjM5ODUgNDQuODY5MSAxOS4wNTE2IDQ1LjU0MzcgMTguMzU3OEM0Ni4yMzc1IDE3LjY0NDcgNDYuNTg0NCAxNi43MjkyIDQ2LjU4NDQgMTUuNjExM0M0Ni41ODQ0IDE0LjQ5MzUgNDYuMjM3NSAxMy41ODc2IDQ1LjU0MzcgMTIuODkzOEM0NC44NjkxIDEyLjE4MDcgNDQuMDIxMSAxMS44MjQxIDQyLjk5OTYgMTEuODI0MUM0MS45NzgxIDExLjgyNDEgNDEuMTIwNSAxMi4xODA3IDQwLjQyNjcgMTIuODkzOEMzOS43MzI4IDEzLjU4NzYgMzkuMzg1OSAxNC40OTM1IDM5LjM4NTkgMTUuNjExM0MzOS4zODU5IDE2LjcyOTIgMzkuNzMyOCAxNy42NDQ3IDQwLjQyNjcgMTguMzU3OFoiIGZpbGw9IiMxYTFhMWEiLz4KPHBhdGggZD0iTTMxLjQ4NDYgOS44MDA0NkMzMi42NjAzIDExLjE2ODkgMzMuMjQ4MSAxMy4yMDIyIDMzLjI0ODEgMTUuOTAwNFYyMS40NTExQzMzLjI0ODEgMjIuMDEgMzMuMTIyOSAyMi40MDUxIDMyLjg3MjMgMjIuNjM2NEMzMi42NDEgMjIuODY3NyAzMi4yNTU2IDIyLjk4MzMgMzEuNzE1OSAyMi45ODMzSDMwLjE1NDhDMjkuNjE1MSAyMi45ODMzIDI5LjIyIDIyLjg2NzcgMjguOTY5NSAyMi42MzY0QzI4LjczODIgMjIuNDA1MSAyOC42MjI2IDIyLjAxIDI4LjYyMjYgMjEuNDUxMVYxNi4wNDVDMjguNjIyNiAxNC42NzY2IDI4LjM4MTcgMTMuNjg0IDI3Ljg5OTggMTMuMDY3M0MyNy4zNzk0IDEyLjM5MjcgMjYuNTk4OSAxMi4wNTU0IDI1LjU1ODEgMTIuMDU1NEMyNC41MTc0IDEyLjA1NTQgMjMuNzA3OSAxMi4zOTI3IDIzLjEyOTcgMTMuMDY3M0MyMi41NTE1IDEzLjc0MTggMjIuMjYyNCAxNC43MjQ4IDIyLjI2MjQgMTYuMDE2MVYyMS40NTExQzIyLjI2MjQgMjEuOTkwOCAyMi4xNDY4IDIyLjM4NTkgMjEuOTE1NSAyMi42MzY0QzIxLjY4NDIgMjIuODY3NyAyMS4yODkxIDIyLjk4MzMgMjAuNzMwMiAyMi45ODMzSDE5LjE2OTFDMTguNjEwMSAyMi45ODMzIDE4LjIxNSAyMi44Njc3IDE3Ljk4MzggMjIuNjM2NEMxNy43NTI1IDIyLjM4NTkgMTcuNjM2OCAyMS45OTA4IDE3LjYzNjggMjEuNDUxMVY4Ljk5MDk4QzE3LjYzNjggOC4yOTcxNSAxNy45MzU2IDcuOTUwMjMgMTguNTMzIDcuOTUwMjNDMTguOTU3MSA3Ljk1MDIzIDE5LjQxOTYgOC4xMjM2OSAxOS45MjA3IDguNDcwNjFDMjAuNDIxOCA4Ljc5ODI1IDIwLjg2NTEgOS4yNzA0NCAyMS4yNTA2IDkuODg3MTlDMjEuODQ4IDkuMTc0MDggMjIuNTkwMSA4LjYyNDc5IDIzLjQ3NjYgOC4yMzkzM0MyNC4zODI1IDcuODUzODYgMjUuMzA3NiA3LjY2MTEzIDI2LjI1MiA3LjY2MTEzQzI4LjQ4NzcgNy42NjExMyAzMC4yMzE5IDguMzc0MjQgMzEuNDg0NiA5LjgwMDQ2WiIgZmlsbD0iIzFhMWExYSIvPgo8cGF0aCBkPSJNNi41ODE1OSAxNS44MTQ1QzYuNTgxNTkgMTUuODE1NSA2LjU4MjA0IDE1LjgxNjUgNi41ODI4MiAxNS44MTcxQzguNjk2MDYgMTcuNjUyNCAxMC43MTI4IDE5LjQwMjQgMTIuNzY1MyAyMS4xODM3QzEzLjUzNjIgMjEuODUyNiAxMy4wNjMyIDIzLjExOTcgMTIuMDQyNSAyMy4xMTk3SDQuOTcxMzJDNC4zMDA0MiAyMy4xMTk3IDMuOTI3MTYgMjIuMjA3NiA0LjUwMDYzIDIxLjg1OTVDNi4yNTA3MSAyMC43OTU1IDYuOTQ4MTUgMTkuMjk4NCA2LjU5MTMyIDE3LjI4MDdDNi41MjE1OCAxNi44ODk4IDYuNTgxNTkgMTYuNDc3OCA2LjU4MTU5IDE1LjgxNDVaIiBmaWxsPSJ1cmwoI3BhaW50MF9saW5lYXJfZW1haWwpIi8+CjxwYXRoIGQ9Ik01LjIyODEgOS45MzU2MUM0LjQ1Nzc0IDkuMjY2NDUgNC45MzA5NSA4IDUuOTUxMzcgOEgxMi4wNzI2QzEzLjA5MzYgOCAxMy42MTU3IDkuMzI2NzggMTIuNzk4IDkuOTM4MTFDMTIuNzIzMSA5Ljk5NDA3IDEyLjY0NzYgMTAuMDQ4NyAxMi41NzExIDEwLjEwMkMxMS42NzI2IDEwLjcyOTcgMTEuMzQ4MiAxMS40ODg4IDExLjQ2MDEgMTIuNTYwOUMxMS40NzMzIDEyLjY4ODQgMTEuNDgyOSAxMi44MTYyIDExLjQ4OTcgMTIuOTQ1MUMxMS41Mzk3IDEzLjg4OTYgMTAuMzY1NiAxNC4zOTc2IDkuNjUxNTUgMTMuNzc3NUM4LjE2OTEzIDEyLjQ5IDYuNzExNDYgMTEuMjI0MSA1LjIyODEgOS45MzU2MVoiIGZpbGw9InVybCgjcGFpbnQxX2xpbmVhcl9lbWFpbCkiLz4KPGRlZnM+CjxsaW5lYXJHcmFkaWVudCBpZD0icGFpbnQwX2xpbmVhcl9lbWFpbCIgeDE9IjkuMDE2MTQiIHkxPSIxNS44MTQ1IiB4Mj0iOS4wMTYxNCIgeTI9IjIzLjExOTciIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iI0ZGRDIwOCIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNGRjk0MUEiLz4KPC9saW5lYXJHcmFkaWVudD4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDFfbGluZWFyX2VtYWlsIiB4MT0iOS4wMTQxOSIgeTE9IjgiIHgyPSI5LjAxNDE5IiB5Mj0iMTUuMzYzNyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSIjRkZEMjA4Ii8+CjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI0ZGOTQxQSIvPgo8L2xpbmVhckdyYWRpZW50Pgo8L2RlZnM+Cjwvc3ZnPgo='
const LOGO_DATA_URI = `data:image/svg+xml;base64,${LOGO_BASE64}`

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

          <!-- Logo Header - Embedded base64 SVG for guaranteed rendering -->
          <tr>
            <td align="center" style="padding: 32px 24px 24px 24px; border-bottom: 1px solid #f0f0f0;">
              <a href="${env.APP_URL}" style="text-decoration: none; display: inline-block;">
                <img src="${LOGO_DATA_URI}"
                     alt="${BRAND_NAME}"
                     width="85"
                     height="29"
                     style="display: block; border: 0; width: 85px; height: 29px;">
              </a>
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
  providerName: string,
  amount: number,
  currency: string,
  renewalDate: Date
): Promise<EmailResult> {
  const formattedAmount = formatAmountForEmail(amount, currency)
  const safeProviderName = escapeHtml(providerName)
  const formattedDate = renewalDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(`Subscription renewal reminder - ${providerName}`),
      html: baseTemplate({
        preheader: `Your subscription to ${providerName} renews on ${formattedDate}.`,
        headline: 'Your subscription renews soon',
        body: `
          <p style="margin: 0 0 16px 0;">
            Your subscription to <strong>${safeProviderName}</strong> will renew on <strong>${escapeHtml(formattedDate)}</strong> for <strong>${escapeHtml(formattedAmount)}</strong>.
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

  return sendWithRetry(() =>
    resend.emails.send({
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
        ctaUrl: `${env.APP_URL}/settings`,
        ctaColor: '#dc2626',
      }),
    })
  )
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

  return sendWithRetry(() =>
    resend.emails.send({
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
  senderName: string,
  title: string | null,
  body: string,
  options?: {
    photoUrl?: string | null
    creatorUsername?: string
  }
): Promise<EmailResult> {
  const safeSenderName = escapeHtml(senderName)
  const safeTitle = title ? escapeHtml(title) : null
  const safeBody = escapeHtml(body)

  const headlineText = safeTitle || `New update from ${safeSenderName}`

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

  return sendWithRetry(() =>
    resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: sanitizeEmailSubject(title || `New update from ${senderName}`),
      html: baseTemplate({
        preheader: body.substring(0, 100) + (body.length > 100 ? '...' : ''),
        headline: headlineText,
        body: `
          <p style="margin: 0 0 8px 0; font-size: 14px; color: #888888;">From ${safeSenderName}</p>
          ${photoHtml}
          <p style="margin: 0; white-space: pre-wrap; line-height: 1.6;">${safeBody}</p>
          ${viewOnlineHtml}
        `,
        showUnsubscribe: true,  // Updates are marketing emails - must have unsubscribe
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
