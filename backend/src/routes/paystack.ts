import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { getCookie, setCookie } from 'hono/cookie'
import { db } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { paymentRateLimit, publicRateLimit } from '../middleware/rateLimit.js'
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
import { rotateSessionToken } from '../services/auth.js'
import { maskAccountNumber } from '../utils/pii.js'
import { decryptAccountNumber, encryptAccountNumber } from '../utils/encryption.js'
import { env } from '../config/env.js'
import { invalidatePublicProfileCache } from '../utils/cache.js'

const paystackRoutes = new Hono()

/**
 * Rotate session token after sensitive payment operation.
 * Returns the new token (for mobile clients) and sets cookie (for web clients).
 */
async function rotateTokenOnSuccess(c: any): Promise<string | null> {
  const cookieToken = getCookie(c, 'session')
  const authHeader = c.req.header('Authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  const currentToken = cookieToken || bearerToken

  if (!currentToken) return null

  const newToken = await rotateSessionToken(currentToken)

  if (newToken) {
    // Set new cookie for web clients
    setCookie(c, 'session', newToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    })
  }

  return newToken
}

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
  paymentRateLimit,
  zValidator(
    'json',
    z.object({
      // Min 9 for South Africa (9-11 digits), min 10 for Nigeria/Kenya
      accountNumber: z.string().min(9).max(20),
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

      // Nigeria and Ghana use standard resolve API
      // Kenya does NOT support bank/resolve - skip verification
      if (countryCode === 'KE') {
        // Kenya: Paystack doesn't support account resolution
        // Return unverified status - account will be validated on first transfer
        return c.json({
          verified: false,
          verificationSkipped: true,
          message: 'Account verification not available for Kenya. Account will be validated on first payout.',
          accountNumber: data.accountNumber,
          bankCode: data.bankCode,
        })
      }

      // Nigeria (NG) and Ghana (GH) - use standard resolve
      const result = await resolveAccount(data.accountNumber, data.bankCode)

      return c.json({
        verified: true,
        accountName: result.account_name,
        accountNumber: result.account_number,
        bankCode: data.bankCode,
      })
    } catch (error: any) {
      // Log internal error but don't expose to client
      console.error(`[paystack] Resolve account error for ${maskAccountNumber(data.accountNumber)}:`, error.message)
      // Return generic message - don't expose Paystack API error details
      return c.json({
        error: 'Failed to verify bank account. Please check your details and try again.',
        verified: false,
      }, 400)
    }
  }
)

// Connect Paystack (create subaccount)
paystackRoutes.post(
  '/connect',
  requireAuth,
  paymentRateLimit,
  zValidator(
    'json',
    z.object({
      bankCode: z.string(),
      // Min 9 for South Africa (9-11 digits), min 10 for Nigeria/Kenya
      accountNumber: z.string().min(9).max(20),
      accountName: z.string().min(2), // Verified name from resolve (or manual for Kenya)
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

      // Encrypt account number before storage
      const encryptedAccountNumber = encryptAccountNumber(data.accountNumber)

      // Store verified account details
      const profile = await db.profile.update({
        where: { userId },
        data: {
          paystackSubaccountCode: result.subaccountCode,
          paystackBankCode: data.bankCode,
          paystackAccountNumber: encryptedAccountNumber,
          paystackAccountName: data.accountName,
          paymentProvider: 'paystack', // Auto-switch to Paystack
          payoutStatus: 'active', // Mark as active
        },
      })

      // Invalidate public profile cache - payoutStatus affects paymentsReady
      if (profile.username) {
        await invalidatePublicProfileCache(profile.username)
      }

      // SECURITY: Rotate session token after connecting payment account
      const newToken = await rotateTokenOnSuccess(c)

      return c.json({
        success: true,
        subaccountCode: result.subaccountCode,
        message: 'Payment account connected successfully',
        // Return rotated token for mobile clients (security hardening)
        ...(newToken && { token: newToken }),
      })
    } catch (error: any) {
      console.error('Paystack Connect error:', error)
      // Return generic message - don't expose Paystack API error details
      return c.json({
        error: 'Failed to create payment account. Please try again or contact support.',
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

    // Get decrypted account number and mask it for security
    const decryptedAccountNumber = profile.paystackAccountNumber
      ? decryptAccountNumber(profile.paystackAccountNumber)
      : null

    return c.json({
      connected: true,
      status: subaccount.active ? 'active' : 'inactive',
      details: {
        businessName: subaccount.business_name,
        bank: subaccount.settlement_bank,
        // SECURITY: Only return masked account number to prevent PII exposure
        accountNumber: decryptedAccountNumber ? maskAccountNumber(decryptedAccountNumber) : null,
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
    const updatedProfile = await db.profile.update({
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

    // Invalidate public profile cache - payoutStatus affects paymentsReady
    if (updatedProfile.username) {
      await invalidatePublicProfileCache(updatedProfile.username)
    }

    // SECURITY: Rotate session token after disconnecting payment account
    const newToken = await rotateTokenOnSuccess(c)

    return c.json({
      success: true,
      message: 'Paystack account disconnected',
      // Return rotated token for mobile clients (security hardening)
      ...(newToken && { token: newToken }),
    })
  } catch (error) {
    console.error('Disconnect error:', error)
    return c.json({ error: 'Failed to disconnect account' }, 500)
  }
})

// Verify a transaction (for callback verification)
// Rate limited to prevent enumeration attacks
paystackRoutes.get('/verify/:reference', publicRateLimit, async (c) => {
  const reference = c.req.param('reference')

  if (!reference) {
    return c.json({ error: 'Reference is required' }, 400)
  }

  try {
    // Import verifyTransaction from service
    const { verifyTransaction } = await import('../services/paystack.js')
    const transaction = await verifyTransaction(reference)

    // Check if payment was successful
    if (transaction.status !== 'success') {
      return c.json({
        verified: false,
        status: transaction.status,
        error: 'Payment was not successful',
      })
    }

    // Get creator info from metadata
    const creatorId = transaction.metadata?.creatorId
    let creatorUsername: string | null = null

    if (creatorId) {
      const profile = await db.profile.findUnique({
        where: { userId: creatorId },
        select: { username: true, displayName: true },
      })
      creatorUsername = profile?.username || null
    }

    return c.json({
      verified: true,
      status: 'success',
      amount: transaction.amount,
      currency: transaction.currency,
      creatorUsername,
      // SECURITY: customerEmail removed to prevent PII exposure on public endpoint
      paidAt: transaction.paid_at,
    })
  } catch (error: any) {
    console.error('Transaction verify error:', error)
    // Return generic message - don't expose Paystack API error details
    return c.json({
      verified: false,
      error: 'Failed to verify transaction',
    }, 400)
  }
})

// Get pending OTP transfers (admin/system use)
paystackRoutes.get('/transfers/otp-pending', requireAuth, async (c) => {
  const userId = c.get('userId')

  // Find all payouts for this creator that need OTP
  const pendingTransfers = await db.payment.findMany({
    where: {
      creatorId: userId,
      type: 'payout',
      status: 'otp_pending',
      paystackTransferCode: { not: null },
    },
    select: {
      id: true,
      amountCents: true,
      currency: true,
      paystackTransactionRef: true,
      paystackTransferCode: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  return c.json({
    transfers: pendingTransfers,
    count: pendingTransfers.length,
  })
})

// Finalize transfer with OTP (admin/system use)
paystackRoutes.post(
  '/transfers/finalize',
  requireAuth,
  paymentRateLimit,
  zValidator(
    'json',
    z.object({
      transferCode: z.string(),
      otp: z.string().length(6),
    })
  ),
  async (c) => {
    const userId = c.get('userId')
    const { transferCode, otp } = c.req.valid('json')

    // Verify this transfer belongs to the user
    const payout = await db.payment.findFirst({
      where: {
        creatorId: userId,
        type: 'payout',
        paystackTransferCode: transferCode,
        status: 'otp_pending',
      },
    })

    if (!payout) {
      return c.json({ error: 'Transfer not found or not pending OTP' }, 404)
    }

    try {
      // Import finalize function
      const { finalizeTransfer } = await import('../services/paystack.js')
      const result = await finalizeTransfer({ transferCode, otp })

      // Update payout status based on result
      // Note: The actual success/failure will come via webhook
      // but we can update to pending if finalization was accepted
      if (result.status === 'success' || result.status === 'pending') {
        await db.payment.update({
          where: { id: payout.id },
          data: { status: 'pending' }, // Will be updated by transfer.success webhook
        })
      }

      return c.json({
        success: true,
        status: result.status,
        reference: result.reference,
        message: 'Transfer finalization submitted. Status will be updated via webhook.',
      })
    } catch (error: any) {
      console.error('Transfer finalize error:', error)
      // Return generic message - don't expose Paystack API error details
      return c.json({
        success: false,
        error: 'Failed to finalize transfer. Please check the OTP and try again.',
      }, 400)
    }
  }
)

// Resend transfer OTP
paystackRoutes.post(
  '/transfers/resend-otp',
  requireAuth,
  paymentRateLimit,
  zValidator(
    'json',
    z.object({
      transferCode: z.string(),
    })
  ),
  async (c) => {
    const userId = c.get('userId')
    const { transferCode } = c.req.valid('json')

    // Verify this transfer belongs to the user
    const payout = await db.payment.findFirst({
      where: {
        creatorId: userId,
        type: 'payout',
        paystackTransferCode: transferCode,
        status: 'otp_pending',
      },
    })

    if (!payout) {
      return c.json({ error: 'Transfer not found or not pending OTP' }, 404)
    }

    try {
      const { resendTransferOtp } = await import('../services/paystack.js')
      await resendTransferOtp({ transferCode })

      return c.json({
        success: true,
        message: 'OTP resent successfully',
      })
    } catch (error: any) {
      console.error('Resend OTP error:', error)
      // Return generic message - don't expose Paystack API error details
      return c.json({
        success: false,
        error: 'Failed to resend OTP. Please try again.',
      }, 400)
    }
  }
)

export default paystackRoutes
