/**
 * Admin Paystack Controller
 *
 * Paystack bank verification and account resolution routes.
 * Used for concierge creator creation.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { listBanks, resolveAccount, isPaystackSupported, verifyTransaction, type PaystackCountry } from '../../services/paystack.js'
import { handlePaystackChargeSuccess } from '../webhooks/paystack/charge.js'
import { adminSensitiveRateLimit } from '../../middleware/rateLimit.js'

const paystack = new Hono()

/**
 * GET /admin/paystack/banks/:country
 * List banks for a Paystack-supported country
 */
paystack.get('/banks/:country', async (c) => {
  const country = c.req.param('country').toUpperCase()

  if (!isPaystackSupported(country)) {
    return c.json({ error: 'Country not supported. Use NG, KE, or ZA.' }, 400)
  }

  try {
    const banks = await listBanks(country as PaystackCountry)
    return c.json({
      banks: banks.map(b => ({
        code: b.code,
        name: b.name,
        type: b.type,
      }))
    })
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch banks' }, 500)
  }
})

/**
 * POST /admin/paystack/resolve-account
 * Resolve/validate a bank account
 */
paystack.post('/resolve-account', adminSensitiveRateLimit, async (c) => {
  const body = z.object({
    country: z.enum(['NG', 'KE', 'ZA']),
    bankCode: z.string().min(1),
    accountNumber: z.string().min(9).max(20),
  }).parse(await c.req.json())

  if (body.country === 'KE') {
    return c.json({
      supported: false,
      message: 'Kenya does not support account resolution. Account will be validated on first payout.',
    })
  }

  try {
    const resolved = await resolveAccount(body.accountNumber, body.bankCode)
    return c.json({
      supported: true,
      accountName: resolved.account_name,
      accountNumber: resolved.account_number,
    })
  } catch (err: any) {
    return c.json({ error: err.message || 'Could not resolve account' }, 400)
  }
})

/**
 * POST /admin/paystack/reconcile
 * Manually reconcile a Paystack transaction that wasn't processed by webhook
 */
paystack.post('/reconcile', adminSensitiveRateLimit, async (c) => {
  const body = z.object({
    reference: z.string().min(1),
  }).parse(await c.req.json())

  const { reference } = body

  try {
    // Fetch transaction from Paystack
    const transaction = await verifyTransaction(reference)

    if (!transaction) {
      return c.json({ error: 'Transaction not found in Paystack' }, 404)
    }

    if (transaction.status !== 'success') {
      return c.json({
        error: `Transaction status is "${transaction.status}", not "success"`,
        transaction: {
          reference: transaction.reference,
          status: transaction.status,
          amount: transaction.amount,
          currency: transaction.currency,
        },
      }, 400)
    }

    // Check if already processed
    const existingPayment = await db.payment.findFirst({
      where: {
        OR: [
          { paystackTransactionRef: reference },
          { paystackEventId: `manual_${reference}` },
        ],
      },
      include: { subscription: true },
    })

    if (existingPayment) {
      return c.json({
        status: 'already_processed',
        payment: {
          id: existingPayment.id,
          subscriptionId: existingPayment.subscriptionId,
          amount: existingPayment.netCents,
          currency: existingPayment.currency,
          createdAt: existingPayment.createdAt,
        },
      })
    }

    // Check metadata
    const metadata = transaction.metadata as Record<string, any> | undefined
    if (!metadata?.creatorId) {
      return c.json({
        error: 'Transaction missing creatorId in metadata - not created by NatePay checkout',
        metadata,
      }, 400)
    }

    // Verify creator exists
    const creator = await db.user.findUnique({
      where: { id: metadata.creatorId },
      include: { profile: { select: { displayName: true, username: true } } },
    })

    if (!creator) {
      return c.json({ error: `Creator not found: ${metadata.creatorId}` }, 404)
    }

    // Process the transaction
    await handlePaystackChargeSuccess(
      {
        reference: transaction.reference,
        amount: transaction.amount,
        currency: transaction.currency,
        customer: transaction.customer,
        authorization: transaction.authorization,
        metadata: transaction.metadata,
        paid_at: transaction.paid_at,
      },
      `manual_${reference}`
    )

    // Verify it was created
    const payment = await db.payment.findFirst({
      where: { paystackTransactionRef: reference },
      include: { subscription: true },
    })

    if (payment) {
      return c.json({
        status: 'reconciled',
        payment: {
          id: payment.id,
          subscriptionId: payment.subscriptionId,
          subscriberId: payment.subscriberId,
          amount: payment.netCents,
          currency: payment.currency,
          createdAt: payment.createdAt,
        },
        creator: {
          id: creator.id,
          email: creator.email,
          displayName: creator.profile?.displayName,
        },
      })
    } else {
      return c.json({ error: 'Failed to create payment record' }, 500)
    }

  } catch (err: any) {
    console.error('[admin/paystack/reconcile] Error:', err)
    return c.json({ error: err.message || 'Reconciliation failed' }, 500)
  }
})

export default paystack
