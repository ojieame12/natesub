import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sign } from 'hono/jwt'

vi.mock('../../src/services/stripe.js', () => ({
  cancelSubscription: vi.fn(),
  reactivateSubscription: vi.fn(),
  createSubscriberPortalSession: vi.fn(),
}))

vi.mock('../../src/services/systemLog.js', () => ({
  logSubscriptionEvent: vi.fn().mockResolvedValue(undefined),
}))

import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { dbStorage } from '../setup.js'
import { cancelSubscription, reactivateSubscription } from '../../src/services/stripe.js'

const SUBSCRIBER_SESSION_SECRET = process.env.JWT_SECRET + '_subscriber_portal'

const mockCancelSubscription = vi.mocked(cancelSubscription)
const mockReactivateSubscription = vi.mocked(reactivateSubscription)

async function createSubscriberSession(email: string): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  return sign(
    { email, type: 'subscriber_portal', exp: expiresAt },
    SUBSCRIBER_SESSION_SECRET
  )
}

function subscriberRequest(path: string, token: string, body: Record<string, unknown> = {}) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `subscriber_session=${token}`,
      },
      body: JSON.stringify(body),
    })
  )
}

describe('Subscriber portal compensation branches', () => {
  beforeEach(() => {
    Object.values(dbStorage).forEach(store => store.clear())
    vi.clearAllMocks()
  })

  it('compensates Stripe cancel when DB update fails', async () => {
    const userId = 'sub_user_cancel'
    const creatorId = 'creator_cancel'
    const subId = 'sub_compensate_cancel'

    dbStorage.users.set(userId, { id: userId, email: 'cancel@test.com', role: 'user' })
    dbStorage.users.set(creatorId, { id: creatorId, email: 'creator@test.com', role: 'creator' })
    dbStorage.profiles.set(creatorId, {
      id: 'profile_cancel',
      userId: creatorId,
      displayName: 'Creator Cancel',
      username: 'creator-cancel',
    })
    dbStorage.subscriptions.set(subId, {
      id: subId,
      subscriberId: userId,
      creatorId,
      status: 'active',
      amount: 1000,
      currency: 'USD',
      cancelAtPeriodEnd: false,
      stripeSubscriptionId: 'sub_stripe_cancel',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    mockCancelSubscription.mockResolvedValue({
      status: 'active',
      cancelAtPeriodEnd: true,
      canceledAt: new Date(),
    })
    mockReactivateSubscription.mockResolvedValue({
      status: 'active',
      cancelAtPeriodEnd: false,
    })

    const updateSpy = vi.spyOn(db.subscription, 'update').mockRejectedValueOnce(new Error('DB write failed'))
    const token = await createSubscriberSession('cancel@test.com')
    const res = await subscriberRequest(`/subscriber/subscriptions/${subId}/cancel`, token)

    expect(res.status).toBe(500)
    expect(mockCancelSubscription).toHaveBeenCalledWith('sub_stripe_cancel', true)
    expect(mockReactivateSubscription).toHaveBeenCalledWith('sub_stripe_cancel')

    updateSpy.mockRestore()
  })

  it('compensates Stripe reactivate when DB update fails', async () => {
    const userId = 'sub_user_reactivate'
    const creatorId = 'creator_reactivate'
    const subId = 'sub_compensate_reactivate'

    dbStorage.users.set(userId, { id: userId, email: 'reactivate@test.com', role: 'user' })
    dbStorage.users.set(creatorId, { id: creatorId, email: 'creator2@test.com', role: 'creator' })
    dbStorage.profiles.set(creatorId, {
      id: 'profile_reactivate',
      userId: creatorId,
      displayName: 'Creator Reactivate',
      username: 'creator-reactivate',
    })
    dbStorage.subscriptions.set(subId, {
      id: subId,
      subscriberId: userId,
      creatorId,
      status: 'active',
      amount: 1000,
      currency: 'USD',
      cancelAtPeriodEnd: true,
      stripeSubscriptionId: 'sub_stripe_reactivate',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    mockReactivateSubscription.mockResolvedValue({
      status: 'active',
      cancelAtPeriodEnd: false,
    })
    mockCancelSubscription.mockResolvedValue({
      status: 'active',
      cancelAtPeriodEnd: true,
      canceledAt: new Date(),
    })

    const updateSpy = vi.spyOn(db.subscription, 'update').mockRejectedValueOnce(new Error('DB write failed'))
    const token = await createSubscriberSession('reactivate@test.com')
    const res = await subscriberRequest(`/subscriber/subscriptions/${subId}/reactivate`, token)

    expect(res.status).toBe(500)
    expect(mockReactivateSubscription).toHaveBeenCalledWith('sub_stripe_reactivate')
    expect(mockCancelSubscription).toHaveBeenCalledWith('sub_stripe_reactivate', true)

    updateSpy.mockRestore()
  })
})
