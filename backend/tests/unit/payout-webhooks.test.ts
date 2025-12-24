/**
 * Payout Webhook Handler Tests
 *
 * Tests for Stripe payout webhook handling (payout.created, payout.paid, payout.failed).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { db } from '../../src/db/client'
import { redis } from '../../src/db/redis'
import {
  handlePayoutCreated,
  handlePayoutPaid,
  handlePayoutFailed,
} from '../../src/routes/webhooks/stripe/payout'
import { PAYOUT_STATUS } from '../../src/services/balanceSync'
import * as balanceSync from '../../src/services/balanceSync'
import * as notifications from '../../src/services/notifications'
import * as slack from '../../src/services/slack'
import type Stripe from 'stripe'

describe('payout webhooks', () => {
  const mockProfileId = 'profile-123'
  const mockUserId = 'user-123'
  const mockAccountId = 'acct_test123'

  const mockPayout: Partial<Stripe.Payout> = {
    id: 'po_123',
    amount: 10000,
    currency: 'usd',
    created: Math.floor(Date.now() / 1000),
    arrival_date: Math.floor(Date.now() / 1000) + 86400, // +1 day
    method: 'standard',
    status: 'pending',
    failure_code: null,
    failure_message: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock profile lookup
    ;(db.profile.findFirst as any).mockResolvedValue({
      id: mockProfileId,
      userId: mockUserId,
      stripeAccountId: mockAccountId,
      displayName: 'Test Creator',
    })

    // Mock profile update
    ;(db.profile.update as any).mockResolvedValue({})

    // Mock activity creation
    ;(db.activity.create as any).mockResolvedValue({ id: 'activity-123' })

    // Mock payment lookup (for idempotency check)
    ;(db.payment.findFirst as any).mockResolvedValue(null)

    // Mock payment creation
    ;(db.payment.create as any).mockResolvedValue({ id: 'payment-123' })

    // Mock user lookup
    ;(db.user.findUnique as any).mockResolvedValue({ email: 'test@example.com' })

    // Mock balance sync
    vi.spyOn(balanceSync, 'syncCreatorBalance').mockResolvedValue({
      available: 0,
      pending: 10000,
      currency: 'USD',
    })

    // Mock notifications
    vi.spyOn(notifications, 'notifyPayoutFailed').mockResolvedValue()

    // Mock Slack
    vi.spyOn(slack, 'alertPayoutFailed').mockResolvedValue()

    // Mock Redis for balance sync locks
    ;(redis.get as any).mockResolvedValue(null)
    ;(redis.set as any).mockResolvedValue('OK')
    ;(redis.del as any).mockResolvedValue(1)
    ;(redis.setex as any).mockResolvedValue('OK')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('handlePayoutCreated', () => {
    it('updates profile with pending payout status', async () => {
      const event = {
        id: 'evt_123',
        type: 'payout.created',
        account: mockAccountId,
        data: { object: mockPayout },
      } as Stripe.Event

      await handlePayoutCreated(event)

      expect(db.profile.update).toHaveBeenCalledWith({
        where: { id: mockProfileId },
        data: expect.objectContaining({
          lastPayoutAmountCents: 10000,
          lastPayoutStatus: PAYOUT_STATUS.PENDING,
        }),
      })
    })

    it('creates payout_initiated activity', async () => {
      const event = {
        id: 'evt_123',
        type: 'payout.created',
        account: mockAccountId,
        data: { object: mockPayout },
      } as Stripe.Event

      await handlePayoutCreated(event)

      expect(db.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockUserId,
          type: 'payout_initiated',
          payload: expect.objectContaining({
            payoutId: 'po_123',
            amount: 10000,
            currency: 'USD',
          }),
        }),
      })
    })

    it('triggers balance sync with force=true', async () => {
      const event = {
        id: 'evt_123',
        type: 'payout.created',
        account: mockAccountId,
        data: { object: mockPayout },
      } as Stripe.Event

      await handlePayoutCreated(event)

      expect(balanceSync.syncCreatorBalance).toHaveBeenCalledWith(mockUserId, true)
    })

    it('handles missing profile gracefully', async () => {
      ;(db.profile.findFirst as any).mockResolvedValue(null)

      const event = {
        id: 'evt_123',
        type: 'payout.created',
        account: mockAccountId,
        data: { object: mockPayout },
      } as Stripe.Event

      await expect(handlePayoutCreated(event)).resolves.not.toThrow()

      expect(db.profile.update).not.toHaveBeenCalled()
    })
  })

  describe('handlePayoutPaid', () => {
    it('creates a Payment record with type=payout', async () => {
      const paidPayout = { ...mockPayout, status: 'paid' }
      const event = {
        id: 'evt_123',
        type: 'payout.paid',
        account: mockAccountId,
        data: { object: paidPayout },
      } as Stripe.Event

      await handlePayoutPaid(event)

      expect(db.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          creatorId: mockUserId,
          type: 'payout',
          status: 'succeeded',
          amountCents: 10000,
          currency: 'USD',
        }),
      })
    })

    it('updates profile with paid status', async () => {
      const paidPayout = { ...mockPayout, status: 'paid' }
      const event = {
        id: 'evt_123',
        type: 'payout.paid',
        account: mockAccountId,
        data: { object: paidPayout },
      } as Stripe.Event

      await handlePayoutPaid(event)

      expect(db.profile.update).toHaveBeenCalledWith({
        where: { id: mockProfileId },
        data: expect.objectContaining({
          payoutStatus: 'active',
          lastPayoutStatus: PAYOUT_STATUS.PAID,
        }),
      })
    })

    it('is idempotent - skips if payment already recorded', async () => {
      ;(db.payment.findFirst as any).mockResolvedValue({ id: 'existing-payment' })

      const event = {
        id: 'evt_123',
        type: 'payout.paid',
        account: mockAccountId,
        data: { object: mockPayout },
      } as Stripe.Event

      await handlePayoutPaid(event)

      expect(db.payment.create).not.toHaveBeenCalled()
    })

    it('creates payout_completed activity', async () => {
      const event = {
        id: 'evt_123',
        type: 'payout.paid',
        account: mockAccountId,
        data: { object: mockPayout },
      } as Stripe.Event

      await handlePayoutPaid(event)

      expect(db.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'payout_completed',
        }),
      })
    })
  })

  describe('handlePayoutFailed', () => {
    it('updates profile with failed status and restricted payout', async () => {
      const failedPayout = {
        ...mockPayout,
        status: 'failed',
        failure_code: 'account_closed',
        failure_message: 'Bank account closed',
      }
      const event = {
        id: 'evt_123',
        type: 'payout.failed',
        account: mockAccountId,
        data: { object: failedPayout },
      } as Stripe.Event

      await handlePayoutFailed(event)

      expect(db.profile.update).toHaveBeenCalledWith({
        where: { id: mockProfileId },
        data: {
          payoutStatus: 'restricted',
          lastPayoutStatus: PAYOUT_STATUS.FAILED,
        },
      })
    })

    it('creates payout_failed activity with failure details', async () => {
      const failedPayout = {
        ...mockPayout,
        failure_code: 'account_closed',
        failure_message: 'Bank account closed',
      }
      const event = {
        id: 'evt_123',
        type: 'payout.failed',
        account: mockAccountId,
        data: { object: failedPayout },
      } as Stripe.Event

      await handlePayoutFailed(event)

      expect(db.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'payout_failed',
          payload: expect.objectContaining({
            failureCode: 'account_closed',
            failureMessage: 'Bank account closed',
          }),
        }),
      })
    })

    it('sends notification to creator', async () => {
      const failedPayout = {
        ...mockPayout,
        failure_message: 'Bank account closed',
      }
      const event = {
        id: 'evt_123',
        type: 'payout.failed',
        account: mockAccountId,
        data: { object: failedPayout },
      } as Stripe.Event

      await handlePayoutFailed(event)

      expect(notifications.notifyPayoutFailed).toHaveBeenCalledWith(
        mockUserId,
        10000,
        'USD'
      )
    })

    it('alerts ops team via Slack', async () => {
      const failedPayout = {
        ...mockPayout,
        failure_message: 'Bank account closed',
      }
      const event = {
        id: 'evt_123',
        type: 'payout.failed',
        account: mockAccountId,
        data: { object: failedPayout },
      } as Stripe.Event

      await handlePayoutFailed(event)

      expect(slack.alertPayoutFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          creatorEmail: 'test@example.com',
          creatorName: 'Test Creator',
          amount: 10000,
          currency: 'USD',
          error: 'Bank account closed',
          stripePayoutId: 'po_123',
        })
      )
    })
  })
})
