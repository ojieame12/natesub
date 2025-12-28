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
    myAll: ['mySubscriptions'] as const,  // Base key for invalidation
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

  // Config (public, no auth)
  config: {
    all: ['config'] as const,
    fees: ['config', 'fees'] as const,
    ai: ['config', 'ai'] as const,
  },
} as const

// Admin query keys - separate namespace
export const adminQueryKeys = {
  all: ['admin'] as const,
  me: ['admin', 'me'] as const,
  dashboard: ['admin', 'dashboard'] as const,

  // Revenue - uses combined endpoint (individual endpoints deprecated)
  revenue: {
    all: ['admin', 'revenue'] as const,
    combined: (period: string, days: number, months: number, topCreatorsLimit: number) =>
      ['admin', 'revenue', 'all', period, days, months, topCreatorsLimit] as const,
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

  // Support
  support: {
    all: ['admin', 'support'] as const,
    stats: ['admin', 'support', 'stats'] as const,
    tickets: (filters?: Record<string, string>) => ['admin', 'support', 'tickets', filters] as const,
    ticket: (id: string) => ['admin', 'support', 'ticket', id] as const,
  },

  // Health
  health: ['admin', 'health'] as const,

  // Webhooks
  webhooks: {
    all: ['admin', 'webhooks'] as const,
    stats: ['admin', 'webhooks', 'stats'] as const,
    failed: ['admin', 'webhooks', 'failed'] as const,
    list: (params: Record<string, unknown>) => ['admin', 'webhooks', params] as const,
  },

  // Blocked Subscribers
  blockedSubscribers: ['admin', 'blocked-subscribers'] as const,

  // Disputes
  disputes: {
    all: ['admin', 'disputes'] as const,
    stats: ['admin', 'disputes', 'stats'] as const,
    list: (params: Record<string, unknown>) => ['admin', 'disputes', params] as const,
  },

  // Reconciliation
  reconciliation: {
    all: ['admin', 'reconciliation'] as const,
    paystackMissing: (hours: number) => ['admin', 'reconciliation', 'paystack-missing', hours] as const,
    stripeMissing: (limit: number) => ['admin', 'reconciliation', 'stripe-missing', limit] as const,
  },

  // Creators
  creators: {
    all: ['admin', 'creators'] as const,
    list: (params: Record<string, unknown>) => ['admin', 'creators', params] as const,
    detail: (id: string) => ['admin', 'creators', id] as const,
    stats: ['admin', 'creators', 'stats'] as const,
  },

  // Subscribers (admin view)
  subscribers: {
    all: ['admin', 'subscribers'] as const,
    list: (params: Record<string, unknown>) => ['admin', 'subscribers', params] as const,
  },

  // Tax
  tax: {
    all: ['admin', 'tax'] as const,
    earnings: (year: number) => ['admin', 'tax', 'earnings', year] as const,
  },

  // Refunds
  refunds: {
    all: ['admin', 'refunds'] as const,
    list: (params: Record<string, unknown>) => ['admin', 'refunds', params] as const,
  },
} as const
