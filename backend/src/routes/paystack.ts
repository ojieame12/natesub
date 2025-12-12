import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import {
  listBanks,
  resolveAccount,
  validateAccount,
  createSubaccount,
  getSubaccount,
  isPaystackSupported,
  PAYSTACK_COUNTRIES,
  type PaystackCountry,
} from '../services/paystack.js'
import { maskAccountNumber } from '../utils/pii.js'

const paystackRoutes = new Hono()

// Country to currency mapping
const PAYSTACK_CURRENCIES: Record<PaystackCountry, string> = {
  NG: 'NGN',
  KE: 'KES',
  ZA: 'ZAR',
}

// Get supported countries for Paystack
paystackRoutes.get('/supported-countries', async (c) => {
  const countries = PAYSTACK_COUNTRIES.map(code => ({
    code,
    name: code === 'NG' ? 'Nigeria' : code === 'KE' ? 'Kenya' : 'South Africa',
    currency: PAYSTACK_CURRENCIES[code],
  }))

  return c.json({
    countries,
    total: countries.length,
  })
})

// List banks for a country
paystackRoutes.get('/banks/:country', requireAuth, async (c) => {
  const country = c.req.param('country').toUpperCase()

  if (!isPaystackSupported(country)) {
    return c.json({ error: 'Country not supported by Paystack' }, 400)
  }

  try {
    const banks = await listBanks(country as PaystackCountry)
    return c.json({
      banks: banks.map(bank => ({
        code: bank.code,
        name: bank.name,
        type: bank.type,
      })),
    })
  } catch (error) {
    console.error('List banks error:', error)
    return c.json({ error: 'Failed to list banks' }, 500)
  }
})

// Resolve/verify bank account
paystackRoutes.post(
  '/resolve-account',
  requireAuth,
  zValidator(
    'json',
    z.object({
      accountNumber: z.string().min(10).max(20),
      bankCode: z.string(),
      // For South Africa, requires ID verification
      idNumber: z.string().optional(),
      accountType: z.enum(['personal', 'business']).optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId')
    const data = c.req.valid('json')

    const profile = await db.profile.findUnique({ where: { userId } })

    if (!profile) {
      return c.json({ error: 'Profile not found' }, 400)
    }

    const countryCode = profile.countryCode

    if (!isPaystackSupported(countryCode)) {
      return c.json({ error: 'Country not supported by Paystack' }, 400)
    }

    try {
      // South Africa requires ID-based validation
      if (countryCode === 'ZA') {
        if (!data.idNumber) {
          return c.json({
            error: 'South African ID number required for account verification',
          }, 400)
        }

        const result = await validateAccount(
          data.accountNumber,
          data.bankCode,
          data.accountType || 'personal',
          'identityNumber',
          data.idNumber
        )

        return c.json({
          verified: result.verified,
          accountName: result.account_name,
          accountNumber: data.accountNumber,
          bankCode: data.bankCode,
        })
      }

      // Nigeria and Kenya use standard resolve
      const result = await resolveAccount(data.accountNumber, data.bankCode)

      return c.json({
        verified: true,
        accountName: result.account_name,
        accountNumber: result.account_number,
        bankCode: data.bankCode,
      })
    } catch (error: any) {
      // Log without exposing full account number
      console.error(`[paystack] Resolve account error for ${maskAccountNumber(data.accountNumber)}:`, error.message)
      return c.json({
        error: error.message || 'Failed to verify bank account',
        verified: false,
      }, 400)
    }
  }
)

// Connect Paystack (create subaccount)
paystackRoutes.post(
  '/connect',
  requireAuth,
  zValidator(
    'json',
    z.object({
      bankCode: z.string(),
      accountNumber: z.string().min(10).max(20),
      accountName: z.string().min(2), // Verified name from resolve
      // For South Africa
      idNumber: z.string().optional(),
    })
  ),
  async (c) => {
    const userId = c.get('userId')
    const data = c.req.valid('json')

    // Get user and profile
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    })

    if (!user?.profile) {
      return c.json({ error: 'Profile not found. Complete onboarding first.' }, 400)
    }

    // Validate country is supported by Paystack
    if (!isPaystackSupported(user.profile.countryCode)) {
      return c.json({
        error: 'Paystack is not available in your country',
        countryCode: user.profile.countryCode,
        supportedCountries: PAYSTACK_COUNTRIES,
      }, 400)
    }

    // Validate currency matches country
    const expectedCurrency = PAYSTACK_CURRENCIES[user.profile.countryCode as PaystackCountry]
    if (user.profile.currency !== expectedCurrency) {
      return c.json({
        error: `Currency mismatch. Your profile currency is ${user.profile.currency}, but Paystack in ${user.profile.countryCode} only supports ${expectedCurrency}`,
      }, 400)
    }

    // Check if already connected
    if (user.profile.paystackSubaccountCode) {
      return c.json({
        success: true,
        alreadyConnected: true,
        message: 'Payments already connected via Paystack',
      })
    }

    try {
      // Create subaccount
      const result = await createSubaccount({
        userId,
        businessName: user.profile.displayName,
        bankCode: data.bankCode,
        accountNumber: data.accountNumber,
        email: user.email,
      })

      // Store verified account name
      await db.profile.update({
        where: { userId },
        data: {
          paystackAccountName: data.accountName,
        },
      })

      return c.json({
        success: true,
        subaccountCode: result.subaccountCode,
        message: 'Payment account connected successfully',
      })
    } catch (error: any) {
      console.error('Paystack Connect error:', error)
      return c.json({
        error: error.message || 'Failed to create payment account',
      }, 500)
    }
  }
)

// Get Paystack connection status
paystackRoutes.get('/connect/status', requireAuth, async (c) => {
  const userId = c.get('userId')

  const profile = await db.profile.findUnique({ where: { userId } })

  if (!profile?.paystackSubaccountCode) {
    return c.json({
      connected: false,
      status: 'not_started',
    })
  }

  try {
    const subaccount = await getSubaccount(profile.paystackSubaccountCode)

    return c.json({
      connected: true,
      status: subaccount.active ? 'active' : 'inactive',
      details: {
        businessName: subaccount.business_name,
        bank: subaccount.settlement_bank,
        accountNumber: profile.paystackAccountNumber,
        accountName: profile.paystackAccountName,
        percentageCharge: subaccount.percentage_charge,
      },
    })
  } catch (error) {
    console.error('Paystack status error:', error)
    return c.json({ error: 'Failed to check status' }, 500)
  }
})

// Disconnect Paystack (deactivate subaccount) - for future use
paystackRoutes.post('/disconnect', requireAuth, async (c) => {
  const userId = c.get('userId')

  const profile = await db.profile.findUnique({ where: { userId } })

  if (!profile?.paystackSubaccountCode) {
    return c.json({ error: 'No Paystack account found' }, 400)
  }

  try {
    // Clear Paystack data from profile
    await db.profile.update({
      where: { userId },
      data: {
        paystackSubaccountCode: null,
        paystackBankCode: null,
        paystackAccountNumber: null,
        paystackAccountName: null,
        paymentProvider: null,
        payoutStatus: 'pending',
      },
    })

    return c.json({
      success: true,
      message: 'Paystack account disconnected',
    })
  } catch (error) {
    console.error('Disconnect error:', error)
    return c.json({ error: 'Failed to disconnect account' }, 500)
  }
})

export default paystackRoutes
