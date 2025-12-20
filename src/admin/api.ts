/**
 * Admin API Hooks
 *
 * React Query hooks for admin endpoints.
 * Uses the user's session for authentication (backend checks admin whitelist).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAuthToken } from '../api/client'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Admin-specific fetch wrapper
// Uses the user's session/token - backend verifies the user is an admin
async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_URL}${path}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  // Send auth token for user identification
  const token = getAuthToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(url, {
    ...options,
    credentials: 'include', // Include cookies for session auth
    headers,
  })

  const data = await response.json().catch(() => ({ error: 'Invalid response' }))

  if (!response.ok) {
    throw new Error(data.error || data.message || 'Request failed')
  }

  return data
}

// ============================================
// TYPES
// ============================================

export interface DashboardStats {
  users: { total: number; newToday: number; newThisMonth: number }
  subscriptions: { active: number }
  revenue: { totalCents: number; thisMonthCents: number }
  flags: { disputedPayments: number; failedPaymentsToday: number }
}

export interface RevenueOverview {
  allTime: { totalVolumeCents: number; platformFeeCents: number; creatorPayoutsCents: number; paymentCount: number }
  thisMonth: { totalVolumeCents: number; platformFeeCents: number; creatorPayoutsCents: number; paymentCount: number }
  lastMonth: { totalVolumeCents: number; platformFeeCents: number; creatorPayoutsCents: number; paymentCount: number }
  today: { totalVolumeCents: number; platformFeeCents: number; creatorPayoutsCents: number; paymentCount: number }
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

export interface AdminUser {
  id: string
  email: string
  profile: {
    username: string | null
    displayName: string | null
    country: string | null
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
    queryKey: ['admin', 'dashboard'],
    queryFn: () => adminFetch<DashboardStats>('/admin/dashboard'),
    staleTime: 60 * 1000, // 1 minute
  })
}

// ============================================
// REVENUE
// ============================================

export function useAdminRevenueOverview() {
  return useQuery({
    queryKey: ['admin', 'revenue', 'overview'],
    queryFn: () => adminFetch<RevenueOverview>('/admin/revenue/overview'),
    staleTime: 60 * 1000,
  })
}

export function useAdminRevenueByProvider(period: string = 'month') {
  return useQuery({
    queryKey: ['admin', 'revenue', 'by-provider', period],
    queryFn: () => adminFetch<RevenueByProvider>(`/admin/revenue/by-provider?period=${period}`),
    staleTime: 60 * 1000,
  })
}

export function useAdminRevenueByCurrency(period: string = 'month') {
  return useQuery({
    queryKey: ['admin', 'revenue', 'by-currency', period],
    queryFn: () => adminFetch<RevenueByCurrency>(`/admin/revenue/by-currency?period=${period}`),
    staleTime: 60 * 1000,
  })
}

export function useAdminRevenueDaily(days: number = 30) {
  return useQuery({
    queryKey: ['admin', 'revenue', 'daily', days],
    queryFn: () => adminFetch<DailyRevenue>(`/admin/revenue/daily?days=${days}`),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useAdminRevenueMonthly(months: number = 12) {
  return useQuery({
    queryKey: ['admin', 'revenue', 'monthly', months],
    queryFn: () => adminFetch<MonthlyRevenue>(`/admin/revenue/monthly?months=${months}`),
    staleTime: 5 * 60 * 1000,
  })
}

export function useAdminTopCreators(period: string = 'month', limit: number = 20) {
  return useQuery({
    queryKey: ['admin', 'revenue', 'top-creators', period, limit],
    queryFn: () => adminFetch<{ period: string; creators: TopCreator[] }>(`/admin/revenue/top-creators?period=${period}&limit=${limit}`),
    staleTime: 5 * 60 * 1000,
  })
}

export function useAdminRefundsStats(period: string = 'month') {
  return useQuery({
    queryKey: ['admin', 'revenue', 'refunds', period],
    queryFn: () => adminFetch<RefundsStats>(`/admin/revenue/refunds?period=${period}`),
    staleTime: 5 * 60 * 1000,
  })
}

// ============================================
// USERS
// ============================================

export function useAdminUsers(params: { search?: string; status?: string; page?: number; limit?: number } = {}) {
  const searchParams = new URLSearchParams()
  if (params.search) searchParams.set('search', params.search)
  if (params.status) searchParams.set('status', params.status)
  if (params.page) searchParams.set('page', params.page.toString())
  if (params.limit) searchParams.set('limit', params.limit.toString())
  const query = searchParams.toString()

  return useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: () => adminFetch<{ users: AdminUser[]; total: number; page: number; totalPages: number }>(`/admin/users${query ? `?${query}` : ''}`),
    staleTime: 30 * 1000,
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

// ============================================
// PAYMENTS
// ============================================

export function useAdminPayments(params: { status?: string; page?: number; limit?: number } = {}) {
  const searchParams = new URLSearchParams()
  if (params.status) searchParams.set('status', params.status)
  if (params.page) searchParams.set('page', params.page.toString())
  if (params.limit) searchParams.set('limit', params.limit.toString())
  const query = searchParams.toString()

  return useQuery({
    queryKey: ['admin', 'payments', params],
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'payments'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'revenue'] })
    },
  })
}

// ============================================
// SUBSCRIPTIONS
// ============================================

export function useAdminSubscriptions(params: { status?: string; page?: number; limit?: number } = {}) {
  const searchParams = new URLSearchParams()
  if (params.status) searchParams.set('status', params.status)
  if (params.page) searchParams.set('page', params.page.toString())
  if (params.limit) searchParams.set('limit', params.limit.toString())
  const query = searchParams.toString()

  return useQuery({
    queryKey: ['admin', 'subscriptions', params],
    queryFn: () => adminFetch<{ subscriptions: AdminSubscription[]; total: number; page: number; totalPages: number }>(`/admin/subscriptions${query ? `?${query}` : ''}`),
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'subscriptions'] })
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
    queryKey: ['admin', 'logs', params],
    queryFn: () => adminFetch<{ logs: SystemLog[]; total: number; page: number; totalPages: number }>(`/admin/logs${query ? `?${query}` : ''}`),
    staleTime: 30 * 1000,
  })
}

export function useAdminLogsStats() {
  return useQuery({
    queryKey: ['admin', 'logs', 'stats'],
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
    queryKey: ['admin', 'reminders', params],
    queryFn: () => adminFetch<{ reminders: AdminReminder[]; total: number; page: number; totalPages: number }>(`/admin/reminders${query ? `?${query}` : ''}`),
    staleTime: 30 * 1000,
  })
}

export function useAdminRemindersStats() {
  return useQuery({
    queryKey: ['admin', 'reminders', 'stats'],
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
    queryKey: ['admin', 'emails', params],
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
    queryKey: ['admin', 'invoices', params],
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
    queryKey: ['admin', 'activity', params],
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
  }
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

export function useAdminStripeAccounts(params: { status?: string; page?: number; limit?: number } = {}) {
  const searchParams = new URLSearchParams()
  if (params.status) searchParams.set('status', params.status)
  if (params.page) searchParams.set('page', params.page.toString())
  if (params.limit) searchParams.set('limit', params.limit.toString())
  const query = searchParams.toString()

  return useQuery({
    queryKey: ['admin', 'stripe', 'accounts', params],
    queryFn: () => adminFetch<{ accounts: StripeAccount[]; total: number; page: number; totalPages: number }>(`/admin/stripe/accounts${query ? `?${query}` : ''}`),
    staleTime: 60 * 1000,
  })
}

export function useAdminStripeAccountDetail(accountId: string) {
  return useQuery({
    queryKey: ['admin', 'stripe', 'accounts', accountId],
    queryFn: () => adminFetch<StripeAccountDetail>(`/admin/stripe/accounts/${accountId}`),
    enabled: !!accountId,
    staleTime: 60 * 1000,
  })
}

export function useAdminStripeTransfers(params: { limit?: number; startingAfter?: string } = {}) {
  const searchParams = new URLSearchParams()
  if (params.limit) searchParams.set('limit', params.limit.toString())
  if (params.startingAfter) searchParams.set('startingAfter', params.startingAfter)
  const query = searchParams.toString()

  return useQuery({
    queryKey: ['admin', 'stripe', 'transfers', params],
    queryFn: () => adminFetch<{ transfers: StripeTransfer[]; hasMore: boolean; nextCursor: string | null }>(`/admin/stripe/transfers${query ? `?${query}` : ''}`),
    staleTime: 60 * 1000,
  })
}

export function useAdminStripeBalance() {
  return useQuery({
    queryKey: ['admin', 'stripe', 'balance'],
    queryFn: () => adminFetch<StripeBalance>('/admin/stripe/balance'),
    staleTime: 60 * 1000,
  })
}

export function useAdminStripeEvents(params: { type?: string; limit?: number; startingAfter?: string } = {}) {
  const searchParams = new URLSearchParams()
  if (params.type) searchParams.set('type', params.type)
  if (params.limit) searchParams.set('limit', params.limit.toString())
  if (params.startingAfter) searchParams.set('startingAfter', params.startingAfter)
  const query = searchParams.toString()

  return useQuery({
    queryKey: ['admin', 'stripe', 'events', params],
    queryFn: () => adminFetch<{ events: StripeEvent[]; hasMore: boolean; nextCursor: string | null }>(`/admin/stripe/events${query ? `?${query}` : ''}`),
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'stripe'] })
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'stripe', 'accounts'] })
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'stripe', 'accounts'] })
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'subscriptions'] })
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'subscriptions'] })
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
    queryKey: ['admin', 'paystack', 'banks', country],
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}
