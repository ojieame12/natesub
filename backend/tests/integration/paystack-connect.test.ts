import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { resetDatabase, disconnectDatabase } from '../helpers/db.js'

// Mock Paystack service
const mockListBanks = vi.fn()
const mockResolveAccount = vi.fn()
const mockValidateAccount = vi.fn()
const mockCreateSubaccount = vi.fn()
const mockGetSubaccount = vi.fn()

vi.mock('../../src/services/paystack.js', async () => {
  const actual = await vi.importActual('../../src/services/paystack.js')
  return {
    ...actual,
    listBanks: (...args: any[]) => mockListBanks(...args),
    resolveAccount: (...args: any[]) => mockResolveAccount(...args),
    validateAccount: (...args: any[]) => mockValidateAccount(...args),
    createSubaccount: (...args: any[]) => mockCreateSubaccount(...args),
    getSubaccount: (...args: any[]) => mockGetSubaccount(...args),
    isPaystackSupported: (country: string) => ['NG', 'KE', 'ZA', 'GH'].includes(country),
  }
})

// Mock Auth service to bypass hashing/DB lookup
vi.mock('../../src/services/auth.js', async () => {
  const actual = await vi.importActual('../../src/services/auth.js')
  return {
    ...actual,
    validateSession: vi.fn(async (token) => {
      // Return a valid session for any token in this test
      return { userId: 'test-user-id' }
    })
  }
})

// Paystack routes gated behind ENABLE_PAYSTACK (paused for Stripe-first launch)
describe.skip('paystack connect flow', () => {
  let user: any
  let sessionCookie: string

  beforeEach(async () => {
    await resetDatabase()
    vi.clearAllMocks()

    // Create user manually with fixed ID to match the auth mock
    user = await db.user.create({
      data: {
        id: 'test-user-id',
        email: 'test@example.com',
      }
    })

    // Create profile manually
    await db.profile.create({
      data: {
        userId: user.id,
        username: 'tester',
        displayName: 'Test User',
        country: 'Nigeria',
        countryCode: 'NG',
        currency: 'NGN',
      }
    })
    
    // Attach profile to user object for test convenience (mockDb doesn't do this)
    user.profile = {
      username: 'tester',
      displayName: 'Test User',
      country: 'Nigeria',
      countryCode: 'NG',
      currency: 'NGN',
    }

    // Session cookie - value doesn't matter as we mocked validateSession
    sessionCookie = `session=valid-token`
  })

  afterAll(async () => {
    await resetDatabase()
    await disconnectDatabase()
  })

  it('lists banks for a supported country', async () => {
    mockListBanks.mockResolvedValue([
      { code: '012', name: 'GTBank', type: 'nuban' }
    ])

    const res = await app.fetch(
      new Request('http://localhost/paystack/banks/NG', {
        headers: { Cookie: sessionCookie }
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.banks).toHaveLength(1)
    expect(body.banks[0].name).toBe('GTBank')
  })

  it('resolves account for Nigeria (Standard)', async () => {
    mockResolveAccount.mockResolvedValue({
      account_name: 'Test Account',
      account_number: '1234567890'
    })

    const res = await app.fetch(
      new Request('http://localhost/paystack/resolve-account', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Cookie: sessionCookie
        },
        body: JSON.stringify({
          accountNumber: '1234567890',
          bankCode: '012'
        })
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.verified).toBe(true)
    expect(body.accountName).toBe('Test Account')
  })

  it('skips verification for Kenya', async () => {
    // Update user to Kenya
    await db.profile.update({
      where: { userId: user.id },
      data: { country: 'Kenya', countryCode: 'KE', currency: 'KES' }
    })

    const res = await app.fetch(
      new Request('http://localhost/paystack/resolve-account', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Cookie: sessionCookie
        },
        body: JSON.stringify({
          accountNumber: '1234567890',
          bankCode: '001'
        })
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.verified).toBe(false)
    expect(body.verificationSkipped).toBe(true)
  })

  it('requires ID number for South Africa', async () => {
    // Update user to South Africa
    await db.profile.update({
      where: { userId: user.id },
      data: { country: 'South Africa', countryCode: 'ZA', currency: 'ZAR' }
    })

    // Fail without ID
    const failRes = await app.fetch(
      new Request('http://localhost/paystack/resolve-account', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Cookie: sessionCookie
        },
        body: JSON.stringify({
          accountNumber: '1234567890',
          bankCode: '001'
        })
      })
    )
    expect(failRes.status).toBe(400)

    // Success with ID
    mockValidateAccount.mockResolvedValue({
      verified: true,
      account_name: 'SA User'
    })

    const successRes = await app.fetch(
      new Request('http://localhost/paystack/resolve-account', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Cookie: sessionCookie
        },
        body: JSON.stringify({
          accountNumber: '1234567890',
          bankCode: '001',
          idNumber: '9001010000080'
        })
      })
    )

    expect(successRes.status).toBe(200)
    const body = await successRes.json()
    expect(body.verified).toBe(true)
    expect(mockValidateAccount).toHaveBeenCalled()
  })

  it('connects account and updates profile', async () => {
    mockCreateSubaccount.mockResolvedValue({
      subaccountCode: 'ACCT_NEW_123'
    })

    const res = await app.fetch(
      new Request('http://localhost/paystack/connect', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Cookie: sessionCookie
        },
        body: JSON.stringify({
          bankCode: '012',
          accountNumber: '1234567890',
          accountName: 'Verified User'
        })
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    // Verify DB update
    const updatedProfile = await db.profile.findUnique({ where: { userId: user.id } })
    expect(updatedProfile?.paystackSubaccountCode).toBe('ACCT_NEW_123')
    expect(updatedProfile?.paystackAccountName).toBe('Verified User')
  })
})
