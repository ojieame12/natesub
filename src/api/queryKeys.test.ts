import { describe, it, expect } from 'vitest'
import { queryKeys, adminQueryKeys } from './queryKeys'

describe('queryKeys factory', () => {
  describe('user keys', () => {
    it('provides currentUser key', () => {
      expect(queryKeys.currentUser).toEqual(['currentUser'])
    })

    it('provides profile key', () => {
      expect(queryKeys.profile).toEqual(['profile'])
    })

    it('provides settings key', () => {
      expect(queryKeys.settings).toEqual(['settings'])
    })

    it('provides publicProfile with username', () => {
      expect(queryKeys.publicProfile('johndoe')).toEqual(['publicProfile', 'johndoe'])
    })

    it('provides checkUsername with username', () => {
      expect(queryKeys.checkUsername('testuser')).toEqual(['checkUsername', 'testuser'])
    })
  })

  describe('subscriptions keys', () => {
    it('provides subscriptions.all', () => {
      expect(queryKeys.subscriptions.all).toEqual(['subscriptions'])
    })

    it('provides subscriptions.list with optional status', () => {
      expect(queryKeys.subscriptions.list()).toEqual(['subscriptions', undefined])
      expect(queryKeys.subscriptions.list('active')).toEqual(['subscriptions', 'active'])
    })

    it('provides subscriptions.myAll for invalidation', () => {
      expect(queryKeys.subscriptions.myAll).toEqual(['mySubscriptions'])
    })

    it('provides subscriptions.my with optional status', () => {
      expect(queryKeys.subscriptions.my()).toEqual(['mySubscriptions', undefined])
      expect(queryKeys.subscriptions.my('active')).toEqual(['mySubscriptions', 'active'])
    })

    it('provides subscriptions.detail with id', () => {
      expect(queryKeys.subscriptions.detail('sub-123')).toEqual(['subscription', 'sub-123'])
    })
  })

  describe('stripe keys', () => {
    it('provides stripe.status', () => {
      expect(queryKeys.stripe.status).toEqual(['stripeStatus'])
    })

    it('provides stripe.balance', () => {
      expect(queryKeys.stripe.balance).toEqual(['stripeBalance'])
    })
  })

  describe('paystack keys', () => {
    it('provides paystack.status', () => {
      expect(queryKeys.paystack.status).toEqual(['paystackStatus'])
    })

    it('provides paystack.banks with country', () => {
      expect(queryKeys.paystack.banks('NG')).toEqual(['paystackBanks', 'NG'])
    })
  })
})

describe('adminQueryKeys factory', () => {
  describe('core admin keys', () => {
    it('provides admin me key', () => {
      expect(adminQueryKeys.me).toEqual(['admin', 'me'])
    })

    it('provides dashboard key', () => {
      expect(adminQueryKeys.dashboard).toEqual(['admin', 'dashboard'])
    })

    it('provides health key', () => {
      expect(adminQueryKeys.health).toEqual(['admin', 'health'])
    })
  })

  describe('support keys', () => {
    it('provides support.all', () => {
      expect(adminQueryKeys.support.all).toEqual(['admin', 'support'])
    })

    it('provides support.stats', () => {
      expect(adminQueryKeys.support.stats).toEqual(['admin', 'support', 'stats'])
    })

    it('provides support.ticket with id', () => {
      expect(adminQueryKeys.support.ticket('ticket-abc')).toEqual(['admin', 'support', 'ticket', 'ticket-abc'])
    })

    it('provides support.tickets with filters', () => {
      expect(adminQueryKeys.support.tickets({ status: 'open' })).toEqual([
        'admin', 'support', 'tickets', { status: 'open' }
      ])
    })
  })

  describe('webhooks keys', () => {
    it('provides webhooks.all', () => {
      expect(adminQueryKeys.webhooks.all).toEqual(['admin', 'webhooks'])
    })

    it('provides webhooks.stats', () => {
      expect(adminQueryKeys.webhooks.stats).toEqual(['admin', 'webhooks', 'stats'])
    })

    it('provides webhooks.failed', () => {
      expect(adminQueryKeys.webhooks.failed).toEqual(['admin', 'webhooks', 'failed'])
    })
  })

  describe('disputes keys', () => {
    it('provides disputes.all', () => {
      expect(adminQueryKeys.disputes.all).toEqual(['admin', 'disputes'])
    })

    it('provides disputes.stats', () => {
      expect(adminQueryKeys.disputes.stats).toEqual(['admin', 'disputes', 'stats'])
    })
  })

  describe('reconciliation keys', () => {
    it('provides reconciliation.all for invalidation', () => {
      expect(adminQueryKeys.reconciliation.all).toEqual(['admin', 'reconciliation'])
    })

    it('provides reconciliation.paystackMissing with hours', () => {
      expect(adminQueryKeys.reconciliation.paystackMissing(48)).toEqual([
        'admin', 'reconciliation', 'paystack-missing', 48
      ])
    })

    it('provides reconciliation.stripeMissing with limit', () => {
      expect(adminQueryKeys.reconciliation.stripeMissing(20)).toEqual([
        'admin', 'reconciliation', 'stripe-missing', 20
      ])
    })
  })

  describe('blockedSubscribers key', () => {
    it('provides blockedSubscribers key', () => {
      expect(adminQueryKeys.blockedSubscribers).toEqual(['admin', 'blocked-subscribers'])
    })
  })

  describe('users keys', () => {
    it('provides users.all', () => {
      expect(adminQueryKeys.users.all).toEqual(['admin', 'users'])
    })

    it('provides users.list with params', () => {
      expect(adminQueryKeys.users.list({ page: 1 })).toEqual(['admin', 'users', { page: 1 }])
    })
  })

  describe('payments keys', () => {
    it('provides payments.all', () => {
      expect(adminQueryKeys.payments.all).toEqual(['admin', 'payments'])
    })

    it('provides payments.list with params', () => {
      expect(adminQueryKeys.payments.list({ status: 'succeeded' })).toEqual([
        'admin', 'payments', { status: 'succeeded' }
      ])
    })
  })
})

describe('key uniqueness', () => {
  it('all user queryKeys top-level keys are unique', () => {
    const allKeys = [
      queryKeys.currentUser,
      queryKeys.profile,
      queryKeys.settings,
      queryKeys.metrics,
      queryKeys.payouts,
      queryKeys.aiStatus,
      queryKeys.stripe.all,
      queryKeys.paystack.all,
      queryKeys.subscriptions.all,
      queryKeys.activity.all,
      queryKeys.requests.all,
      queryKeys.updates.all,
      queryKeys.payroll.all,
      queryKeys.analytics.all,
      queryKeys.billing.all,
    ]
    const stringified = allKeys.map(k => JSON.stringify(k))
    expect(new Set(stringified).size).toBe(allKeys.length)
  })

  it('all admin top-level keys are unique', () => {
    const allKeys = [
      adminQueryKeys.all,
      adminQueryKeys.me,
      adminQueryKeys.dashboard,
      adminQueryKeys.health,
      adminQueryKeys.blockedSubscribers,
      adminQueryKeys.revenue.all,
      adminQueryKeys.users.all,
      adminQueryKeys.payments.all,
      adminQueryKeys.subscriptions.all,
      adminQueryKeys.logs.all,
      adminQueryKeys.reminders.all,
      adminQueryKeys.webhooks.all,
      adminQueryKeys.disputes.all,
      adminQueryKeys.reconciliation.all,
      adminQueryKeys.creators.all,
      adminQueryKeys.subscribers.all,
      adminQueryKeys.tax.all,
      adminQueryKeys.refunds.all,
      adminQueryKeys.support.all,
      adminQueryKeys.stripe.all,
      adminQueryKeys.admins.all,
    ]
    const stringified = allKeys.map(k => JSON.stringify(k))
    expect(new Set(stringified).size).toBe(allKeys.length)
  })
})
