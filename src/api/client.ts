// API Client for Nate Backend

import { Capacitor } from '@capacitor/core'
import { createFetchClient, type FetchOptions } from './fetchJson'

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const AUTH_TOKEN_KEY = 'nate_auth_token'
const AUTH_SESSION_KEY = 'nate_has_session'

// Safe storage wrapper - handles Safari private mode, in-app browsers, etc.
function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage blocked - silently fail
  }
}

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Storage blocked - silently fail
  }
}

// Safe sessionStorage wrapper - handles Safari private mode, in-app browsers, etc.
export function safeSessionGetItem(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSessionSetItem(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // Storage blocked - silently fail
  }
}

export function safeSessionRemoveItem(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // Storage blocked - silently fail
  }
}

// Token storage utilities (works on web and Capacitor)
export function getAuthToken(): string | null {
  return safeGetItem(AUTH_TOKEN_KEY)
}

export function setAuthToken(token: string): void {
  safeSetItem(AUTH_TOKEN_KEY, token)
  // Store session flag in both localStorage and sessionStorage for Safari resilience
  safeSetItem(AUTH_SESSION_KEY, 'true')
  safeSessionSetItem(AUTH_SESSION_KEY, 'true')
}

export function clearAuthToken(): void {
  safeRemoveItem(AUTH_TOKEN_KEY)
  safeRemoveItem(AUTH_SESSION_KEY)
  safeSessionRemoveItem(AUTH_SESSION_KEY)
}

// Session flag for cookie-based auth (no token stored)
// Uses both localStorage AND sessionStorage for resilience
// Safari can clear localStorage on navigation, but sessionStorage is more stable
export function hasAuthSession(): boolean {
  // Check localStorage first, then fallback to sessionStorage
  // This handles Safari's aggressive localStorage clearing
  const localFlag = safeGetItem(AUTH_SESSION_KEY) === 'true'
  const sessionFlag = safeSessionGetItem(AUTH_SESSION_KEY) === 'true'
  return localFlag || sessionFlag
}

export function setAuthSession(): void {
  safeSetItem(AUTH_SESSION_KEY, 'true')
  // Also store in sessionStorage as Safari-resilient backup
  safeSessionSetItem(AUTH_SESSION_KEY, 'true')
}

export function clearAuthSession(): void {
  safeRemoveItem(AUTH_SESSION_KEY)
  safeSessionRemoveItem(AUTH_SESSION_KEY)
  // Also clear onboarding state to prevent data leaks between sessions
  safeRemoveItem('natepay-onboarding')
}

// Types
export interface ApiError {
  error: string
  status: number
}

export interface OnboardingState {
  hasProfile: boolean
  hasActivePayment: boolean
  step: number | null
  branch: 'personal' | 'service' | null
  data: Record<string, unknown> | null
  redirectTo: string
}

export interface User {
  id: string
  email: string
  profile: Profile | null
  createdAt: string
  onboarding?: OnboardingState
}

export interface Profile {
  id: string
  username: string
  displayName: string
  bio: string | null
  avatarUrl: string | null
  bannerUrl?: string | null  // AI-generated banner for service mode
  voiceIntroUrl: string | null
  phone?: string | null  // SMS notifications (E.164 format)
  country: string
  countryCode: string
  currency: string
  purpose: string
  displayMode?: 'retainer' | 'support'  // Render mode: 'retainer' for service, 'support' for others
  pricingModel: 'single' | 'tiers'
  singleAmount: number | null
  tiers: Tier[] | null
  perks: Perk[] | null
  impactItems: ImpactItem[] | null
  paymentProvider: string | null
  payoutStatus: 'pending' | 'active' | 'restricted'
  shareUrl: string | null
  template?: 'boundary' // Subscribe page template (only 'boundary' implemented)
  paymentsReady?: boolean // For public profiles - indicates if checkout will work
  feeMode?: 'absorb' | 'pass_to_subscriber' | 'split' // Fee model (split = 4%/4%)
  crossBorder?: boolean // True if Stripe cross-border account (payments in USD, payouts in local currency)
  notificationPrefs?: NotificationPrefs // Email/push notification preferences
  isPublic?: boolean // True if profile is visible to public (published)

  // Billing Address
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}

export interface Tier {
  id: string
  name: string
  amount: number
  perks: string[]
  isPopular?: boolean
}

export interface Perk {
  id: string
  title: string
  enabled: boolean
}

export interface ImpactItem {
  id: string
  title: string
  subtitle: string
}

// Viewer's subscription to a creator (returned from public profile endpoint)
export interface ViewerSubscription {
  isActive: boolean
  tierName: string | null
  amount: number
  currency: string
  since: string
  currentPeriodEnd: string | null
}

export interface Subscription {
  id: string
  subscriber: {
    id: string
    email: string
    displayName: string
    avatarUrl: string | null
  }
  tierName: string | null
  amount: number
  currency: string
  interval: string
  status: string
  startedAt: string
  currentPeriodEnd: string | null
  ltvCents: number
}

export interface Activity {
  id: string
  type: string
  payload: Record<string, unknown>
  createdAt: string
}

// Payout info enriched from Profile (real data from Stripe webhooks)
export interface PayoutInfoResponse {
  status: 'pending' | 'in_transit' | 'paid' | 'failed' | null
  amount: number | null
  date: string | null
  provider: string | null
}

// FX conversion data for cross-border payments
export interface FxDataResponse {
  originalCurrency: string      // e.g., "USD"
  originalAmountCents: number   // Amount in original currency
  payoutCurrency: string        // e.g., "NGN"
  payoutAmountCents: number     // Amount after FX conversion
  exchangeRate: number          // e.g., 1600.50
}

// Payout history item
export interface PayoutHistoryItem {
  id: string
  amount: number
  currency: string
  status: 'pending' | 'paid' | 'failed'
  initiatedAt: string
  arrivedAt: string | null
  failureReason?: string | null
}

// Account health summary
export interface AccountHealth {
  payoutStatus: 'pending' | 'active' | 'restricted' | 'disabled'
  provider: 'stripe' | 'paystack' | null
  hasStripeAccount: boolean
  lastPayout: {
    amount: number
    date: string
    status: string
  } | null
  currentBalance: {
    available: number
    pending: number
    currency: string
  }
}

export interface Metrics {
  subscriberCount: number
  mrrCents: number
  mrr: number
  totalRevenueCents: number
  totalRevenue: number
  currency: string
  tierBreakdown: Record<string, number>
  balance?: {
    available: number
    pending: number
    currency: string
    lastSyncedAt: string | null
  }
  // FX rate for currency toggle: 1 profileCurrency = fxRate balanceCurrency
  fxRate: number | null
}

export interface Request {
  id: string
  recipientName: string
  recipientEmail: string | null
  relationship: string
  amount: number
  currency: string
  isRecurring: boolean
  message: string | null
  voiceUrl: string | null
  dueDate: string | null
  status: string
  sendMethod: string | null
  sentAt: string | null
  respondedAt: string | null
  createdAt: string
}

export interface Update {
  id: string
  title: string | null
  body: string
  photoUrl: string | null
  audience: string
  status: string
  recipientCount: number
  viewCount: number
  sentAt: string | null
  createdAt: string
}

// Auth error event for global handling
export const AUTH_ERROR_EVENT = 'nate:auth_error'

function dispatchAuthError() {
  window.dispatchEvent(new CustomEvent(AUTH_ERROR_EVENT))
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

// Default timeout for API requests (8 seconds - reduced from 15s)
const API_TIMEOUT_MS = 8000

// Longer timeout for AI endpoints (30 seconds - AI generation can be slow)
const AI_TIMEOUT_MS = 30000

// Extra long timeout for banner generation (90 seconds - uses "Thinking" mode)
const BANNER_TIMEOUT_MS = 90000

// Public endpoints where 401 doesn't mean "session expired"
// These endpoints can be accessed without auth or may return 401 for unauthenticated users
const PUBLIC_ENDPOINTS = [
  '/users/',              // Public profile pages
  '/public/',             // Public API routes
  '/profile/check-username',  // Username availability check
  '/payroll/verify/',     // Pay statement verification (public)
  '/checkout/',           // Checkout flow (unauthenticated subscribers)
  '/requests/r/',         // Request recipient view/accept/decline
  '/analytics/',          // View tracking (public)
  '/config/',             // Public config endpoints
  '/geo',                 // Geo detection
  '/subscriber/',         // Public subscriber portal (separate auth via OTP)
]

// Create configured fetch client using shared layer
const fetchClient = createFetchClient({
  baseUrl: API_URL,
  defaultTimeout: API_TIMEOUT_MS,
  getAuthToken,
  onUnauthorized: (path) => {
    // Smart 401 handling: only clear auth for protected endpoints
    const isPublicEndpoint = PUBLIC_ENDPOINTS.some(ep => path.startsWith(ep))
    const hadAuth = !!getAuthToken() || hasAuthSession()

    if (!isPublicEndpoint && hadAuth) {
      clearAuthToken()
      clearAuthSession()
      dispatchAuthError()
    }
  },
})

// Base fetch wrapper - delegates to shared fetchClient
// Maintains ApiError type for backward compatibility
async function apiFetch<T>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
  try {
    return await fetchClient<T>(path, options)
  } catch (err: any) {
    // Re-throw as ApiError format for backward compatibility
    // Preserve additional fields like limitReached for specific error handling
    throw {
      error: err.message || err.error || 'Request failed',
      status: err.status ?? 0,
      ...err, // Preserve any additional fields (e.g., limitReached)
    } as ApiError
  }
}

// ============================================
// AUTH
// ============================================

export interface VerifyResponse {
  success: boolean
  token: string
  hasProfile: boolean
  hasActivePayment: boolean
  onboardingStep: number | null
  onboardingBranch: 'personal' | 'service' | null
  onboardingData: Record<string, any> | null
  redirectTo: string
}

export const auth = {
  requestMagicLink: (email: string) => {
    const normalizedEmail = normalizeEmail(email)
    return apiFetch<{ success: boolean; message: string }>('/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email: normalizedEmail }),
    })
  },

  verify: async (otp: string, email: string): Promise<VerifyResponse> => {
    // Ensure stale tokens don't interfere with verification flows.
    clearAuthToken()
    const normalizedEmail = normalizeEmail(email)

    // Send both OTP and email - prevents account takeover via OTP collision
    const result = await apiFetch<VerifyResponse>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ token: otp, email: normalizedEmail }),
    })

    // Prefer HttpOnly cookie sessions on web when possible.
    // Fall back to bearer token when cookies are unavailable (e.g., native apps or cross-site setups).
    const isNative = Capacitor.isNativePlatform()
    if (result.token) {
      if (isNative) {
        setAuthToken(result.token)
      } else {
        const cookieAuthOk = await fetch(`${API_URL}/auth/me`, { credentials: 'include' })
          .then(r => r.ok)
          .catch(() => false)

        if (cookieAuthOk) {
          // Cookie auth works - set session flag but not token
          setAuthSession()
        } else {
          // Fall back to token auth
          setAuthToken(result.token)
        }
      }
    }

    return result
  },

  logout: async () => {
    const result = await apiFetch<{ success: boolean }>('/auth/logout', { method: 'POST' })
    // Clear stored token and session
    clearAuthToken()
    clearAuthSession()
    return result
  },

  me: () => apiFetch<User>('/auth/me'),

  // Save onboarding progress to server
  saveOnboardingProgress: (data: {
    step: number
    stepKey?: string // Canonical step identifier for safe resume
    branch?: 'personal' | 'service'
    data?: Record<string, any>
  }) =>
    apiFetch<{ success: boolean }>('/auth/onboarding', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // Reset onboarding progress (user clicked "Start over")
  resetOnboardingProgress: () =>
    apiFetch<{ success: boolean }>('/auth/onboarding', {
      method: 'DELETE',
    }),

  deleteAccount: async () => {
    const result = await apiFetch<{ success: boolean; message: string }>('/auth/account', {
      method: 'DELETE',
      body: JSON.stringify({ confirmation: 'DELETE' }),
    })
    // Clear token on account deletion
    clearAuthToken()
    return result
  },
}

// ============================================
// PROFILE
// ============================================

export interface OnboardingStatus {
  steps: {
    profile: {
      completed: boolean
      fields: {
        username: boolean
        displayName: boolean
        country: boolean
        purpose: boolean
        pricing: boolean
      }
    }
    payments: {
      completed: boolean
      status: string
      stripeAccountId: string | null
    }
  }
  progress: {
    profile: number
    payments: number
    overall: number
  }
  isComplete: boolean
  canAcceptPayments: boolean
  nextStep: 'profile' | 'payments' | null
}

export interface NotificationPrefs {
  push?: boolean
  email?: boolean
  subscriberAlerts?: boolean
  paymentAlerts?: boolean
}

export interface Settings {
  notificationPrefs: NotificationPrefs
  isPublic: boolean
  feeMode?: 'absorb' | 'pass_to_subscriber' | 'split'
}

export const profile = {
  get: () => apiFetch<{ profile: Profile | null }>('/profile'),

  patch: (data: Partial<Profile>) =>
    apiFetch<{ profile: Profile }>('/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  update: (data: Partial<Profile>) =>
    apiFetch<{ profile: Profile }>('/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  checkUsername: (username: string) =>
    apiFetch<{ available: boolean; reason?: string }>(
      `/profile/check-username/${username}`
    ),

  getOnboardingStatus: () =>
    apiFetch<OnboardingStatus>('/profile/onboarding-status'),

  // Settings
  getSettings: () => apiFetch<Settings>('/profile/settings'),

  updateSettings: (data: { notificationPrefs?: NotificationPrefs; isPublic?: boolean; feeMode?: 'absorb' | 'pass_to_subscriber' | 'split' }) =>
    apiFetch<{ success: boolean; settings: Settings }>('/profile/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Salary Mode (aligned billing for predictable paydays)
  getSalaryMode: () =>
    apiFetch<SalaryModeStatus>('/profile/salary-mode'),

  updateSalaryMode: (data: { enabled: boolean; preferredPayday?: number }) =>
    apiFetch<{ success: boolean; enabled: boolean; preferredPayday: number | null; billingDay: number | null }>('/profile/salary-mode', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Service Mode - AI-generated perks and banner (use longer timeout for AI)
  generatePerks: (data: { description: string; serviceType?: string; industry?: string; pricePerMonth: number; displayName?: string }) =>
    apiFetch<{ perks: Array<{ id: string; title: string; enabled: boolean }> }>('/profile/generate-perks', {
      method: 'POST',
      body: JSON.stringify(data),
      timeout: AI_TIMEOUT_MS, // 30s - AI generation can be slow
    }),

  generateBanner: (data?: { serviceDescription?: string; variant?: 'standard' | 'artistic' }) =>
    apiFetch<{ bannerUrl: string; wasGenerated: boolean; variant: 'standard' | 'artistic'; generationsRemaining: number }>('/profile/generate-banner', {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
      timeout: BANNER_TIMEOUT_MS, // 90s - uses "Thinking" mode which is slower
    }),

  updatePerks: (perks: Array<{ id: string; title: string; enabled: boolean }>) =>
    apiFetch<{ perks: Array<{ id: string; title: string; enabled: boolean }> }>('/profile/perks', {
      method: 'PATCH',
      body: JSON.stringify({ perks }),
    }),
}

// Salary Mode types
export interface SalaryModeStatus {
  enabled: boolean
  preferredPayday: number | null
  billingDay: number | null
  unlocked: boolean
  successfulPayments: number
  paymentsUntilUnlock: number
  available: boolean  // Only available for Stripe
}

// ============================================
// PUBLIC USERS
// ============================================

export const users = {
  getByUsername: (username: string) =>
    apiFetch<{ profile: Profile; viewerSubscription: ViewerSubscription | null; isOwner: boolean }>(`/users/${username}`),
}

// ============================================
// STRIPE
// ============================================

export interface StripeRequirements {
  currentlyDue: string[]
  eventuallyDue: string[]
  pendingVerification: string[]
  disabledReason: string | null
  currentDeadline: string | null
}

export interface StripePayoutSchedule {
  interval: 'daily' | 'weekly' | 'monthly' | 'manual'
  delayDays: number  // e.g., 2 means T+2 (funds available 2 days after payment)
  weeklyAnchor: string | null  // e.g., 'monday' for weekly payouts
  monthlyAnchor: number | null // e.g., 15 for monthly payouts on the 15th
}

export interface StripeStatusDetails {
  detailsSubmitted: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
  payoutSchedule: StripePayoutSchedule
  requirements: StripeRequirements
}

export const stripe = {
  connect: () =>
    apiFetch<{
      success: boolean
      accountId?: string
      onboardingUrl?: string
      alreadyOnboarded?: boolean
      error?: string
      suggestion?: string
      supportedCountries?: { code: string; name: string }[]
    }>('/stripe/connect', { method: 'POST' }),

  refreshOnboarding: () =>
    apiFetch<{ onboardingUrl: string }>('/stripe/connect/refresh', {
      method: 'POST',
    }),

  getStatus: (options: { quick?: boolean; refresh?: boolean } = {}) => {
    const params = new URLSearchParams()
    if (options.quick) params.set('quick', 'true')
    if (options.refresh) params.set('refresh', 'true')
    const queryString = params.toString()
    return apiFetch<{ connected: boolean; status: string; details?: StripeStatusDetails }>(
      `/stripe/connect/status${queryString ? `?${queryString}` : ''}`
    )
  },

  getBalance: () =>
    apiFetch<{
      balance: {
        available: number
        pending: number
        currency: string
        nextPayoutDate: string | null
        nextPayoutAmount: number | null
      }
    }>('/stripe/balance'),

  getPayouts: () =>
    apiFetch<{ payouts: any[] }>('/stripe/payouts'),

  getSupportedCountries: () =>
    apiFetch<{ countries: { code: string; name: string }[]; total: number }>(
      '/stripe/supported-countries'
    ),

  getDashboardLink: () =>
    apiFetch<{ url: string }>('/stripe/dashboard-link'),
}

// ============================================
// PAYSTACK (for NG, KE, ZA)
// ============================================

export interface PaystackBank {
  code: string
  name: string
  type: string
}

export interface PaystackConnectionStatus {
  connected: boolean
  status: string
  details?: {
    businessName: string
    bank: string
    accountNumber: string
    accountName: string
    percentageCharge: number
  }
}

export const paystack = {
  getSupportedCountries: () =>
    apiFetch<{
      countries: { code: string; name: string; currency: string }[]
      total: number
    }>('/paystack/supported-countries'),

  getBanks: (country: string) =>
    apiFetch<{ banks: PaystackBank[] }>(`/paystack/banks/${country}`),

  resolveAccount: (data: {
    accountNumber: string
    bankCode: string
    idNumber?: string
    accountType?: 'personal' | 'business'
  }) =>
    apiFetch<{
      verified: boolean
      accountName: string
      accountNumber: string
      bankCode: string
      error?: string
      verificationSkipped?: boolean
      message?: string
    }>('/paystack/resolve-account', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  connect: (data: {
    bankCode: string
    accountNumber: string
    accountName: string
    idNumber?: string
  }) =>
    apiFetch<{
      success: boolean
      subaccountCode?: string
      alreadyConnected?: boolean
      message?: string
      error?: string
    }>('/paystack/connect', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getStatus: () =>
    apiFetch<PaystackConnectionStatus>('/paystack/connect/status'),

  disconnect: () =>
    apiFetch<{ success: boolean; message: string }>('/paystack/disconnect', {
      method: 'POST',
    }),

  verifyTransaction: (reference: string) =>
    apiFetch<{
      verified: boolean
      status: string
      amount?: number
      currency?: string
      creatorUsername?: string
      customerEmail?: string
      paidAt?: string
      error?: string
    }>(`/paystack/verify/${reference}`),
}

// ============================================
// CHECKOUT
// ============================================

export interface CheckoutBreakdown {
  creatorAmount: number      // What creator receives (cents)
  serviceFee: number         // Platform fee (cents)
  totalAmount: number        // What subscriber pays (cents)
  effectiveRate: number      // Fee percentage (0.10 = 10%, 0.09 = 9%)
  currency: string
  feeModel: string
  purposeType: 'service' | 'personal'
}

export const checkout = {
  createSession: (data: {
    creatorUsername: string
    tierId?: string
    amount: number
    interval: 'month' | 'one_time'
    subscriberEmail?: string
    payerCountry?: string  // ISO 2-letter code for geo-based provider selection
    viewId?: string  // Analytics: page view ID for conversion tracking
  }) =>
    apiFetch<{
      provider: 'stripe' | 'paystack'
      sessionId?: string  // Stripe
      reference?: string  // Paystack
      url: string
      breakdown?: CheckoutBreakdown
    }>('/checkout/session', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Verify Paystack transaction (called on redirect with ?reference=xxx)
  // SECURITY: username param enables creator binding to prevent cross-creator spoofing
  verifyPaystack: (reference: string, username?: string) =>
    apiFetch<{
      verified: boolean
      status: string
      amount?: number
      currency?: string
      reference?: string
      paidAt?: string
      channel?: string
      error?: string
    }>(`/checkout/verify/${reference}${username ? `?username=${encodeURIComponent(username)}` : ''}`),

  // Verify Stripe session (Anti-spoofing)
  verifySession: (sessionId: string, username?: string) =>
    apiFetch<{
      verified: boolean
      status: string
      maskedEmail?: string | null
      creatorId?: string
      amountTotal?: number
      currency?: string
    }>(`/checkout/session/${sessionId}/verify${username ? `?username=${username}` : ''}`),
}

// ============================================
// SUBSCRIPTIONS
// ============================================

export const subscriptions = {
  list: (params?: { cursor?: string; limit?: number; status?: 'all' | 'active' | 'canceled' | 'past_due' }) => {
    const searchParams = new URLSearchParams()
    if (params?.cursor) searchParams.set('cursor', params.cursor)
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    if (params?.status) searchParams.set('status', params.status)
    const query = searchParams.toString()
    return apiFetch<{ subscriptions: Subscription[]; nextCursor: string | null; hasMore: boolean }>(
      `/subscriptions${query ? `?${query}` : ''}`
    )
  },

  get: (id: string) =>
    apiFetch<{ subscription: Subscription & { payments: any[] } }>(
      `/subscriptions/${id}`
    ),

  cancel: (id: string, options?: { immediate?: boolean }) =>
    apiFetch<{ success: boolean; subscription: Subscription }>(`/subscriptions/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify(options),
    }),
}

// ============================================
// ACTIVITY
// ============================================

export const activity = {
  list: (cursor?: string, limit = 20) =>
    apiFetch<{ activities: Activity[]; nextCursor: string | null }>(
      `/activity?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`
    ),

  get: (id: string) => apiFetch<{ activity: Activity; payoutInfo: PayoutInfoResponse | null; fxData: FxDataResponse | null; fxPending: boolean }>(`/activity/${id}`),

  getMetrics: () => apiFetch<{ metrics: Metrics }>('/activity/metrics'),

  getPayouts: () => apiFetch<{ payouts: PayoutHistoryItem[]; accountHealth: AccountHealth }>('/activity/payouts'),

  refreshBalance: () => apiFetch<{ balance: { available: number; pending: number; currency: string } }>('/activity/balance/refresh', { method: 'POST' }),
}

// ============================================
// REQUESTS
// ============================================

export const requests = {
  create: (data: {
    recipientName: string
    recipientEmail?: string
    recipientPhone?: string
    relationship: string
    amountCents: number
    currency: string  // Required - use creator's currency
    isRecurring?: boolean
    message?: string
    voiceUrl?: string
    customPerks?: string[]
    dueDate?: string  // ISO date string for invoices
    purpose?: string  // What the request is for
  }) =>
    apiFetch<{ request: Request }>('/requests', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  list: (params?: { cursor?: string; limit?: number; status?: 'all' | 'draft' | 'sent' | 'pending_payment' | 'accepted' | 'declined' | 'expired' }) => {
    const searchParams = new URLSearchParams()
    if (params?.cursor) searchParams.set('cursor', params.cursor)
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    if (params?.status) searchParams.set('status', params.status)
    const query = searchParams.toString()
    return apiFetch<{ requests: Request[]; nextCursor: string | null; hasMore: boolean }>(
      `/requests${query ? `?${query}` : ''}`
    )
  },

  get: (id: string) => apiFetch<{ request: Request }>(`/requests/${id}`),

  send: (id: string, method: 'email' | 'link') =>
    apiFetch<{ success: boolean; requestLink: string; method: string }>(
      `/requests/${id}/send`,
      {
        method: 'POST',
        body: JSON.stringify({ method }),
      }
    ),

  resend: (id: string, method: 'email' | 'link') =>
    apiFetch<{ success: boolean; requestLink: string; method: string }>(
      `/requests/${id}/resend`,
      {
        method: 'POST',
        body: JSON.stringify({ method }),
      }
    ),

  // Public routes for recipients
  view: (token: string) =>
    apiFetch<{ request: any }>(`/requests/r/${token}`),

  accept: (token: string, email?: string) =>
    apiFetch<{ success: boolean; checkoutUrl: string }>(
      `/requests/r/${token}/accept`,
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      }
    ),

  decline: (token: string) =>
    apiFetch<{ success: boolean }>(`/requests/r/${token}/decline`, {
      method: 'POST',
    }),
}

// ============================================
// UPDATES
// ============================================

export const updates = {
  create: (data: {
    title?: string
    body: string
    photoUrl?: string
    audience?: string
  }) =>
    apiFetch<{ update: Update }>('/updates', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  list: () => apiFetch<{ updates: Update[] }>('/updates'),

  get: (id: string) => apiFetch<{ update: Update }>(`/updates/${id}`),

  update: (id: string, data: Partial<Update>) =>
    apiFetch<{ update: Update }>(`/updates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<{ success: boolean }>(`/updates/${id}`, { method: 'DELETE' }),

  send: (id: string) =>
    apiFetch<{ success: boolean; recipientCount: number }>(
      `/updates/${id}/send`,
      { method: 'POST' }
    ),
}

// ============================================
// MEDIA
// ============================================

export const media = {
  getUploadUrl: (type: 'avatar' | 'photo' | 'voice' | 'banner', mimeType: string, fileSize: number) =>
    apiFetch<{
      uploadUrl: string
      publicUrl: string
      key: string
      expiresAt: string
      maxBytes: number
    }>('/media/upload-url', {
      method: 'POST',
      body: JSON.stringify({ type, mimeType, fileSize }),
    }),
}

// ============================================
// AI (Page Generation)
// ============================================

export interface AIGenerateInput {
  audio?: {
    data: string      // base64 encoded
    mimeType: string  // audio/webm, audio/mp3, etc.
  }
  textDescription?: string
  deliverables?: {
    type: string
    label: string
    quantity?: number
    detail?: string
  }[]
  credential?: string
  price: number
  userName: string
  includeMarketResearch?: boolean
}

export interface AIGenerateResult {
  success: boolean
  bio: string
  perks: string[]
  impactItems: string[]
  suggestedTitle?: string
  serviceType: 'personal' | 'professional'
  transcription?: string
  marketContext?: {
    competitorPricing: { low: number; mid: number; high: number }
    commonPerks: string[]
    industryTerms: string[]
    targetAudienceInsights: string
    pricingRationale: string
  }
}

export const ai = {
  // Check if AI services are available (aggregate status only)
  status: () =>
    apiFetch<{ available: boolean }>('/ai/status'),

  // Main page generation (voice or text) - uses longer timeout
  generate: (data: AIGenerateInput) =>
    apiFetch<AIGenerateResult>('/ai/generate', {
      method: 'POST',
      body: JSON.stringify(data),
      timeout: AI_TIMEOUT_MS, // 30s - AI generation can be slow
    }),

  // Quick text-only generation - uses longer timeout
  quick: (data: {
    description: string
    price: number
    userName: string
    serviceType: 'personal' | 'professional'
  }) =>
    apiFetch<{
      success: boolean
      bio: string
      perks: string[]
      impactItems: string[]
      suggestedTitle?: string
    }>('/ai/quick', {
      method: 'POST',
      body: JSON.stringify(data),
      timeout: AI_TIMEOUT_MS, // 30s - AI generation can be slow
    }),

  // Market research - uses longer timeout
  research: (serviceDescription: string, industry?: string) =>
    apiFetch<{
      success: boolean
      competitorPricing: { low: number; mid: number; high: number }
      commonPerks: string[]
      industryTerms: string[]
      targetAudienceInsights: string
      pricingRationale: string
    }>('/ai/research', {
      method: 'POST',
      body: JSON.stringify({ serviceDescription, industry }),
      timeout: AI_TIMEOUT_MS, // 30s - AI generation can be slow
    }),

  // Price suggestion - uses longer timeout
  suggestPrice: (serviceDescription: string) =>
    apiFetch<{
      success: boolean
      suggested: number
      range: { min: number; max: number }
    }>('/ai/suggest-price', {
      method: 'POST',
      body: JSON.stringify({ serviceDescription }),
      timeout: AI_TIMEOUT_MS, // 30s - AI generation can be slow
    }),
}

// ============================================
// PAYROLL
// ============================================

export interface PayPeriod {
  id: string
  startDate: string
  endDate: string
  currency: string
  grossAmount: number
  platformFee: number
  netAmount: number
  status: 'current' | 'pending' | 'paid'
  payoutDate?: string
  bankLast4?: string
  verificationCode: string
  payments?: {
    id: string
    date: string
    clientName: string
    amount: number
    type: 'subscription' | 'one_time'
  }[]
}

// Backend PayPeriod response shape (maps to our PayPeriod type)
interface BackendPayPeriod {
  id: string
  periodStart: string
  periodEnd: string
  currency: string
  grossCents: number
  platformFeeCents?: number
  netCents: number
  status: 'current' | 'pending' | 'paid'
  payoutDate?: string
  bankLast4?: string
  verificationCode: string
  payments?: {
    id: string
    date: string
    subscriberName: string
    amountCents: number
    type: 'subscription' | 'one_time'
  }[]
}

// Map backend payroll response to frontend PayPeriod type
const mapPayPeriod = (backend: BackendPayPeriod): PayPeriod => ({
  id: backend.id,
  startDate: backend.periodStart,
  endDate: backend.periodEnd,
  currency: backend.currency || 'USD',
  grossAmount: backend.grossCents, // Keep in cents, frontend divides by 100
  platformFee: backend.platformFeeCents ?? Math.round(backend.grossCents * 0.09),
  netAmount: backend.netCents,
  status: backend.status,
  payoutDate: backend.payoutDate,
  bankLast4: backend.bankLast4,
  verificationCode: backend.verificationCode,
  payments: backend.payments?.map(p => ({
    id: p.id,
    date: p.date,
    clientName: p.subscriberName,
    amount: p.amountCents,
    type: p.type,
  })),
})

export const payroll = {
  // Get all pay periods
  getPeriods: async () => {
    const response = await apiFetch<{
      periods: BackendPayPeriod[]
      ytdByCurrency: Record<string, number>
      warnings?: Array<{ type: string; message: string }>
    }>('/payroll/periods')
    return {
      periods: response.periods.map(mapPayPeriod),
      ytdByCurrency: response.ytdByCurrency || {},
      warnings: response.warnings || [],
    }
  },

  // Get single period detail
  getPeriod: async (id: string) => {
    const response = await apiFetch<{
      period: BackendPayPeriod
    }>(`/payroll/periods/${id}`)
    return {
      period: mapPayPeriod(response.period),
    }
  },

  // Verify a pay statement (public endpoint)
  verify: (code: string) =>
    apiFetch<{
      verified: boolean
      document?: {
        creatorName: string
        periodStart: string
        periodEnd: string
        grossCents: number
        netCents: number
        currency: string
        createdAt: string
        verificationCode: string
        paymentCount: number
        payoutDate: string | null
        payoutMethod: string | null
        platformConfirmed: boolean
      }
    }>(`/payroll/verify/${code}`),

  // Get subscribers for filter dropdown
  getSubscribers: () =>
    apiFetch<{
      subscribers: Array<{
        id: string
        email: string
        displayName: string
        tierName: string | null
      }>
    }>('/payroll/subscribers'),

  // Generate custom statement with filters
  generateCustomStatement: (params: {
    startDate: string
    endDate: string
    subscriberIds?: string[]
  }) =>
    apiFetch<{
      statement: {
        periodStart: string
        periodEnd: string
        grossCents: number
        refundsCents: number
        chargebacksCents: number
        totalFeeCents: number
        netCents: number
        paymentCount: number
        currency: string
        ytdGrossCents: number
        ytdNetCents: number
        payments: Array<{
          id: string
          date: string
          subscriberName: string
          subscriberEmail: string
          description: string
          amountCents: number
          type: string
        }>
        isVerifiable: boolean
        isFiltered: boolean
      }
      warnings: Array<{ type: string; message: string }>
    }>('/payroll/custom-statement', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
}

// ============================================
// MY SUBSCRIPTIONS (Subscriber-facing)
// ============================================

export interface MySubscription {
  id: string
  provider: {
    id: string
    displayName: string
    avatarUrl: string | null
    username: string | null
  }
  tierName: string | null
  amount: number
  currency: string
  interval: string
  status: string
  startedAt: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  hasStripe: boolean
  // Rich fields for UI parity with public flow
  isPastDue: boolean
  pastDueMessage: string | null
  updatePaymentMethod: 'portal' | 'resubscribe' | 'none'
  paymentProvider: 'stripe' | 'paystack'
}

export const mySubscriptions = {
  list: (params?: { cursor?: string; limit?: number; status?: 'all' | 'active' | 'canceled' | 'past_due' }) => {
    const searchParams = new URLSearchParams()
    if (params?.cursor) searchParams.set('cursor', params.cursor)
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    if (params?.status) searchParams.set('status', params.status)
    const query = searchParams.toString()
    return apiFetch<{ subscriptions: MySubscription[]; nextCursor: string | null; hasMore: boolean }>(
      `/my-subscriptions${query ? `?${query}` : ''}`
    )
  },

  get: (id: string) =>
    apiFetch<{ subscription: MySubscription & { payments: any[] } }>(
      `/my-subscriptions/${id}`
    ),

  cancel: (id: string, options?: { immediate?: boolean }) =>
    apiFetch<{ success: boolean; subscription: MySubscription }>(`/my-subscriptions/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  reactivate: (id: string) =>
    apiFetch<{ success: boolean; subscription: MySubscription }>(`/my-subscriptions/${id}/reactivate`, {
      method: 'POST',
    }),

  getPortalUrl: (id: string) =>
    apiFetch<{ url: string }>(`/my-subscriptions/${id}/portal`, {
      method: 'POST',
    }),
}

// ============================================
// BILLING (Platform Subscription)
// ============================================

export interface BillingStatus {
  plan: 'personal' | 'service'
  subscriptionRequired: boolean
  subscription: {
    status: string | null  // trialing, active, past_due, canceled, unpaid
    subscriptionId: string | null
    currentPeriodEnd: string | null
    trialEndsAt: string | null
    cancelAtPeriodEnd: boolean
  } | null
  // Platform debit info (for service providers with lapsed subscriptions)
  debit: {
    amountCents: number
    amountDisplay: string
    willRecoverFromNextPayment: boolean
    atCapLimit: boolean
    message: string
  } | null
}

export const billing = {
  getStatus: () =>
    apiFetch<BillingStatus>('/billing/status'),

  createCheckout: () =>
    apiFetch<{ url: string; sessionId: string }>('/billing/checkout', {
      method: 'POST',
    }),

  createPortalSession: () =>
    apiFetch<{ url: string }>('/billing/portal', {
      method: 'POST',
    }),
}

// ============================================
// ANALYTICS
// ============================================

export interface AnalyticsStats {
  views: {
    today: number
    week: number
    month: number
    total: number
  }
  uniqueVisitors: {
    today: number
    week: number
    month: number
  }
  funnel: {
    views: number
    reachedPayment: number
    startedCheckout: number
    completedCheckout: number
    conversions: number
  }
  rates: {
    viewToPayment: number
    paymentToCheckout: number
    checkoutToSubscribe: number
    overall: number
  }
  devices: Array<{ type: string; count: number }>
  referrers: Array<{ source: string; count: number }>
  dailyViews: Array<{ date: string; count: number }>
}

export const analytics = {
  // Record a page view (public, no auth)
  recordView: (data: {
    profileId: string
    referrer?: string
    utmSource?: string
    utmMedium?: string
    utmCampaign?: string
    country?: string // ISO 3166-1 alpha-2 country code (from geo detection)
  }) =>
    apiFetch<{ viewId: string; existing?: boolean }>('/analytics/view', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Update conversion progress (public, no auth)
  updateView: (viewId: string, data: { reachedPayment?: boolean; startedCheckout?: boolean; completedCheckout?: boolean }) =>
    apiFetch<{ success: boolean }>(`/analytics/view/${viewId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Get my analytics (auth required)
  getStats: () =>
    apiFetch<AnalyticsStats>('/analytics/stats'),
}

// Config API (public, no auth required)
export interface FeeConfig {
  platformFeeRate: number
  splitRate: number
  crossBorderBuffer: number
  platformFeePercent: number
  splitPercent: number
}

// AI availability config
export interface AIConfig {
  available: boolean
}

const config = {
  // Get fee configuration from backend (source of truth)
  getFees: () =>
    fetch(`${API_URL}/config/fees`)
      .then(res => res.ok ? res.json() as Promise<FeeConfig> : null)
      .catch(() => null),

  // Get AI feature availability (for service mode perks/banner generation)
  getAI: () =>
    fetch(`${API_URL}/config/ai`)
      .then(res => res.ok ? res.json() as Promise<AIConfig> : { available: false })
      .catch(() => ({ available: false })),
}

// ============================================
// SUBSCRIPTION MANAGEMENT (Public, Token-based)
// ============================================

export interface ManageSubscriptionData {
  subscription: {
    id: string
    status: string
    cancelAtPeriodEnd: boolean
    amount: number
    currency: string
    interval: string
    currentPeriodEnd?: string
    startedAt?: string
    createdAt: string
    provider: 'stripe' | 'paystack'
    // Payment update capabilities
    canUpdatePayment: boolean
    updatePaymentMethod: 'portal' | 'resubscribe' | 'none'
    billingDescriptor: string
    // Alert states
    isPastDue: boolean
    pastDueMessage: string | null
  }
  creator: {
    displayName: string
    username?: string
    avatarUrl?: string
  }
  subscriber: {
    maskedEmail: string
  }
  stats: {
    totalSupported: number
    memberSince: string
    paymentCount: number
  }
  payments: Array<{
    id: string
    amount: number
    currency: string
    date: string
    type: string
  }>
  actions: {
    resubscribeUrl: string | null
    canOpenPortal: boolean
  }
}

export type CancelReason =
  | 'too_expensive'
  | 'not_enough_value'
  | 'taking_break'
  | 'found_alternative'
  | 'technical_issues'
  | 'other'

const subscriptionManage = {
  // Get subscription data for management page
  get: (token: string): Promise<ManageSubscriptionData> =>
    apiFetch(`/subscription/manage/${token}`),

  // Cancel subscription with reason
  cancel: (token: string, reason?: CancelReason, comment?: string): Promise<{
    success: boolean
    alreadyCanceled?: boolean
    message: string
    accessUntil?: string
    resubscribeUrl?: string
  }> =>
    apiFetch(`/subscription/manage/${token}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason, comment }),
    }),

  // Get Stripe portal URL for payment updates
  getPortalUrl: (token: string): Promise<{ url: string }> =>
    apiFetch(`/subscription/manage/${token}/portal`),

  // Reactivate a canceled subscription (undo cancel)
  reactivate: (token: string): Promise<{
    success: boolean
    message: string
    subscription?: {
      status: string
      cancelAtPeriodEnd: boolean
      currentPeriodEnd?: string
    }
  }> =>
    apiFetch(`/subscription/manage/${token}/reactivate`, {
      method: 'POST',
    }),
}

// ============================================
// SUBSCRIBER PORTAL (Public - email + OTP auth)
// ============================================

export interface SubscriberSubscription {
  id: string
  creator: {
    displayName: string
    username?: string
    avatarUrl?: string
  }
  amount: number
  currency: string
  interval: string
  status: string
  statusLabel: string
  currentPeriodEnd?: string
  startedAt?: string
  totalPaid: number
  paymentCount: number
  provider: 'stripe' | 'paystack'
  canUpdatePayment: boolean
  updatePaymentMethod: 'portal' | 'resubscribe' | 'none'
  billingDescriptor: string
  isPastDue: boolean
  cancelAtPeriodEnd: boolean
}

export interface SubscriberSubscriptionDetail extends SubscriberSubscription {
  createdAt: string
  pastDueMessage: string | null
}

const subscriberPortal = {
  // Request OTP
  requestOtp: (email: string): Promise<{ message: string }> =>
    apiFetch('/subscriber/otp', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  // Verify OTP
  verifyOtp: (email: string, otp: string): Promise<{
    success?: boolean
    expiresAt?: string
    error?: string
    attemptsRemaining?: number
  }> =>
    apiFetch('/subscriber/verify', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    }),

  // List subscriptions
  listSubscriptions: (): Promise<{
    email: string
    maskedEmail: string
    subscriptions: SubscriberSubscription[]
  }> =>
    apiFetch('/subscriber/subscriptions'),

  // Get subscription detail
  getSubscription: (id: string): Promise<{
    subscription: SubscriberSubscriptionDetail
    payments: Array<{
      id: string
      amount: number
      currency: string
      date: string
      status: string
    }>
    actions: {
      resubscribeUrl: string
    }
  }> =>
    apiFetch(`/subscriber/subscriptions/${id}`),

  // Cancel subscription
  cancelSubscription: (id: string, reason?: CancelReason, comment?: string): Promise<{
    success: boolean
    alreadyCanceled?: boolean
    message: string
    accessUntil?: string
    resubscribeUrl?: string
  }> =>
    apiFetch(`/subscriber/subscriptions/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason, comment }),
    }),

  // Reactivate subscription (undo cancel)
  reactivateSubscription: (id: string): Promise<{
    success: boolean
    message: string
    subscription?: {
      status: string
      cancelAtPeriodEnd: boolean
      currentPeriodEnd?: string
    }
  }> =>
    apiFetch(`/subscriber/subscriptions/${id}/reactivate`, {
      method: 'POST',
    }),

  // Get portal URL
  getPortalUrl: (id: string): Promise<{
    url?: string
    error?: string
    instructions?: string
    resubscribeUrl?: string
  }> =>
    apiFetch(`/subscriber/subscriptions/${id}/portal`),

  // Sign out
  signOut: (): Promise<{ success: boolean }> =>
    apiFetch('/subscriber/signout', { method: 'POST' }),
}

// Export all
export const api = {
  auth,
  profile,
  users,
  stripe,
  paystack,
  checkout,
  subscriptions,
  mySubscriptions,
  subscriptionManage,
  subscriberPortal,
  activity,
  requests,
  updates,
  media,
  ai,
  payroll,
  analytics,
  billing,
  config,
}

// ============================================
// GEO DETECTION
// ============================================

const GEO_CACHE_KEY = 'natepay_payer_country'
const GEO_TIMEOUT_MS = 5000

/**
 * Detect payer's country via server-side geo detection.
 * Uses CDN headers (Cloudflare, Vercel) with ipapi.co fallback.
 * Caches result in sessionStorage for the session.
 *
 * @returns ISO 2-letter country code (e.g., 'US', 'NG')
 */
export async function detectPayerCountry(): Promise<string> {
  // Check sessionStorage cache first
  try {
    const cached = sessionStorage.getItem(GEO_CACHE_KEY)
    if (cached && /^[A-Z]{2}$/.test(cached)) {
      return cached
    }
  } catch {
    // Storage blocked (private browsing)
  }

  // Call server-side geo endpoint
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS)

    const response = await fetch(`${API_URL}/geo`, {
      signal: controller.signal,
      credentials: 'include',
    })
    clearTimeout(timeoutId)

    if (response.ok) {
      const data = await response.json()
      const country = data.country?.toUpperCase()

      if (country && /^[A-Z]{2}$/.test(country)) {
        // Cache for the session
        try {
          sessionStorage.setItem(GEO_CACHE_KEY, country)
        } catch {
          // Storage blocked
        }
        return country
      }
    }
  } catch {
    // Network error or timeout
  }

  // Default fallback
  return 'US'
}

export default api
