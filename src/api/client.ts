// API Client for Nate Backend

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Types
export interface ApiError {
  error: string
  status: number
}

export interface User {
  id: string
  email: string
  profile: Profile | null
  createdAt: string
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

// Base fetch wrapper
async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}${path}`

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const data = await response.json()

  if (!response.ok) {
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

export const auth = {
  requestMagicLink: (email: string) =>
    apiFetch<{ success: boolean; message: string }>('/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  verify: (token: string) =>
    apiFetch<{ success: boolean; hasProfile: boolean; redirectTo: string }>(
      `/auth/verify?token=${token}`
    ),

  logout: () =>
    apiFetch<{ success: boolean }>('/auth/logout', { method: 'POST' }),

  me: () => apiFetch<User>('/auth/me'),

  deleteAccount: () =>
    apiFetch<{ success: boolean; message: string }>('/auth/account', {
      method: 'DELETE',
      body: JSON.stringify({ confirmation: 'DELETE' }),
    }),
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
    apiFetch<{ sessionId: string; url: string }>('/checkout/session', {
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

// Export all
export const api = {
  auth,
  profile,
  users,
  stripe,
  checkout,
  subscriptions,
  activity,
  requests,
  updates,
  media,
  ai,
}

export default api
