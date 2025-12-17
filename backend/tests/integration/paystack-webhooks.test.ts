import { beforeEach, describe, expect, it, afterAll } from 'vitest'
import crypto from 'crypto'
import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { dbStorage } from '../setup.js'

function signPaystack(body: string): string {
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET
  if (!secret) throw new Error('PAYSTACK_WEBHOOK_SECRET missing in test env')
  return crypto.createHmac('sha512', secret).update(body).digest('hex')
}

async function sendPaystackWebhook(payload: any) {
  const body = JSON.stringify(payload)
  return app.fetch(
    new Request('http://localhost/webhooks/paystack', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': signPaystack(body),
      },
      body,
    })
  )
}

describe('paystack webhooks', () => {
  beforeEach(() => {
    Object.values(dbStorage).forEach((store) => store.clear())
  })

  afterAll(() => {
    Object.values(dbStorage).forEach((store) => store.clear())
  })

  it('processes transfer.success even when payout payment exists', async () => {
    const creator = await db.user.create({ data: { email: 'creator@test.com' } })

    const payout = await db.payment.create({
      data: {
        creatorId: creator.id,
        amountCents: 5000,
        currency: 'NGN',
        feeCents: 0,
        netCents: 5000,
        type: 'payout',
        status: 'pending',
        paystackTransactionRef: 'PAYOUT-TEST-1',
      },
    })

    const res = await sendPaystackWebhook({
      event: 'transfer.success',
      data: {
        reference: 'PAYOUT-TEST-1',
        amount: 5000,
        currency: 'NGN',
        recipient: { name: 'Test Recipient' },
      },
    })

    expect(res.status).toBe(200)

    const updated = await db.payment.findUnique({ where: { id: payout.id } })
    expect(updated?.status).toBe('succeeded')

    const webhookEvent = await db.webhookEvent.findUnique({
      where: { eventId: 'paystack_transfer.success_PAYOUT-TEST-1' },
    })
    expect(webhookEvent?.status).toBe('processed')
  })

  it('skips charge.success when payment already recorded', async () => {
    const creator = await db.user.create({ data: { email: 'creator@test.com' } })

    await db.payment.create({
      data: {
        creatorId: creator.id,
        amountCents: 1100,
        currency: 'NGN',
        feeCents: 100,
        netCents: 1000,
        type: 'recurring',
        status: 'succeeded',
        paystackTransactionRef: 'CHG-TEST-1',
      },
    })

    const res = await sendPaystackWebhook({
      event: 'charge.success',
      data: {
        reference: 'CHG-TEST-1',
        amount: 1100,
        currency: 'NGN',
      },
    })

    expect(res.status).toBe(200)

    const payments = await db.payment.findMany({})
    expect(payments.length).toBe(1)

    const webhookEvent = await db.webhookEvent.findUnique({
      where: { eventId: 'paystack_charge.success_CHG-TEST-1' },
    })
    expect(webhookEvent?.status).toBe('skipped')
  })
})
