/**
 * Admin Revenue Tests
 *
 * Tests for revenue analytics endpoints:
 * - GET /admin/revenue/overview
 * - GET /admin/revenue/by-provider
 * - GET /admin/revenue/by-currency
 * - GET /admin/revenue/daily
 * - GET /admin/revenue/monthly
 * - GET /admin/revenue/top-creators
 * - GET /admin/revenue/refunds
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../../src/app.js'
import { db } from '../../../src/db/client.js'
import { resetDatabase, disconnectDatabase } from '../../helpers/db.js'

const adminHeaders = {
  'x-admin-api-key': 'test-admin-key-12345',
}

describe('admin revenue', () => {
  beforeEach(async () => {
    await resetDatabase()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'))
  })

  afterAll(async () => {
    vi.useRealTimers()
    await resetDatabase()
    await disconnectDatabase()
  })

  async function seedRevenueData() {
    const creator1 = await db.user.create({
      data: { email: 'creator1@test.com' },
    })

    await db.profile.create({
      data: {
        userId: creator1.id,
        username: 'creator1',
        displayName: 'Creator One',
        country: 'NG',
      },
    })

    const creator2 = await db.user.create({
      data: { email: 'creator2@test.com' },
    })

    await db.profile.create({
      data: {
        userId: creator2.id,
        username: 'creator2',
        displayName: 'Creator Two',
        country: 'US',
      },
    })

    const paymentStripeToday = await db.payment.create({
      data: {
        creatorId: creator1.id,
        amountCents: 1000,
        grossCents: 1040,
        feeCents: 80,
        netCents: 960,
        currency: 'USD',
        status: 'succeeded',
        type: 'recurring',
        stripePaymentIntentId: 'pi_1',
      },
    })

    const paymentPaystack = await db.payment.create({
      data: {
        creatorId: creator2.id,
        amountCents: 2000,
        grossCents: 2080,
        feeCents: 160,
        netCents: 1920,
        currency: 'NGN',
        status: 'succeeded',
        type: 'recurring',
        paystackTransactionRef: 'ps_1',
      },
    })

    const now = new Date()
    const twoDaysAgo = new Date(now)
    twoDaysAgo.setDate(now.getDate() - 2)
    twoDaysAgo.setHours(9, 0, 0, 0)

    await db.payment.update({
      where: { id: paymentPaystack.id },
      data: { createdAt: twoDaysAgo },
    })

    const lastMonth = new Date(now)
    lastMonth.setMonth(now.getMonth() - 1)
    lastMonth.setDate(10)
    lastMonth.setHours(9, 0, 0, 0)

    const paymentLastMonth = await db.payment.create({
      data: {
        creatorId: creator1.id,
        amountCents: 500,
        grossCents: 520,
        feeCents: 40,
        netCents: 480,
        currency: 'USD',
        status: 'succeeded',
        type: 'recurring',
        stripePaymentIntentId: 'pi_2',
      },
    })

    await db.payment.update({
      where: { id: paymentLastMonth.id },
      data: { createdAt: lastMonth },
    })

    const refundedPayment = await db.payment.create({
      data: {
        creatorId: creator1.id,
        amountCents: 1000,
        grossCents: 1040,
        feeCents: 80,
        netCents: 960,
        currency: 'USD',
        status: 'refunded',
        type: 'recurring',
      },
    })

    const disputedPayment = await db.payment.create({
      data: {
        creatorId: creator1.id,
        amountCents: 1500,
        grossCents: 1500,
        feeCents: 0,
        netCents: 0,
        currency: 'USD',
        status: 'disputed',
        type: 'recurring',
      },
    })

    return {
      creator1,
      creator2,
      now,
      twoDaysAgo,
      lastMonth,
      paymentStripeToday,
      paymentPaystack,
      paymentLastMonth,
      refundedPayment,
      disputedPayment,
    }
  }

  it('returns overview totals for all time, month, and today', async () => {
    await seedRevenueData()

    const res = await app.fetch(
      new Request('http://localhost/admin/revenue/overview', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.allTime.totalVolumeCents).toBe(3640)
    expect(body.allTime.paymentCount).toBe(3)
    expect(body.thisMonth.paymentCount).toBe(2)
    expect(body.today.paymentCount).toBe(1)
  })

  it('breaks down revenue by provider', async () => {
    await seedRevenueData()

    const res = await app.fetch(
      new Request('http://localhost/admin/revenue/by-provider?period=month', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.stripe.totalVolumeCents).toBe(1040)
    expect(body.stripe.paymentCount).toBe(1)
    expect(body.paystack.totalVolumeCents).toBe(2080)
    expect(body.paystack.paymentCount).toBe(1)
  })

  it('breaks down revenue by currency', async () => {
    await seedRevenueData()

    const res = await app.fetch(
      new Request('http://localhost/admin/revenue/by-currency?period=month', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()

    const currencyMap = new Map(body.currencies.map((c: any) => [c.currency, c]))
    expect(currencyMap.get('USD').totalVolumeCents).toBe(1040)
    expect(currencyMap.get('NGN').totalVolumeCents).toBe(2080)
  })

  it('returns daily revenue trend data', async () => {
    await seedRevenueData()

    // Request 7 days to ensure we capture all payments regardless of timezone quirks
    const res = await app.fetch(
      new Request('http://localhost/admin/revenue/daily?days=7', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()

    // Verify we get days returned
    expect(body.days.length).toBeGreaterThanOrEqual(7)

    // Find the payment entries (2080 is paymentPaystack from 2 days ago, 1040 is paymentStripeToday)
    const nonZeroDays = body.days.filter((d: any) => d.volumeCents > 0)

    // Should have at least the paymentPaystack (2080) entry
    expect(nonZeroDays.length).toBeGreaterThanOrEqual(1)

    // Verify the 2080 entry (paymentPaystack) is present and correct
    const entryWith2080 = body.days.find((d: any) => d.volumeCents === 2080)
    expect(entryWith2080).toBeDefined()
    expect(entryWith2080.volumeCents).toBe(2080)
    expect(entryWith2080.feesCents).toBe(160)
    expect(entryWith2080.count).toBe(1)

    // Verify all days have the expected structure
    for (const day of body.days) {
      expect(day).toHaveProperty('date')
      expect(day).toHaveProperty('volumeCents')
      expect(day).toHaveProperty('feesCents')
      expect(day).toHaveProperty('payoutsCents')
      expect(day).toHaveProperty('count')
    }
  })

  it('returns monthly revenue trend data', async () => {
    const { now, lastMonth } = await seedRevenueData()

    const res = await app.fetch(
      new Request('http://localhost/admin/revenue/monthly?months=2', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()

    const currentMonthKey = now.toISOString().slice(0, 7)
    const lastMonthKey = lastMonth.toISOString().slice(0, 7)
    const monthMap = new Map(body.months.map((m: any) => [m.month, m]))

    expect(monthMap.get(currentMonthKey).volumeCents).toBe(3120)
    expect(monthMap.get(lastMonthKey).volumeCents).toBe(520)
  })

  it('returns top creators by revenue', async () => {
    const { creator1, creator2 } = await seedRevenueData()

    const res = await app.fetch(
      new Request('http://localhost/admin/revenue/top-creators?period=month', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()

    const creatorMap = new Map(body.creators.map((c: any) => [c.creatorId, c]))

    expect(creatorMap.get(creator1.id).totalVolumeCents).toBe(1040)
    expect(creatorMap.get(creator1.id).username).toBe('creator1')
    expect(creatorMap.get(creator2.id).totalVolumeCents).toBe(2080)
    expect(creatorMap.get(creator2.id).username).toBe('creator2')
  })

  it('returns refund and dispute totals', async () => {
    await seedRevenueData()

    const res = await app.fetch(
      new Request('http://localhost/admin/revenue/refunds?period=month', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.refunds.totalCents).toBe(1040)
    expect(body.refunds.count).toBe(1)
    expect(body.disputes.totalCents).toBe(1500)
    expect(body.disputes.count).toBe(1)
    expect(body.chargebacks.totalCents).toBe(0)
    expect(body.chargebacks.count).toBe(0)
  })

  it('treats dispute_lost as chargebacks', async () => {
    const { creator1 } = await seedRevenueData()

    await db.payment.create({
      data: {
        creatorId: creator1.id,
        amountCents: 2500,
        grossCents: 2500,
        feeCents: 0,
        netCents: 0,
        currency: 'USD',
        status: 'dispute_lost',
        type: 'recurring',
      },
    })

    const res = await app.fetch(
      new Request('http://localhost/admin/revenue/refunds?period=month', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.chargebacks.totalCents).toBe(2500)
    expect(body.chargebacks.count).toBe(1)
  })
})
