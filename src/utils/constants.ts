// Reserved routes - these cannot be used as usernames
// Includes all app routes and common reserved words

export const RESERVED_ROUTES = [
  // App routes (MUST match all top-level routes in App.tsx)
  'onboarding',
  'dashboard',
  'activity',
  'subscribers',
  'profile',
  'requests',
  'request',
  'settings',
  'edit-page',
  'templates',
  'updates',
  'subscribe',
  'new-request',
  'api',
  'auth',
  'login',
  'logout',
  'signup',
  'register',
  'payroll',           // /payroll routes
  'my-subscriptions',  // subscriber-facing subscription list
  'unsubscribe',       // email unsubscribe
  'verify',            // payroll verification /verify/:id
  'r',                 // public request pages /r/:token
  'scan',              // previously used, reserved to prevent username collision
  'mocks',             // screenshot/marketing mock routes

  // System/reserved words
  'admin',
  'administrator',
  'support',
  'help',
  'contact',
  'about',
  'terms',
  'privacy',
  'legal',
  'blog',
  'news',
  'press',
  'careers',
  'jobs',
  'team',
  'pricing',
  'features',
  'docs',
  'documentation',
  'developer',
  'developers',
  'app',
  'apps',
  'download',
  'mobile',
  'ios',
  'android',
  'web',
  'www',
  'mail',
  'email',
  'ftp',
  'cdn',
  'assets',
  'static',
  'media',
  'images',
  'img',
  'files',
  'uploads',

  // Brand protection
  'nate',
  'natepay',
  'official',
  'verified',
  'staff',
  'moderator',
  'mod',

  // Common reserved
  'root',
  'null',
  'undefined',
  'anonymous',
  'guest',
  'user',
  'users',
  'account',
  'accounts',
  'billing',
  'payments',
  'checkout',
  'webhooks',
  'webhook',
  'callback',
  'oauth',
  'sso',

  // Potential future routes
  'explore',
  'discover',
  'search',
  'trending',
  'popular',
  'new',
  'create',
  'edit',
  'delete',
  'manage',
  'inbox',
  'messages',
  'notifications',
  'feed',
  'home',
] as const

export type ReservedRoute = typeof RESERVED_ROUTES[number]

// Check if a username is reserved
export function isReservedUsername(username: string): boolean {
  return RESERVED_ROUTES.includes(username.toLowerCase() as ReservedRoute)
}

// ============================================
// DOMAIN CONFIGURATION
// ============================================

function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, '')
}

function normalizePublicDomain(raw: string | undefined): string {
  const fallback = 'natepay.co'
  if (!raw) return fallback

  const cleaned = stripWhitespace(raw.trim())
  if (!cleaned) return fallback

  // Remove one or more leading schemes (handles accidental "https://https://")
  const withoutScheme = cleaned.replace(/^(https?:\/\/)+/i, '')
  // Keep only the host[:port] segment (drop any path/query fragments)
  const host = withoutScheme.split('/')[0]
  return host || fallback
}

function normalizePublicPageUrl(raw: string | undefined, domain: string): string {
  if (!raw) return `https://${domain}`

  const cleaned = stripWhitespace(raw.trim())
  if (!cleaned) return `https://${domain}`

  const withoutScheme = cleaned.replace(/^(https?:\/\/)+/i, '')
  const isLocalhost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(withoutScheme)
  const scheme = isLocalhost ? 'http://' : 'https://'

  try {
    return new URL(`${scheme}${withoutScheme}`).origin
  } catch {
    return `https://${domain}`
  }
}

function normalizeUsernameSegment(username: string): string {
  const trimmed = username.trim().replace(/^@+/, '')
  // Usernames are expected to be [a-z0-9_], but be defensive in share links.
  const cleaned = stripWhitespace(trimmed).replace(/\//g, '').toLowerCase()
  return cleaned
}

// Primary domain for public pages (creator URLs). Must be host[:port] only (no protocol).
export const PUBLIC_DOMAIN = normalizePublicDomain(import.meta.env.VITE_PUBLIC_PAGE_DOMAIN)

// Full URL for public pages (with protocol). Must be origin only (no trailing path).
export const PUBLIC_PAGE_URL = normalizePublicPageUrl(import.meta.env.VITE_PUBLIC_PAGE_URL, PUBLIC_DOMAIN)

// Get full URL to a creator's public page
export function getPublicPageUrl(username: string): string {
  return `${PUBLIC_PAGE_URL}/${normalizeUsernameSegment(username)}`
}

// Get shareable link (short format for display, without https://)
export function getShareableLink(username: string): string {
  return `${PUBLIC_DOMAIN}/${normalizeUsernameSegment(username)}`
}

// Get shareable link with protocol
export function getShareableLinkFull(username: string): string {
  return `${PUBLIC_PAGE_URL}/${normalizeUsernameSegment(username)}`
}

// Legal page URLs - use full URLs for compatibility with native HashRouter
// These open in new tabs, so we use the public domain to avoid routing issues
export const TERMS_URL = `${PUBLIC_PAGE_URL}/terms`
export const PRIVACY_URL = `${PUBLIC_PAGE_URL}/privacy`

// ============================================
// CROSS-BORDER / ONBOARDING CONFIGURATION
// ============================================

// Re-export from regionConfig for backwards compatibility
// regionConfig.ts is now the SINGLE SOURCE OF TRUTH for country/currency/provider rules
import {
  getCrossBorderCountryCodes,
  shouldSkipAddress,
  isCrossBorderCountry,
} from './regionConfig'

// Countries where we skip the address step in onboarding
// These are cross-border recipients with simpler Stripe verification
// NOTE: This now derives from regionConfig.ts - update there to add countries
export const SKIP_ADDRESS_COUNTRIES = getCrossBorderCountryCodes() as readonly string[]

// Check if a country skips the address step
export function shouldSkipAddressStep(countryCode: string | null | undefined): boolean {
  return shouldSkipAddress(countryCode)
}

// Calculate the review step index based on country and purpose (for dynamic onboarding flow)
// Flow: Start → Email → OTP → Identity → [Address] → Purpose → Avatar → Username → Payment → [ServiceDesc → AIGen] → Review
//
// Step counts:
// - No address, non-service: 9 steps (0-8), review at step 8
// - With address, non-service: 10 steps (0-9), review at step 9
// - No address, service: 11 steps (0-10), review at step 10
// - With address, service: 12 steps (0-11), review at step 11
export function getReviewStepIndex(
  countryCode: string | null | undefined,
  purpose?: string | null
): number {
  // Base: 8 steps without address (review at index 8)
  // Add 1 if address step is shown
  // Add 2 if service mode (ServiceDesc + AIGen steps)
  const hasAddressStep = !shouldSkipAddress(countryCode)
  const isServiceMode = purpose === 'service'

  let reviewIndex = 8 // Base: review at step 8 (9 steps)
  if (hasAddressStep) reviewIndex += 1
  if (isServiceMode) reviewIndex += 2

  return reviewIndex
}

// Calculate total onboarding step count based on country and purpose
export function getOnboardingStepCount(
  countryCode: string | null | undefined,
  purpose?: string | null
): number {
  return getReviewStepIndex(countryCode, purpose) + 1
}

// Re-export isCrossBorderCountry for convenience
export { isCrossBorderCountry }
