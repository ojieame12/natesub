// Query Key Factory - Centralized query key definitions
// See: https://tkdodo.eu/blog/effective-react-query-keys#use-query-key-factories

export const queryKeys = {
  // User/Auth domain
  currentUser: ['currentUser'] as const,
  profile: ['profile'] as const,
  settings: ['settings'] as const,
  checkUsername: (username: string) => ['checkUsername', username] as const,
  publicProfile: (username: string) => ['publicProfile', username] as const,

  // Stripe domain
  stripe: {
    all: ['stripe'] as const,
    status: ['stripeStatus'] as const,
    balance: ['stripeBalance'] as const,
    payouts: ['stripePayouts'] as const,
  },

  // Paystack domain
  paystack: {
    all: ['paystack'] as const,
    status: ['paystackStatus'] as const,
    banks: (country: string) => ['paystackBanks', country] as const,
  },

  // Subscriptions domain
  subscriptions: {
    all: ['subscriptions'] as const,
    list: (status?: string) => ['subscriptions', status] as const,
    summary: ['subscriptions', 'summary'] as const,
    detail: (id: string) => ['subscription', id] as const,
    my: (status?: string) => ['mySubscriptions', status] as const,
  },

  // Activity domain
  activity: {
    all: ['activity'] as const,
    list: (limit?: number) => ['activity', { limit }] as const,
    detail: (id: string) => ['activity', id] as const,
  },

  // Metrics
  metrics: ['metrics'] as const,

  // Payouts
  payouts: ['payouts'] as const,

  // Notifications
  notifications: (limit?: number) => ['notifications', limit] as const,

  // Requests domain
  requests: {
    all: ['requests'] as const,
    list: (status?: string) => ['requests', status] as const,
    summary: ['requests', 'summary'] as const,
    detail: (id: string) => ['request', id] as const,
    public: (token: string) => ['publicRequest', token] as const,
  },

  // Updates domain
  updates: {
    all: ['updates'] as const,
    list: ['updates'] as const,
    detail: (id: string) => ['update', id] as const,
  },

  // AI
  aiStatus: ['aiStatus'] as const,

  // Payroll domain
  payroll: {
    all: ['payroll'] as const,
    periods: ['payroll', 'periods'] as const,
    period: (id: string) => ['payroll', 'periods', id] as const,
    verify: (code: string) => ['payroll', 'verify', code] as const,
    subscribers: ['payroll', 'subscribers'] as const,
  },

  // Analytics
  analytics: {
    all: ['analytics'] as const,
    stats: ['analytics', 'stats'] as const,
  },

  // Billing
  billing: {
    all: ['billing'] as const,
    status: ['billing', 'status'] as const,
  },
} as const

// Admin query keys - separate namespace
export const adminQueryKeys = {
  all: ['admin'] as const,
  dashboard: ['admin', 'dashboard'] as const,

  // Revenue
  revenue: {
    all: ['admin', 'revenue'] as const,
    overview: ['admin', 'revenue', 'overview'] as const,
    byProvider: (period: string) => ['admin', 'revenue', 'by-provider', period] as const,
    byCurrency: (period: string) => ['admin', 'revenue', 'by-currency', period] as const,
    daily: (days: number) => ['admin', 'revenue', 'daily', days] as const,
    monthly: (months: number) => ['admin', 'revenue', 'monthly', months] as const,
    topCreators: (period: string, limit: number) => ['admin', 'revenue', 'top-creators', period, limit] as const,
    refunds: (period: string) => ['admin', 'revenue', 'refunds', period] as const,
  },

  // Users
  users: {
    all: ['admin', 'users'] as const,
    list: (params: Record<string, unknown>) => ['admin', 'users', params] as const,
  },

  // Payments
  payments: {
    all: ['admin', 'payments'] as const,
    list: (params: Record<string, unknown>) => ['admin', 'payments', params] as const,
  },

  // Subscriptions
  subscriptions: {
    all: ['admin', 'subscriptions'] as const,
    list: (params: Record<string, unknown>) => ['admin', 'subscriptions', params] as const,
    detail: (id: string) => ['admin', 'subscriptions', id] as const,
  },

  // Logs
  logs: {
    all: ['admin', 'logs'] as const,
    list: (params: Record<string, unknown>) => ['admin', 'logs', params] as const,
    stats: ['admin', 'logs', 'stats'] as const,
  },

  // Reminders
  reminders: {
    all: ['admin', 'reminders'] as const,
    list: (params: Record<string, unknown>) => ['admin', 'reminders', params] as const,
    stats: ['admin', 'reminders', 'stats'] as const,
  },

  // Emails
  emails: {
    list: (params: Record<string, unknown>) => ['admin', 'emails', params] as const,
  },

  // Invoices
  invoices: {
    list: (params: Record<string, unknown>) => ['admin', 'invoices', params] as const,
  },

  // Activity
  activity: {
    list: (params: Record<string, unknown>) => ['admin', 'activity', params] as const,
  },

  // Stripe
  stripe: {
    all: ['admin', 'stripe'] as const,
    accounts: {
      all: ['admin', 'stripe', 'accounts'] as const,
      list: (params: Record<string, unknown>) => ['admin', 'stripe', 'accounts', params] as const,
      detail: (accountId: string) => ['admin', 'stripe', 'accounts', accountId] as const,
    },
    transfers: (params: Record<string, unknown>) => ['admin', 'stripe', 'transfers', params] as const,
    balance: ['admin', 'stripe', 'balance'] as const,
    events: (params: Record<string, unknown>) => ['admin', 'stripe', 'events', params] as const,
  },

  // Paystack
  paystack: {
    banks: (country: string) => ['admin', 'paystack', 'banks', country] as const,
  },

  // Analytics
  analytics: {
    churn: (days: number) => ['admin', 'analytics', 'churn', days] as const,
    mrr: (months: number) => ['admin', 'analytics', 'mrr', months] as const,
  },

  // Admins
  admins: {
    all: ['admin', 'admins'] as const,
    list: ['admin', 'admins'] as const,
    audit: (limit: number) => ['admin', 'admins', 'audit', limit] as const,
  },
} as const
