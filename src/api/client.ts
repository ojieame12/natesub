// API Client for Nate Backend

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const AUTH_TOKEN_KEY = 'nate_auth_token'

// Token storage utilities (works on web and Capacitor)
export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

export function setAuthToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token)
}

export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY)
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
  data: Record<string, any> | null
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
  voiceIntroUrl: string | null
  country: string
  countryCode: string
  currency: string
  purpose: string
  pricingModel: 'single' | 'tiers'
  singleAmount: number | null
  tiers: Tier[] | null
  perks: Perk[] | null
  impactItems: ImpactItem[] | null
  paymentProvider: string | null
  payoutStatus: 'pending' | 'active' | 'restricted'
  shareUrl: string | null
  template?: 'boundary' | 'minimal' | 'editorial' // Subscribe page template
  paymentsReady?: boolean // For public profiles - indicates if checkout will work
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
  payload: Record<string, any>
  createdAt: string
}

export interface Metrics {
  subscriberCount: number
  mrrCents: number
  mrr: number
  totalRevenueCents: number
  totalRevenue: number
  tierBreakdown: Record<string, number>
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

// Base fetch wrapper
async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}${path}`

  // Build headers with optional Authorization token
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  // Add Bearer token if available (for mobile apps)
  const token = getAuthToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let response: Response
  try {
    response = await fetch(url, {
      ...options,
      credentials: 'include', // Still include cookies for web
      headers,
    })
  } catch (networkError) {
    // Network error (offline, CORS, DNS failure) - don't clear auth
    throw {
      error: 'Network error. Please check your connection.',
      status: 0,
    } as ApiError
  }

  let data: any
  try {
    data = await response.json()
  } catch {
    data = { error: 'Invalid response from server' }
  }

  if (!response.ok) {
    // Only clear auth on confirmed 401 from server (not network issues)
    if (response.status === 401) {
      clearAuthToken()
      dispatchAuthError()
    }

    const error: ApiError = {
      error: data.error || 'Request failed',
      status: response.status,
    }
    throw error
  }

  return data
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
  requestMagicLink: (email: string) =>
    apiFetch<{ success: boolean; message: string }>('/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  verify: async (otp: string): Promise<VerifyResponse> => {
    const result = await apiFetch<VerifyResponse>(`/auth/verify?token=${otp}`)

    // Store token for mobile apps (Bearer auth)
    if (result.token) {
      setAuthToken(result.token)
    }

    return result
  },

  logout: async () => {
    const result = await apiFetch<{ success: boolean }>('/auth/logout', { method: 'POST' })
    // Clear stored token
    clearAuthToken()
    return result
  },

  me: () => apiFetch<User>('/auth/me'),

  // Save onboarding progress to server
  saveOnboardingProgress: (data: {
    step: number
    branch?: 'personal' | 'service'
    data?: Record<string, any>
  }) =>
    apiFetch<{ success: boolean }>('/auth/onboarding', {
      method: 'PUT',
      body: JSON.stringify(data),
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
  push: boolean
  email: boolean
  subscriberAlerts: boolean
  paymentAlerts: boolean
}

export interface Settings {
  notificationPrefs: NotificationPrefs
  isPublic: boolean
}

export const profile = {
  get: () => apiFetch<{ profile: Profile | null }>('/profile'),

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

  updateSettings: (data: { notificationPrefs?: NotificationPrefs; isPublic?: boolean }) =>
    apiFetch<{ success: boolean; settings: Settings }>('/profile/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
}

// ============================================
// PUBLIC USERS
// ============================================

export const users = {
  getByUsername: (username: string) =>
    apiFetch<{ profile: Profile }>(`/users/${username}`),
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

export interface StripeStatusDetails {
  detailsSubmitted: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
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

  getStatus: () =>
    apiFetch<{ connected: boolean; status: string; details?: StripeStatusDetails }>(
      '/stripe/connect/status'
    ),

  getBalance: () =>
    apiFetch<{ balance: { available: number; pending: number } }>('/stripe/balance'),

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
}

// ============================================
// CHECKOUT
// ============================================

export const checkout = {
  createSession: (data: {
    creatorUsername: string
    tierId?: string
    amount: number
    interval: 'month' | 'one_time'
    subscriberEmail?: string
  }) =>
    apiFetch<{
      provider: 'stripe' | 'paystack'
      sessionId?: string  // Stripe
      reference?: string  // Paystack
      url: string
    }>('/checkout/session', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
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
}

// ============================================
// ACTIVITY
// ============================================

export const activity = {
  list: (cursor?: string, limit = 20) =>
    apiFetch<{ activities: Activity[]; nextCursor: string | null }>(
      `/activity?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`
    ),

  get: (id: string) => apiFetch<{ activity: Activity }>(`/activity/${id}`),

  getMetrics: () => apiFetch<{ metrics: Metrics }>('/activity/metrics'),
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
    currency?: string
    isRecurring?: boolean
    message?: string
    voiceUrl?: string
    customPerks?: string[]
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

  // Public routes for recipients
  view: (token: string) =>
    apiFetch<{ request: any }>(`/requests/r/${token}`),

  accept: (token: string, email: string) =>
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
  getUploadUrl: (type: 'avatar' | 'photo' | 'voice', mimeType: string) =>
    apiFetch<{
      uploadUrl: string
      publicUrl: string
      key: string
      expiresAt: string
    }>('/media/upload-url', {
      method: 'POST',
      body: JSON.stringify({ type, mimeType }),
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
  // Check which AI services are configured
  status: () =>
    apiFetch<{ gemini: boolean; perplexity: boolean; replicate: boolean }>('/ai/status'),

  // Main page generation (voice or text)
  generate: (data: AIGenerateInput) =>
    apiFetch<AIGenerateResult>('/ai/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Quick text-only generation
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
    }),

  // Market research
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
    }),

  // Price suggestion
  suggestPrice: (serviceDescription: string) =>
    apiFetch<{
      success: boolean
      suggested: number
      range: { min: number; max: number }
    }>('/ai/suggest-price', {
      method: 'POST',
      body: JSON.stringify({ serviceDescription }),
    }),
}

// ============================================
// PAYROLL
// ============================================

export interface PayPeriod {
  id: string
  startDate: string
  endDate: string
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

export const payroll = {
  // Get all pay periods
  getPeriods: () =>
    apiFetch<{
      periods: PayPeriod[]
      ytdTotal: number
    }>('/payroll/periods'),

  // Get single period detail
  getPeriod: (id: string) =>
    apiFetch<{
      period: PayPeriod
    }>(`/payroll/periods/${id}`),

  // Verify a pay statement (public endpoint)
  verify: (code: string) =>
    apiFetch<{
      valid: boolean
      period?: {
        startDate: string
        endDate: string
        netAmount: number
        payoutDate: string
        recipientName: string
      }
    }>(`/payroll/verify/${code}`),
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
  }) =>
    apiFetch<{ viewId: string; existing?: boolean }>('/analytics/view', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Update conversion progress (public, no auth)
  updateView: (viewId: string, data: { reachedPayment?: boolean; startedCheckout?: boolean }) =>
    apiFetch<{ success: boolean }>(`/analytics/view/${viewId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Get my analytics (auth required)
  getStats: () =>
    apiFetch<AnalyticsStats>('/analytics/stats'),
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
  activity,
  requests,
  updates,
  media,
  ai,
  payroll,
  analytics,
}

export default api
