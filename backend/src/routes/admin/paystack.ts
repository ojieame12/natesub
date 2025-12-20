/**
 * Admin Paystack Controller
 *
 * Paystack bank verification and account resolution routes.
 * Used for concierge creator creation.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { listBanks, resolveAccount, isPaystackSupported, type PaystackCountry } from '../../services/paystack.js'
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

export default paystack
