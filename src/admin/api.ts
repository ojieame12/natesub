/**
 * Admin API Hooks
 *
 * React Query hooks for admin endpoints.
 * Uses the user's session for authentication (backend checks admin whitelist).
 * Admin fetch uses shared fetchJson layer with longer timeout (20s vs 8s).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAuthToken } from '../api/client'
import { createFetchClient, type FetchOptions } from '../api/fetchJson'
import { adminQueryKeys } from '../api/queryKeys'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const ADMIN_FETCH_TIMEOUT_MS = 20_000

// Create admin fetch client with longer timeout
// No onUnauthorized - admin pages handle auth separately via AdminRoute
const adminFetchClient = createFetchClient({
  baseUrl: API_URL,
  defaultTimeout: ADMIN_FETCH_TIMEOUT_MS,
  getAuthToken,
})

// Admin-specific fetch wrapper - delegates to shared layer
async function adminFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  return adminFetchClient<T>(path, options)
}

// ============================================
// TYPES
// ============================================

/** Per-currency revenue breakdown */
export interface CurrencyRevenue {
  feeCents: number
  volumeCents: number
  paymentCount: number
}

export interface DashboardStats {
  users: { total: number; newToday: number; newThisMonth: number }
  subscriptions: { active: number }
  revenue: {
    // Per-currency breakdown (accurate)
    byCurrency: Record<string, CurrencyRevenue>
    thisMonthByCurrency: Record<string, CurrencyRevenue>
    // Currency metadata
    currencies: string[]
    thisMonthCurrencies: string[]
    isMultiCurrency: boolean
    isThisMonthMultiCurrency: boolean
    // Totals (WARNING: mixed currencies if isMultiCurrency=true)
    totalCents: number
    thisMonthCents: number
    totalVolumeCents: number
    thisMonthVolumeCents: number
    paymentCount: number
    thisMonthPaymentCount: number
    // USD equivalent totals (captured at payment time for accuracy)
    usdEquivalent?: {
      totalFeesUsdCents: number
      totalVolumeUsdCents: number
      thisMonthFeesUsdCents: number
      thisMonthVolumeUsdCents: number
      hasEstimatedRates: boolean // True if any payments used backfilled rates
      estimatedPaymentCount: number
    }
  }
  flags: { disputedPayments: number; failedPaymentsToday: number }
  freshness?: {
    businessTimezone: string
    lastPaymentAt: string | null
    lastWebhookProcessedAt: string | null
    lastWebhookProvider: string | null
  }
}

/** Per-period revenue stats (may mix currencies - use byCurrency for accurate data) */
interface PeriodStats {
  totalVolumeCents: number
  platformFeeCents: number
  creatorPayoutsCents: number
  paymentCount: number
}

/** Per-currency breakdown for a time period */
interface PeriodByCurrency {
  [currency: string]: {
    totalVolumeCents: number
    platformFeeCents: number
    creatorPayoutsCents: number
    paymentCount: number
  }
}

/** Currency metadata for a time period */
interface PeriodCurrencyMeta {
  currencies: string[]
  isMultiCurrency: boolean
}

export interface RevenueOverview {
  // Totals (WARNING: may mix currencies if multi-currency)
  allTime: PeriodStats
  thisMonth: PeriodStats
  lastMonth: PeriodStats
  today: PeriodStats
  // Per-currency breakdown (accurate)
  byCurrency?: {
    allTime: PeriodByCurrency
    thisMonth: PeriodByCurrency
    lastMonth: PeriodByCurrency
    today: PeriodByCurrency
  }
  // Currency metadata
  currencies?: {
    allTime: PeriodCurrencyMeta
    thisMonth: PeriodCurrencyMeta
    lastMonth: PeriodCurrencyMeta
    today: PeriodCurrencyMeta
  }
  paymentsByStatus: Record<string, number>
  freshness?: {
    businessTimezone?: string
    lastPaymentAt: string | null
    lastWebhookProcessedAt: string | null
    lastWebhookProvider: string | null
    lastWebhookType: string | null
  }
}

export interface RevenueByProvider {
  period: string
  stripe: { totalVolumeCents: number; platformFeeCents: number; creatorPayoutsCents: number; paymentCount: number }
  paystack: { totalVolumeCents: number; platformFeeCents: number; creatorPayoutsCents: number; paymentCount: number }
}

export interface RevenueByCurrency {
  period: string
  currencies: Array<{
    currency: string
    totalVolumeCents: number
    platformFeeCents: number
    creatorPayoutsCents: number
    paymentCount: number
  }>
}

export interface DailyRevenue {
  days: Array<{
    date: string
    volumeCents: number
    feesCents: number
    payoutsCents: number
    count: number
  }>
}

export interface MonthlyRevenue {
  months: Array<{
    month: string
    volumeCents: number
    feesCents: number
    payoutsCents: number
    count: number
  }>
}

export interface TopCreator {
  creatorId: string
  email?: string
  username?: string
  displayName?: string
  country?: string
  totalVolumeCents: number
  platformFeeCents: number
  creatorEarningsCents: number
  paymentCount: number
}

export interface RefundsStats {
  period: string
  refunds: { totalCents: number; count: number }
  disputes: { totalCents: number; count: number }
  chargebacks: { totalCents: number; count: number }
}

/** Combined revenue data from /admin/revenue/all - reduces 7 API calls to 1 */
export interface RevenueAll {
  overview: RevenueOverview
  byProvider: RevenueByProvider
  byCurrency: RevenueByCurrency
  daily: DailyRevenue
  monthly: MonthlyRevenue
  topCreators: { period: string; creators: TopCreator[] }
  refunds: RefundsStats
}

export interface AdminUser {
  id: string
  email: string
  role?: 'user' | 'admin' | 'super_admin'
  profile: {
    username: string | null
    displayName: string | null
    country: string | null
    currency: string | null
    paymentProvider: string | null
    payoutStatus: string | null
  } | null
  status: string
  revenueTotal: number
  subscriberCount: number
  createdAt: string
}

export interface AdminPayment {
  id: string
  creator: { id: string; email: string; username: string | null }
  subscriber: { id: string; email: string }
  grossCents: number
  amountCents?: number
  feeCents: number
  netCents: number
  currency: string
  status: string
  type: string
  provider: string
  stripePaymentIntentId?: string
  paystackTransactionRef?: string
  occurredAt?: string
  createdAt: string
}

export interface AdminSubscription {
  id: string
  creator: { id: string; email: string; username: string | null }
  subscriber: { id: string; email: string }
  amount: number
  currency: string
  interval: string
  status: string
  ltvCents: number
  currentPeriodEnd?: string
  createdAt: string
}

export interface SystemLog {
  id: string
  type: string
  level: string
  userId: string | null
  entityType: string | null
  entityId: string | null
  message: string
  metadata: Record<string, any> | null
  errorMessage: string | null
  createdAt: string
}

export interface LogsStats {
  last24h: {
    emailsSent: number
    emailsFailed: number
    remindersSent: number
    totalErrors: number
  }
  errorsByType: Array<{ type: string; count: number }>
}

export interface AdminReminder {
  id: string
  type: string
  channel: string
  status: string
  scheduledFor: string
  sentAt: string | null
  retryCount: number
  userId: string
  entityType: string
  entityId: string
}

export interface RemindersStats {
  scheduled: number
  sentToday: number
  failed: number
  upcomingNext24h: number
}

export interface AdminEmail {
  id: string
  status: string
  to: string
  subject: string
  template: string
  messageId: string | null
  createdAt: string
}

export interface AdminInvoice {
  id: string
  creator: { id: string; email: string; username: string | null }
  recipientName: string
  recipientEmail: string | null
  amountCents: number
  currency: string
  status: string
  dueDate: string | null
  createdAt: string
}

export interface AdminActivity {
  id: string
  type: string
  message: string
  adminEmail: string
  targetUserId: string | null
  targetEntityType: string | null
  targetEntityId: string | null
  metadata: Record<string, any> | null
  createdAt: string
}

// ============================================
// DASHBOARD
// ============================================

export function useAdminDashboard() {
  return useQuery({
    queryKey: adminQueryKeys.dashboard,
    queryFn: () => adminFetch<DashboardStats>('/admin/dashboard'),
    staleTime: 60 * 1000, // 1 minute
  })
}

// ============================================
// REVENUE
// ============================================

/**
 * Combined revenue hook - fetches all revenue data in a single API call
 * Supersedes individual hooks (useAdminRevenueOverview, useAdminRevenueByProvider, etc.)
 */
export function useAdminRevenueAll(period: string = 'month', days: number = 30, months: number = 12, topCreatorsLimit: number = 10) {
  return useQuery({
    queryKey: adminQueryKeys.revenue.combined(period, days, months, topCreatorsLimit),
    queryFn: () => adminFetch<RevenueAll>(`/admin/revenue/all?period=${period}&days=${days}&months=${months}&topCreatorsLimit=${topCreatorsLimit}`),
    staleTime: 60 * 1000, // 1 minute cache
  })
}

// ============================================
// USERS
// ============================================

export function useAdminUsers(
  params: { search?: string; status?: string; page?: number; limit?: number } = {},
  options: { enabled?: boolean } = {}
) {
  const searchParams = new URLSearchParams()
  if (params.search) searchParams.set('search', params.search)
  if (params.status) searchParams.set('status', params.status)
  if (params.page) searchParams.set('page', params.page.toString())
  if (params.limit) searchParams.set('limit', params.limit.toString())
  const query = searchParams.toString()

  return useQuery({
    queryKey: adminQueryKeys.users.list(params),
    queryFn: () => adminFetch<{ users: AdminUser[]; total: number; page: number; totalPages: number }>(`/admin/users${query ? `?${query}` : ''}`),
    staleTime: 30 * 1000,
    enabled: options.enabled ?? true,
  })
}

export function useAdminUserBlock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason?: string }) =>
      adminFetch<{ success: boolean }>(`/admin/users/${userId}/block`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.users.all })
    },
  })
}

export function useAdminUserUnblock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      adminFetch<{ success: boolean }>(`/admin/users/${userId}/unblock`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.users.all })
    },
  })
}

export function useAdminUserDelete() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason?: string }) =>
      adminFetch<{ success: boolean; message: string; details: { canceledSubscriptions: { platform: number; creator: number; subscriber: number } } }>(`/admin/users/${userId}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirm: 'DELETE', reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.users.all })
    },
  })
}

// ============================================
// PAYMENTS
// ============================================

export function useAdminPayments(params: { search?: string; status?: string; page?: number; limit?: number } = {}) {
  const searchParams = new URLSearchParams()
  if (params.search) searchParams.set('search', params.search)
  if (params.status) searchParams.set('status', params.status)
  if (params.page) searchParams.set('page', params.page.toString())
  if (params.limit) searchParams.set('limit', params.limit.toString())
  const query = searchParams.toString()

  return useQuery({
    queryKey: adminQueryKeys.payments.list(params),
    queryFn: () => adminFetch<{ payments: AdminPayment[]; total: number; page: number; totalPages: number }>(`/admin/payments${query ? `?${query}` : ''}`),
    staleTime: 30 * 1000,
  })
}

export function useAdminRefund() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ paymentId, reason, amount }: { paymentId: string; reason?: string; amount?: number }) =>
      adminFetch<{ success: boolean; refundId: string }>(`/admin/payments/${paymentId}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason, amount }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.payments.all })
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.revenue.all })
    },
  })
}

// ============================================
// SUBSCRIPTIONS
// ============================================

export function useAdminSubscriptions(params: { search?: string; status?: string; page?: number; limit?: number } = {}) {
  const searchParams = new URLSearchParams()
  if (params.search) searchParams.set('search', params.search)
  if (params.status) searchParams.set('status', params.status)
  if (params.page) searchParams.set('page', params.page.toString())
  if (params.limit) searchParams.set('limit', params.limit.toString())
  const query = searchParams.toString()

  return useQuery({
    queryKey: adminQueryKeys.subscriptions.list(params),
    queryFn: () => adminFetch<{ subscriptions: AdminSubscription[]; total: number; page: number; totalPages: number }>(`/admin/subscriptions${query ? `?${query}` : ''}`),
    staleTime: 30 * 1000,
  })
}

export interface SubscriptionDetail {
  subscription: {
    id: string
    status: string
    amount: number
    currency: string
    interval: string
    ltvCents: number
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    createdAt: string
    canceledAt: string | null
    stripeSubscriptionId: string | null
    paystackAuthorizationCode: boolean
  }
  creator: {
    id: string
    email: string
    username: string | null
    displayName: string | null
  }
  subscriber: {
    id: string
    email: string
    joinedAt: string
    totalSpentCents: number
    totalPayments: number
  }
  payments: Array<{
    id: string
    grossCents: number
    feeCents: number
    netCents: number
    currency: string
    status: string
    type: string
    provider: string
    occurredAt: string
  }>
  otherSubscriptions: Array<{
    id: string
    creatorUsername: string | null
    creatorDisplayName: string | null
    amount: number
    currency: string
    status: string
  }>
}

export function useAdminSubscriptionDetail(subscriptionId: string) {
  return useQuery({
    queryKey: adminQueryKeys.subscriptions.detail(subscriptionId),
    queryFn: () => adminFetch<SubscriptionDetail>(`/admin/subscriptions/${subscriptionId}`),
    enabled: !!subscriptionId,
    staleTime: 30 * 1000,
  })
}

export function useAdminCancelSubscription() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ subscriptionId, immediate }: { subscriptionId: string; immediate?: boolean }) =>
      adminFetch<{ success: boolean }>(`/admin/subscriptions/${subscriptionId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ immediate }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.subscriptions.all })
    },
  })
}

// ============================================
// LOGS
// ============================================

export function useAdminLogs(params: { type?: string; level?: string; page?: number; limit?: number } = {}) {
  const searchParams = new URLSearchParams()
  if (params.type) searchParams.set('type', params.type)
  if (params.level) searchParams.set('level', params.level)
  if (params.page) searchParams.set('page', params.page.toString())
  if (params.limit) searchParams.set('limit', params.limit.toString())
  const query = searchParams.toString()

  return useQuery({
    queryKey: adminQueryKeys.logs.list(params),
    queryFn: () => adminFetch<{ logs: SystemLog[]; total: number; page: number; totalPages: number }>(`/admin/logs${query ? `?${query}` : ''}`),
    staleTime: 30 * 1000,
  })
}

export function useAdminLogsStats() {
  return useQuery({
    queryKey: adminQueryKeys.logs.stats,
    queryFn: () => adminFetch<LogsStats>('/admin/logs/stats'),
    staleTime: 60 * 1000,
  })
}

// ============================================
// REMINDERS
// ============================================

export function useAdminReminders(params: { status?: string; type?: string; page?: number; limit?: number } = {}) {
  const searchParams = new URLSearchParams()
  if (params.status) searchParams.set('status', params.status)
  if (params.type) searchParams.set('type', params.type)
  if (params.page) searchParams.set('page', params.page.toString())
  if (params.limit) searchParams.set('limit', params.limit.toString())
  const query = searchParams.toString()

  return useQuery({
    queryKey: adminQueryKeys.reminders.list(params),
    queryFn: () => adminFetch<{ reminders: AdminReminder[]; total: number; page: number; totalPages: number }>(`/admin/reminders${query ? `?${query}` : ''}`),
    staleTime: 30 * 1000,
  })
}

export function useAdminRemindersStats() {
  return useQuery({
    queryKey: adminQueryKeys.reminders.stats,
    queryFn: () => adminFetch<RemindersStats>('/admin/reminders/stats'),
    staleTime: 60 * 1000,
  })
}

// ============================================
// EMAILS
// ============================================

export function useAdminEmails(params: { status?: string; template?: string; page?: number; limit?: number } = {}) {
  const searchParams = new URLSearchParams()
  if (params.status) searchParams.set('status', params.status)
  if (params.template) searchParams.set('template', params.template)
  if (params.page) searchParams.set('page', params.page.toString())
  if (params.limit) searchParams.set('limit', params.limit.toString())
  const query = searchParams.toString()

  return useQuery({
    queryKey: adminQueryKeys.emails.list(params),
    queryFn: () => adminFetch<{ emails: AdminEmail[]; total: number; page: number; totalPages: number }>(`/admin/emails${query ? `?${query}` : ''}`),
    staleTime: 30 * 1000,
  })
}

// ============================================
// INVOICES
// ============================================

export function useAdminInvoices(params: { status?: string; page?: number; limit?: number } = {}) {
  const searchParams = new URLSearchParams()
  if (params.status) searchParams.set('status', params.status)
  if (params.page) searchParams.set('page', params.page.toString())
  if (params.limit) searchParams.set('limit', params.limit.toString())
  const query = searchParams.toString()

  return useQuery({
    queryKey: adminQueryKeys.invoices.list(params),
    queryFn: () => adminFetch<{ invoices: AdminInvoice[]; total: number; page: number; totalPages: number }>(`/admin/invoices${query ? `?${query}` : ''}`),
    staleTime: 30 * 1000,
  })
}

// ============================================
// ACTIVITY
// ============================================

export function useAdminActivity(params: { type?: string; page?: number; limit?: number } = {}) {
  const searchParams = new URLSearchParams()
  if (params.type) searchParams.set('type', params.type)
  if (params.page) searchParams.set('page', params.page.toString())
  if (params.limit) searchParams.set('limit', params.limit.toString())
  const query = searchParams.toString()

  return useQuery({
    queryKey: adminQueryKeys.activity.list(params),
    queryFn: () => adminFetch<{ activities: AdminActivity[]; total: number; page: number; totalPages: number }>(`/admin/activity${query ? `?${query}` : ''}`),
    staleTime: 30 * 1000,
  })
}

// ============================================
// STRIPE
// ============================================

export interface StripeAccount {
  userId: string
  email: string
  username: string
  displayName: string
  country: string | null
  currency: string | null
  localPayoutStatus: string
  createdAt: string
  stripeAccountId: string | null
  stripeStatus: {
    chargesEnabled: boolean
    payoutsEnabled: boolean
    detailsSubmitted: boolean
    type: string
    country: string | null
    defaultCurrency: string | null
    capabilities: Record<string, string>
    requirements: {
      currentlyDue: string[]
      eventuallyDue: string[]
      pastDue: string[]
      pendingVerification: string[]
      disabledReason: string | null
    }
  } | null
  stripeError?: string
}

export interface StripeAccountDetail {
  local: {
    userId: string
    email: string
    username: string
    displayName: string
    country: string | null
    currency: string | null
    payoutStatus: string
  } | null
  stripe: {
    id: string
    type: string
    country: string | null
    defaultCurrency: string | null
    email: string | null
    chargesEnabled: boolean
    payoutsEnabled: boolean
    detailsSubmitted: boolean
    created: string | null
    capabilities: Record<string, string>
    requirements: any
    settings: {
      payoutSchedule: any
      statementDescriptor: string | null
    }
  } | null
  stripeError?: string
  balance: {
    available: Array<{ amount: number; currency: string }>
    pending: Array<{ amount: number; currency: string }>
    instantAvailable?: Array<{ amount: number; currency: string }>
  }
  recentPayouts: Array<{
    id: string
    amount: number
    currency: string
    status: string
    arrivalDate: string
    created: string
    method: string
    type: string
    failureCode: string | null
    failureMessage: string | null
  }>
}

export interface StripeTransfer {
  id: string
  amount: number
  currency: string
  created: string
  destination: string
  destinationPayment: string | null
  reversed: boolean
  sourceTransaction: string | null
  creator: {
    username: string
    displayName: string
    email: string
  } | null
}

export interface StripeBalance {
  available: Array<{ amount: number; currency: string }>
  pending: Array<{ amount: number; currency: string }>
  connectReserved?: Array<{ amount: number; currency: string }>
  instantAvailable?: Array<{ amount: number; currency: string }>
}

export interface StripeEvent {
  id: string
  type: string
  created: string
  livemode: boolean
  pendingWebhooks: number
  request: { id: string | null; idempotency_key: string | null } | null
  data: {
    objectType: string
    objectId: string
    amount?: number
    currency?: string
    status?: string
    customer?: string
  }
}

type AdminQueryOptions = { enabled?: boolean }

export function useAdminStripeAccounts(
  params: { status?: string; page?: number; limit?: number } = {},
  options: AdminQueryOptions = {},
) {
  const searchParams = new URLSearchParams()
  if (params.status) searchParams.set('status', params.status)
  if (params.page) searchParams.set('page', params.page.toString())
  if (params.limit) searchParams.set('limit', params.limit.toString())
  const query = searchParams.toString()

  return useQuery({
    queryKey: adminQueryKeys.stripe.accounts.list(params),
    queryFn: () => adminFetch<{ accounts: StripeAccount[]; total: number; page: number; totalPages: number }>(`/admin/stripe/accounts${query ? `?${query}` : ''}`),
    enabled: options.enabled ?? true,
    staleTime: 60 * 1000,
  })
}

export function useAdminStripeAccountDetail(accountId: string) {
  return useQuery({
    queryKey: adminQueryKeys.stripe.accounts.detail(accountId),
    queryFn: () => adminFetch<StripeAccountDetail>(`/admin/stripe/accounts/${accountId}`),
    enabled: !!accountId,
    staleTime: 60 * 1000,
  })
}

export function useAdminStripeTransfers(
  params: { limit?: number; startingAfter?: string } = {},
  options: AdminQueryOptions = {},
) {
  const searchParams = new URLSearchParams()
  if (params.limit) searchParams.set('limit', params.limit.toString())
  if (params.startingAfter) searchParams.set('startingAfter', params.startingAfter)
  const query = searchParams.toString()

  return useQuery({
    queryKey: adminQueryKeys.stripe.transfers(params),
    queryFn: () => adminFetch<{ transfers: StripeTransfer[]; hasMore: boolean; nextCursor: string | null }>(`/admin/stripe/transfers${query ? `?${query}` : ''}`),
    enabled: options.enabled ?? true,
    staleTime: 60 * 1000,
  })
}

export function useAdminStripeBalance(options: AdminQueryOptions = {}) {
  return useQuery({
    queryKey: adminQueryKeys.stripe.balance,
    queryFn: () => adminFetch<StripeBalance>('/admin/stripe/balance'),
    enabled: options.enabled ?? true,
    staleTime: 60 * 1000,
  })
}

export function useAdminStripeEvents(
  params: { type?: string; limit?: number; startingAfter?: string } = {},
  options: AdminQueryOptions = {},
) {
  const searchParams = new URLSearchParams()
  if (params.type) searchParams.set('type', params.type)
  if (params.limit) searchParams.set('limit', params.limit.toString())
  if (params.startingAfter) searchParams.set('startingAfter', params.startingAfter)
  const query = searchParams.toString()

  return useQuery({
    queryKey: adminQueryKeys.stripe.events(params),
    queryFn: () => adminFetch<{ events: StripeEvent[]; hasMore: boolean; nextCursor: string | null }>(`/admin/stripe/events${query ? `?${query}` : ''}`),
    enabled: options.enabled ?? true,
    staleTime: 30 * 1000,
  })
}

export function useAdminStripePayout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ accountId, amount, currency }: { accountId: string; amount?: number; currency?: string }) =>
      adminFetch<{ success: boolean; payout: { id: string; amount: number; currency: string; status: string; arrivalDate: string } }>(`/admin/stripe/accounts/${accountId}/payout`, {
        method: 'POST',
        body: JSON.stringify({ amount, currency }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.stripe.all })
    },
  })
}

export function useAdminStripeDisablePayouts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ accountId, reason }: { accountId: string; reason: string }) =>
      adminFetch<{ success: boolean }>(`/admin/stripe/accounts/${accountId}/disable-payouts`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.stripe.accounts.all })
    },
  })
}

export function useAdminStripeEnablePayouts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (accountId: string) =>
      adminFetch<{ success: boolean }>(`/admin/stripe/accounts/${accountId}/enable-payouts`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.stripe.accounts.all })
    },
  })
}

export function useAdminSubscriptionPause() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (subscriptionId: string) =>
      adminFetch<{ success: boolean }>(`/admin/subscriptions/${subscriptionId}/pause`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.subscriptions.all })
    },
  })
}

export function useAdminSubscriptionResume() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (subscriptionId: string) =>
      adminFetch<{ success: boolean }>(`/admin/subscriptions/${subscriptionId}/resume`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.subscriptions.all })
    },
  })
}

// ============================================
// CONCIERGE CREATOR CREATION
// ============================================

export interface PaystackBank {
  code: string
  name: string
  type: string
}

export interface ResolveAccountResult {
  supported: boolean
  accountName?: string
  accountNumber?: string
  message?: string
}

export interface CreateCreatorResult {
  success: boolean
  user: {
    id: string
    email: string
    username: string
    displayName: string
    paymentLink: string
  }
  message: string
}

export function usePaystackBanks(country: string) {
  return useQuery({
    queryKey: adminQueryKeys.paystack.banks(country),
    queryFn: () => adminFetch<{ banks: PaystackBank[] }>(`/admin/paystack/banks/${country}`),
    staleTime: 10 * 60 * 1000, // 10 minutes - banks don't change often
    enabled: !!country,
  })
}

export function useResolveAccount() {
  return useMutation({
    mutationFn: (params: { country: string; bankCode: string; accountNumber: string }) =>
      adminFetch<ResolveAccountResult>('/admin/paystack/resolve-account', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  })
}

export function useCreateCreator() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: {
      email: string
      displayName: string
      username: string
      country: string
      bankCode: string
      accountNumber: string
      accountName?: string
      amount: number
    }) =>
      adminFetch<CreateCreatorResult>('/admin/users/create-creator', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.users.all })
    },
  })
}

// ============================================
// DATA EXPORT
// ============================================

export interface ExportResult {
  filename: string
  rowCount: number
  csv: string
}

export function useExportPayments() {
  return useMutation({
    mutationFn: (params: {
      startDate?: string
      endDate?: string
      status?: string
      creatorId?: string
      limit?: number
    }) =>
      adminFetch<ExportResult>('/admin/export/payments', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  })
}

export function useExportSubscriptions() {
  return useMutation({
    mutationFn: (params: {
      status?: string
      creatorId?: string
      startDate?: string
      endDate?: string
      limit?: number
    }) =>
      adminFetch<ExportResult>('/admin/export/subscriptions', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  })
}

export function useExportCreators() {
  return useMutation({
    mutationFn: (params: {
      country?: string
      payoutStatus?: string
      paymentProvider?: string
      limit?: number
    }) =>
      adminFetch<ExportResult>('/admin/export/creators', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  })
}

export function useExportUsers() {
  return useMutation({
    mutationFn: (params: {
      role?: string
      includeDeleted?: boolean
      limit?: number
    }) =>
      adminFetch<ExportResult>('/admin/export/users', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  })
}

// Helper to download CSV
export function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

// ============================================
// BULK OPERATIONS
// ============================================

export interface BulkCancelPreview {
  preview: true
  filters: Record<string, unknown>
  count: number
  totalMrrImpact: number
  subscriptions: Array<{
    id: string
    status: string
    amount: number
    currency: string
    creatorName: string
    subscriberEmail: string
    createdAt: string
  }>
  note?: string
}

export function useBulkCancelPreview() {
  return useMutation({
    mutationFn: (params: {
      creatorId?: string
      status?: string
      createdBefore?: string
      createdAfter?: string
      reason: string
    }) =>
      adminFetch<BulkCancelPreview>('/admin/bulk/cancel-subscriptions/preview', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  })
}

export function useBulkCancelSubscriptions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: {
      creatorId?: string
      status?: string
      createdBefore?: string
      createdAfter?: string
      reason: string
      confirmCount: number
    }) =>
      adminFetch<{ success: boolean; cancelled: number; reason: string; timestamp: string }>('/admin/bulk/cancel-subscriptions', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.subscriptions.all })
    },
  })
}

// ============================================
// ANALYTICS
// ============================================

export interface ChurnAnalysis {
  period: { start: string; end: string; days: number }
  summary: {
    cancelled: number
    mrrLost: number
    churnRate: number
    activeAtPeriodStart: number
  }
  byReason: Array<{
    reason: string
    count: number
    mrrLost: number
    percentage: number
  }>
  trend: Array<{
    date: string
    count: number
    mrrLost: number
  }>
}

export interface MRRTrend {
  current: {
    mrr: number
    mrrFormatted: string
    activeSubscriptions: number
    monthOverMonthGrowth: number
  }
  trend: Array<{
    month: string
    activeSubscriptions: number
    mrr: number
    newSubscriptions: number
    churned: number
    netGrowth: number
  }>
}

export function useAdminChurnAnalysis(days: number = 30) {
  return useQuery({
    queryKey: adminQueryKeys.analytics.churn(days),
    queryFn: () => adminFetch<ChurnAnalysis>(`/admin/analytics/churn?days=${days}`),
    staleTime: 5 * 60 * 1000,
  })
}

export function useAdminMRRTrend(months: number = 12) {
  return useQuery({
    queryKey: adminQueryKeys.analytics.mrr(months),
    queryFn: () => adminFetch<MRRTrend>(`/admin/analytics/mrr?months=${months}`),
    staleTime: 5 * 60 * 1000,
  })
}

// ============================================
// ADMIN MANAGEMENT
// ============================================

// Note: AdminUser (for platform users) is defined at line ~158
// This interface is for admin team members with elevated privileges
export interface AdminTeamMember {
  id: string
  email: string
  role: 'admin' | 'super_admin'
  displayName: string | null
  username: string | null
  createdAt: string
  lastLoginAt: string | null
  adminGrantedAt: string | null
  adminGrantedByEmail: string | null
}

export interface AdminsListResponse {
  admins: AdminTeamMember[]
  total: number
  superAdminCount: number
  adminCount: number
}

export function useAdminsList() {
  return useQuery({
    queryKey: adminQueryKeys.admins.list,
    queryFn: () => adminFetch<AdminsListResponse>('/admin/admins'),
    staleTime: 60 * 1000,
  })
}

export function usePromoteToAdmin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { userId: string; role: 'admin' | 'super_admin'; reason?: string }) =>
      adminFetch<{ success: boolean; message: string }>(`/admin/admins/users/${params.userId}/promote`, {
        method: 'POST',
        body: JSON.stringify({ role: params.role, reason: params.reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.admins.list })
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.users.all })
    },
  })
}

export function useDemoteAdmin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { userId: string; reason: string }) =>
      adminFetch<{ success: boolean; message: string }>(`/admin/admins/users/${params.userId}/demote`, {
        method: 'POST',
        body: JSON.stringify({ reason: params.reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.admins.list })
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.users.all })
    },
  })
}

export interface AdminAuditLog {
  id: string
  message: string
  metadata: Record<string, unknown> | null
  createdAt: string
}

export function useAdminAuditLog(limit: number = 50, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: adminQueryKeys.admins.audit(limit),
    queryFn: () => adminFetch<{
      audit: AdminAuditLog[]
      pagination: { total: number; limit: number; offset: number; hasMore: boolean }
    }>(`/admin/admins/audit?limit=${limit}`),
    staleTime: 60 * 1000,
    enabled: options.enabled ?? true,
  })
}
