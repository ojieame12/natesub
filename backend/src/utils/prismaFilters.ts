/**
 * Type-Safe Prisma Where Clause Builders
 *
 * Replace `const where: any = {}` with type-safe filter builders.
 * Provides consistent filter patterns across admin endpoints.
 */

import type { Prisma } from '@prisma/client'

/**
 * User filter options
 */
export interface UserFilterOptions {
  search?: string
  status?: 'active' | 'blocked' | 'deleted' | 'all'
  role?: 'user' | 'admin' | 'super_admin'
  hasProfile?: boolean
  createdAfter?: Date
  createdBefore?: Date
}

/**
 * Build type-safe User where clause
 *
 * Usage:
 * ```typescript
 * const where = buildUserWhere({ search: 'john', status: 'active' })
 * const users = await db.user.findMany({ where })
 * ```
 */
export function buildUserWhere(filters: UserFilterOptions): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {}

  // Search across email, username, displayName
  if (filters.search) {
    where.OR = [
      { email: { contains: filters.search, mode: 'insensitive' } },
      { profile: { username: { contains: filters.search, mode: 'insensitive' } } },
      { profile: { displayName: { contains: filters.search, mode: 'insensitive' } } },
    ]
  }

  // Status filter
  if (filters.status && filters.status !== 'all') {
    switch (filters.status) {
      case 'active':
        where.deletedAt = null
        where.blockedReason = null
        break
      case 'blocked':
        where.blockedReason = { not: null }
        break
      case 'deleted':
        where.deletedAt = { not: null }
        break
    }
  }

  // Role filter
  if (filters.role) {
    where.role = filters.role
  }

  // Profile filter
  if (filters.hasProfile !== undefined) {
    where.profile = filters.hasProfile ? { isNot: null } : null
  }

  // Date range filters
  if (filters.createdAfter || filters.createdBefore) {
    where.createdAt = {}
    if (filters.createdAfter) {
      where.createdAt.gte = filters.createdAfter
    }
    if (filters.createdBefore) {
      where.createdAt.lt = filters.createdBefore
    }
  }

  return where
}

/**
 * Payment filter options
 */
export interface PaymentFilterOptions {
  status?: 'pending' | 'succeeded' | 'failed' | 'refunded' | 'disputed' | 'dispute_won' | 'dispute_lost' | 'otp_pending'
  type?: 'recurring' | 'one_time' | 'refund' | 'dispute' | 'payout'
  provider?: 'stripe' | 'paystack'
  currency?: string
  creatorId?: string
  subscriberId?: string
  minAmount?: number
  maxAmount?: number
  createdAfter?: Date
  createdBefore?: Date
}

/**
 * Build type-safe Payment where clause
 */
export function buildPaymentWhere(filters: PaymentFilterOptions): Prisma.PaymentWhereInput {
  const where: Prisma.PaymentWhereInput = {}

  if (filters.status) {
    where.status = filters.status
  }

  if (filters.type) {
    where.type = filters.type
  }

  // Provider detection
  if (filters.provider === 'stripe') {
    where.stripePaymentIntentId = { not: null }
  } else if (filters.provider === 'paystack') {
    where.paystackTransactionRef = { not: null }
  }

  if (filters.currency) {
    where.currency = filters.currency
  }

  if (filters.creatorId) {
    where.creatorId = filters.creatorId
  }

  if (filters.subscriberId) {
    where.subscriberId = filters.subscriberId
  }

  // Amount range filters (cents)
  if (filters.minAmount !== undefined || filters.maxAmount !== undefined) {
    where.amountCents = {}
    if (filters.minAmount !== undefined) {
      where.amountCents.gte = filters.minAmount
    }
    if (filters.maxAmount !== undefined) {
      where.amountCents.lte = filters.maxAmount
    }
  }

  // Date range filters
  if (filters.createdAfter || filters.createdBefore) {
    where.createdAt = {}
    if (filters.createdAfter) {
      where.createdAt.gte = filters.createdAfter
    }
    if (filters.createdBefore) {
      where.createdAt.lt = filters.createdBefore
    }
  }

  return where
}

/**
 * Subscription filter options
 */
export interface SubscriptionFilterOptions {
  status?: 'pending' | 'active' | 'canceled' | 'past_due' | 'paused'
  interval?: 'month' | 'one_time'
  provider?: 'stripe' | 'paystack'
  currency?: string
  creatorId?: string
  subscriberId?: string
  createdAfter?: Date
  createdBefore?: Date
}

/**
 * Build type-safe Subscription where clause
 */
export function buildSubscriptionWhere(filters: SubscriptionFilterOptions): Prisma.SubscriptionWhereInput {
  const where: Prisma.SubscriptionWhereInput = {}

  if (filters.status) {
    where.status = filters.status
  }

  if (filters.interval) {
    where.interval = filters.interval
  }

  // Provider detection
  if (filters.provider === 'stripe') {
    where.stripeSubscriptionId = { not: null }
  } else if (filters.provider === 'paystack') {
    where.paystackAuthorizationCode = { not: null }
  }

  if (filters.currency) {
    where.currency = filters.currency
  }

  if (filters.creatorId) {
    where.creatorId = filters.creatorId
  }

  if (filters.subscriberId) {
    where.subscriberId = filters.subscriberId
  }

  // Date range filters
  if (filters.createdAfter || filters.createdBefore) {
    where.createdAt = {}
    if (filters.createdAfter) {
      where.createdAt.gte = filters.createdAfter
    }
    if (filters.createdBefore) {
      where.createdAt.lt = filters.createdBefore
    }
  }

  return where
}

/**
 * Profile/Creator filter options
 */
export interface ProfileFilterOptions {
  search?: string
  country?: string
  currency?: string
  purpose?: 'tips' | 'support' | 'allowance' | 'fan_club' | 'exclusive_content' | 'service' | 'other'
  isPublic?: boolean
  hasStripeAccount?: boolean
  hasPaystackAccount?: boolean
  createdAfter?: Date
  createdBefore?: Date
}

/**
 * Build type-safe Profile where clause
 */
export function buildProfileWhere(filters: ProfileFilterOptions): Prisma.ProfileWhereInput {
  const where: Prisma.ProfileWhereInput = {}

  if (filters.search) {
    where.OR = [
      { username: { contains: filters.search, mode: 'insensitive' } },
      { displayName: { contains: filters.search, mode: 'insensitive' } },
      { user: { email: { contains: filters.search, mode: 'insensitive' } } },
    ]
  }

  if (filters.country) {
    where.country = filters.country
  }

  if (filters.currency) {
    where.currency = filters.currency
  }

  if (filters.purpose) {
    where.purpose = filters.purpose
  }

  if (filters.isPublic !== undefined) {
    where.isPublic = filters.isPublic
  }

  if (filters.hasStripeAccount !== undefined) {
    where.stripeAccountId = filters.hasStripeAccount ? { not: null } : null
  }

  if (filters.hasPaystackAccount !== undefined) {
    where.paystackSubaccountCode = filters.hasPaystackAccount ? { not: null } : null
  }

  // Date range filters
  if (filters.createdAfter || filters.createdBefore) {
    where.createdAt = {}
    if (filters.createdAfter) {
      where.createdAt.gte = filters.createdAfter
    }
    if (filters.createdBefore) {
      where.createdAt.lt = filters.createdBefore
    }
  }

  return where
}

/**
 * Webhook event filter options
 */
export interface WebhookEventFilterOptions {
  provider?: 'stripe' | 'paystack'
  status?: 'pending' | 'processed' | 'failed' | 'dead_letter' | 'pending_retry'
  eventType?: string
  createdAfter?: Date
  createdBefore?: Date
}

/**
 * Build type-safe WebhookEvent where clause
 */
export function buildWebhookEventWhere(filters: WebhookEventFilterOptions): Prisma.WebhookEventWhereInput {
  const where: Prisma.WebhookEventWhereInput = {}

  if (filters.provider) {
    where.provider = filters.provider
  }

  if (filters.status) {
    where.status = filters.status
  }

  if (filters.eventType) {
    where.eventType = filters.eventType
  }

  // Date range filters
  if (filters.createdAfter || filters.createdBefore) {
    where.createdAt = {}
    if (filters.createdAfter) {
      where.createdAt.gte = filters.createdAfter
    }
    if (filters.createdBefore) {
      where.createdAt.lt = filters.createdBefore
    }
  }

  return where
}

/**
 * Helper to detect payment provider from payment record
 */
export function getPaymentProvider(payment: {
  stripePaymentIntentId?: string | null
  stripeChargeId?: string | null
  paystackTransactionRef?: string | null
}): 'stripe' | 'paystack' | 'unknown' {
  if (payment.stripePaymentIntentId || payment.stripeChargeId) {
    return 'stripe'
  }
  if (payment.paystackTransactionRef) {
    return 'paystack'
  }
  return 'unknown'
}

/**
 * Helper to detect subscription provider from subscription record
 */
export function getSubscriptionProvider(subscription: {
  stripeSubscriptionId?: string | null
  paystackAuthorizationCode?: string | null
}): 'stripe' | 'paystack' | 'unknown' {
  if (subscription.stripeSubscriptionId) {
    return 'stripe'
  }
  if (subscription.paystackAuthorizationCode) {
    return 'paystack'
  }
  return 'unknown'
}
