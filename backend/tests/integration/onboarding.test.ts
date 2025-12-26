import { createHmac } from 'crypto'
import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { dbStorage } from '../setup.js'
import { env } from '../../src/config/env.js'

// Mock email service
vi.mock('../../src/services/email.js', () => ({
  sendOtpEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
}))

// Mock Stripe service
vi.mock('../../src/services/stripe.js', () => ({
  stripe: {
    accounts: {
      create: vi.fn(async () => ({ id: 'acct_test_123' })),
      retrieve: vi.fn(async () => ({
        id: 'acct_test_123',
        charges_enabled: true,
        payouts_enabled: true,
      })),
      createLoginLink: vi.fn(async () => ({ url: 'https://connect.stripe.com/test' })),
    },
    accountLinks: {
      create: vi.fn(async () => ({ url: 'https://connect.stripe.com/setup' })),
    },
    balance: {
      retrieve: vi.fn(async () => ({ available: [{ amount: 10000, currency: 'usd' }], pending: [{ amount: 5000, currency: 'usd' }] })),
    },
    payouts: {
      list: vi.fn(async () => ({ data: [{ id: 'po_test_1', amount: 5000, status: 'paid' }] })),
    },
  },
  getAccountStatus: vi.fn(async () => ({
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  })),
  createExpressAccount: vi.fn(async () => ({ accountId: 'acct_test_123', accountLink: 'https://connect.stripe.com/setup' })),
  getAccountBalance: vi.fn(async () => ({ available: 10000, pending: 5000 })),
  getPayoutHistory: vi.fn(async () => [{ id: 'po_test_1', amount: 5000, status: 'paid' }]),
}))

// Hash function matching auth service
function hashToken(token: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex')
}

// Helper to create a test user with session
async function createTestUserWithSession(email = 'creator@test.com') {
  const user = await db.user.create({
    data: { email },
  })

  const rawToken = 'test-session-token'
  const hashedToken = hashToken(rawToken)

  const session = await db.session.create({
    data: {
      userId: user.id,
      token: hashedToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  dbStorage.sessions.set(session.id, { ...session, user })

  return { user, session, rawToken }
}

// Helper to make authenticated request
function authRequest(path: string, options: RequestInit = {}, rawToken = 'test-session-token') {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${rawToken}`,
        ...options.headers,
      },
    })
  )
}

describe('onboarding endpoints', () => {
  beforeEach(() => {
    Object.values(dbStorage).forEach(store => store.clear())
  })

  afterAll(() => {
    Object.values(dbStorage).forEach(store => store.clear())
  })

  describe('PUT /profile', () => {
    it('creates profile with single pricing model and converts to cents', async () => {
      await createTestUserWithSession()

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'testcreator',
          displayName: 'Test Creator',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 10.50, // $10.50
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.singleAmount).toBe(1050) // Stored as cents
      expect(body.profile.pricingModel).toBe('single')
      expect(body.profile.shareUrl).toBe('https://natepay.co/testcreator')
    })

    it('creates profile with tier pricing and converts amounts to cents', async () => {
      await createTestUserWithSession()

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'tiercreator',
          displayName: 'Tier Creator',
          country: 'Canada',
          countryCode: 'CA',
          currency: 'CAD',
          purpose: 'fan_club',
          pricingModel: 'tiers',
          tiers: [
            { id: 'tier-1', name: 'Bronze', amount: 5.00, perks: ['Shoutout'], isPopular: false },
            { id: 'tier-2', name: 'Silver', amount: 15.00, perks: ['Shoutout', 'DMs'], isPopular: true },
            { id: 'tier-3', name: 'Gold', amount: 50.00, perks: ['All perks'], isPopular: false },
          ],
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.pricingModel).toBe('tiers')

      const tiers = body.profile.tiers as any[]
      expect(tiers).toHaveLength(3)
      expect(tiers[0].amount).toBe(500) // $5 -> 500 cents
      expect(tiers[1].amount).toBe(1500) // $15 -> 1500 cents
      expect(tiers[2].amount).toBe(5000) // $50 -> 5000 cents
    })

    it('stores perks and impact items as JSON', async () => {
      await createTestUserWithSession()

      const perks = [
        { id: 'perk-1', title: 'Exclusive content', enabled: true },
        { id: 'perk-2', title: 'Early access', enabled: false },
      ]
      const impactItems = [
        { id: 'impact-1', title: '100 supporters', subtitle: 'Thank you!' },
      ]

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'perkycreator',
          displayName: 'Perky Creator',
          country: 'United Kingdom',
          countryCode: 'GB',
          currency: 'GBP',
          purpose: 'support',
          pricingModel: 'single',
          singleAmount: 5.00,
          perks,
          impactItems,
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.perks).toEqual(perks)
      expect(body.profile.impactItems).toEqual(impactItems)
    })

    it('stores paymentProvider selection', async () => {
      await createTestUserWithSession()

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'stripecreator',
          displayName: 'Stripe Creator',
          country: 'Germany',
          countryCode: 'DE',
          currency: 'EUR',
          purpose: 'exclusive_content',
          pricingModel: 'single',
          singleAmount: 10.00,
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.paymentProvider).toBe('stripe')
    })

    it('rejects reserved username', async () => {
      await createTestUserWithSession()

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'admin',
          displayName: 'Admin User',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 5.00,
        }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('not available')
    })

    it('rejects username taken by another user', async () => {
      // Create first user with profile
      const { user: user1 } = await createTestUserWithSession('first@test.com')
      await db.profile.create({
        data: {
          userId: user1.id,
          username: 'takenname',
          displayName: 'First User',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500,
        },
      })

      // Create second user
      const user2 = await db.user.create({ data: { email: 'second@test.com' } })
      const rawToken2 = 'second-session-token'
      const session2 = await db.session.create({
        data: {
          userId: user2.id,
          token: hashToken(rawToken2),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })
      dbStorage.sessions.set(session2.id, { ...session2, user: user2 })

      // Second user tries to use same username
      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'takenname',
          displayName: 'Second User',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 5.00,
        }),
      }, rawToken2)

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('already taken')
    })

    it('stores username in lowercase and uppercases country/currency codes', async () => {
      await createTestUserWithSession()

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'myusername',
          displayName: 'My User',
          country: 'United States',
          countryCode: 'us', // lowercase input
          currency: 'usd', // lowercase input
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 5.00,
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.username).toBe('myusername')
      expect(body.profile.countryCode).toBe('US') // Uppercased
      expect(body.profile.currency).toBe('USD') // Uppercased
    })
  })

  describe('GET /profile/onboarding-status', () => {
    it('returns incomplete status for user without profile', async () => {
      await createTestUserWithSession()

      const res = await authRequest('/profile/onboarding-status')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.isComplete).toBe(false)
      expect(body.nextStep).toBe('profile')
      expect(body.progress.overall).toBe(0)
    })

    it('returns payments as next step when profile complete but no payout', async () => {
      const { user } = await createTestUserWithSession()

      await db.profile.create({
        data: {
          userId: user.id,
          username: 'testuser',
          displayName: 'Test User',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500,
        },
      })

      const res = await authRequest('/profile/onboarding-status')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.isComplete).toBe(false)
      expect(body.nextStep).toBe('payments')
      expect(body.steps.profile.completed).toBe(true)
      expect(body.steps.payments.completed).toBe(false)
      expect(body.canAcceptPayments).toBe(false)
    })

    it('returns partial payment progress when stripe account exists but pending', async () => {
      const { user } = await createTestUserWithSession()

      await db.profile.create({
        data: {
          userId: user.id,
          username: 'pendinguser',
          displayName: 'Pending User',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500,
          stripeAccountId: 'acct_pending',
          payoutStatus: 'pending',
        },
      })

      const res = await authRequest('/profile/onboarding-status')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.steps.payments.status).toBe('pending')
      expect(body.progress.payments).toBe(50) // 50% for having account but not active
    })

    it('returns complete status when profile and payments are active', async () => {
      const { user } = await createTestUserWithSession()

      await db.profile.create({
        data: {
          userId: user.id,
          username: 'completeuser',
          displayName: 'Complete User',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500,
          stripeAccountId: 'acct_active',
          payoutStatus: 'active',
        },
      })

      const res = await authRequest('/profile/onboarding-status')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.isComplete).toBe(true)
      expect(body.nextStep).toBeNull()
      expect(body.canAcceptPayments).toBe(true)
      expect(body.progress.overall).toBe(100)
    })
  })

  describe('GET /profile/check-username', () => {
    it('returns reserved for reserved username', async () => {
      const res = await app.fetch(
        new Request('http://localhost/profile/check-username/admin')
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.available).toBe(false)
      expect(body.reason).toBe('reserved')
    })

    it('returns taken for existing username', async () => {
      const { user } = await createTestUserWithSession()
      await db.profile.create({
        data: {
          userId: user.id,
          username: 'existinguser',
          displayName: 'Existing',
          country: 'US',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500,
        },
      })

      const res = await app.fetch(
        new Request('http://localhost/profile/check-username/existinguser')
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.available).toBe(false)
      expect(body.reason).toBe('taken')
    })

    it('returns invalid_format for special characters', async () => {
      const res = await app.fetch(
        new Request('http://localhost/profile/check-username/invalid-name!')
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.available).toBe(false)
      expect(body.reason).toBe('invalid_format')
    })

    it('returns available for valid unused username', async () => {
      const res = await app.fetch(
        new Request('http://localhost/profile/check-username/availableuser')
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.available).toBe(true)
    })

    it('normalizes username check to lowercase', async () => {
      const { user } = await createTestUserWithSession()
      await db.profile.create({
        data: {
          userId: user.id,
          username: 'lowercase',
          displayName: 'Lower',
          country: 'US',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500,
        },
      })

      const res = await app.fetch(
        new Request('http://localhost/profile/check-username/LOWERCASE')
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.available).toBe(false)
      expect(body.reason).toBe('taken')
    })
  })

  describe('GET /stripe/supported-countries', () => {
    it('returns list of supported countries', async () => {
      const res = await app.fetch(
        new Request('http://localhost/stripe/supported-countries')
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.countries).toBeDefined()
      expect(Array.isArray(body.countries)).toBe(true)
      expect(body.total).toBeGreaterThan(30) // At least 30+ countries

      // Check structure
      const us = body.countries.find((c: any) => c.code === 'US')
      expect(us).toEqual({ code: 'US', name: 'United States', crossBorder: false })
    })
  })

  describe('POST /stripe/connect', () => {
    it('requires profile to exist first', async () => {
      await createTestUserWithSession()

      const res = await authRequest('/stripe/connect', {
        method: 'POST',
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('Profile not found')
    })

    it('rejects unsupported country with suggestion', async () => {
      const { user } = await createTestUserWithSession()

      await db.profile.create({
        data: {
          userId: user.id,
          username: 'alienuser',
          displayName: 'Alien User',
          country: 'Antarctica',
          countryCode: 'AQ', // Not supported by Stripe
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500,
        },
      })

      const res = await authRequest('/stripe/connect', {
        method: 'POST',
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('not available in your country')
    })

    it('returns onboarding URL for supported country', async () => {
      const { user } = await createTestUserWithSession()

      await db.profile.create({
        data: {
          userId: user.id,
          username: 'ususer',
          displayName: 'US User',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500,
        },
      })

      const res = await authRequest('/stripe/connect', {
        method: 'POST',
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.accountId).toBe('acct_test_123')
      expect(body.onboardingUrl).toContain('stripe.com')
    })
  })

  describe('GET /stripe/connect/status', () => {
    it('returns not_started for user without stripe account', async () => {
      const { user } = await createTestUserWithSession()

      await db.profile.create({
        data: {
          userId: user.id,
          username: 'nostripe',
          displayName: 'No Stripe',
          country: 'US',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500,
        },
      })

      const res = await authRequest('/stripe/connect/status')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.connected).toBe(false)
      expect(body.status).toBe('not_started')
    })

    it('returns active status for connected account', async () => {
      const { user } = await createTestUserWithSession()

      await db.profile.create({
        data: {
          userId: user.id,
          username: 'connecteduser',
          displayName: 'Connected User',
          country: 'US',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500,
          stripeAccountId: 'acct_connected',
          payoutStatus: 'pending',
        },
      })

      const res = await authRequest('/stripe/connect/status')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.connected).toBe(true)
      expect(body.status).toBe('active')
      expect(body.details).toBeDefined()
    })
  })

  describe('GET /stripe/balance', () => {
    it('returns error without stripe account', async () => {
      const { user } = await createTestUserWithSession()

      await db.profile.create({
        data: {
          userId: user.id,
          username: 'nobalance',
          displayName: 'No Balance',
          country: 'US',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500,
        },
      })

      const res = await authRequest('/stripe/balance')

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('No payment account')
    })

    it('returns balance for connected account', async () => {
      const { user } = await createTestUserWithSession()

      await db.profile.create({
        data: {
          userId: user.id,
          username: 'balanceuser',
          displayName: 'Balance User',
          country: 'US',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500,
          stripeAccountId: 'acct_balance',
        },
      })

      const res = await authRequest('/stripe/balance')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.balance.available).toBe(10000)
      expect(body.balance.pending).toBe(5000)
    })
  })

  describe('GET /stripe/payouts', () => {
    it('returns payout history for connected account', async () => {
      const { user } = await createTestUserWithSession()

      await db.profile.create({
        data: {
          userId: user.id,
          username: 'payoutuser',
          displayName: 'Payout User',
          country: 'US',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500,
          stripeAccountId: 'acct_payouts',
        },
      })

      const res = await authRequest('/stripe/payouts')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.payouts).toHaveLength(1)
      expect(body.payouts[0].id).toBe('po_test_1')
      expect(body.payouts[0].amount).toBe(5000)
    })
  })

  describe('PUT /auth/onboarding', () => {
    it('saves onboarding progress with validated data', async () => {
      const { user, rawToken } = await createTestUserWithSession('onboard@test.com')

      const res = await authRequest('/auth/onboarding', {
        method: 'PUT',
        body: JSON.stringify({
          step: 5,
          branch: 'service',
          data: {
            displayName: 'Service User',
            country: 'United States',
            countryCode: 'US',
            currency: 'USD',
            username: 'serviceuser',
            singleAmount: 2500,
          },
        }),
      }, rawToken)

      expect(res.status).toBe(200)
      const updated = await db.user.findUnique({ where: { id: user.id } })
      expect(updated?.onboardingStep).toBe(5)
      expect(updated?.onboardingBranch).toBe('service')
      expect(updated?.onboardingData).toMatchObject({
        displayName: 'Service User',
        country: 'United States',
        countryCode: 'US',
        currency: 'USD',
        username: 'serviceuser',
        singleAmount: 2500,
      })
    })

    it('rejects invalid onboarding data', async () => {
      await createTestUserWithSession('badonboard@test.com')

      const res = await authRequest('/auth/onboarding', {
        method: 'PUT',
        body: JSON.stringify({
          step: 2,
          branch: 'personal',
          data: {
            username: 'ab', // too short
          },
        }),
      })

      expect(res.status).toBe(400)
    })
  })

  describe('GET /auth/verify onboarding state', () => {
    it('returns onboarding state for existing user', async () => {
      // Create user with onboarding progress
      const user = await db.user.create({
        data: {
          email: 'verify@test.com',
          onboardingStep: 6,
          onboardingBranch: 'service',
          onboardingData: { displayName: 'Verify User' },
        },
      })

      // Create OTP token
      const token = '123456'
      await db.magicLinkToken.create({
        data: {
          email: user.email,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          usedAt: null,
        },
      })

      const res = await app.fetch(
        new Request('http://localhost/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, email: user.email }),
        })
      )
      
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.onboardingStep).toBe(6)
      expect(body.onboardingBranch).toBe('service')
      expect(body.onboardingData).toMatchObject({ displayName: 'Verify User' })
      expect(body.redirectTo).toContain('/onboarding')
    })

    it('creates new user with default onboarding step after OTP', async () => {
      const token = '654321'
      const email = 'newuser@test.com'
      
      await db.magicLinkToken.create({
        data: {
          email,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          usedAt: null,
        },
      })

      const res = await app.fetch(
        new Request('http://localhost/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, email }),
        })
      )
      
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      // New users start at post-OTP step 3
      expect(body.onboardingStep).toBe(3)
      expect(body.redirectTo).toBe('/onboarding?step=3')

      const user = await db.user.findUnique({ where: { email: 'newuser@test.com' } })
      expect(user?.onboardingStep).toBe(3)
    })
  })

  // =============================================================================
  // CROSS-BORDER AND PAYSTACK CURRENCY VALIDATION TESTS
  // These tests ensure Nigerian/Kenyan/Ghanaian users can set up with Paystack
  // using local currencies, while Stripe users in cross-border countries use USD
  // =============================================================================
  describe('PUT /profile - Cross-border and Paystack currency validation', () => {
    // -------------------------------------------------------------------------
    // PAYSTACK SCENARIOS - Should allow local currencies
    // -------------------------------------------------------------------------
    it('Nigerian user with Paystack and NGN currency - SHOULD SUCCEED', async () => {
      await createTestUserWithSession('ng-paystack@test.com')

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'ngpaystack',
          displayName: 'Nigerian Paystack User',
          country: 'Nigeria',
          countryCode: 'NG',
          currency: 'NGN',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 5000, // 5000 NGN
          paymentProvider: 'paystack',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.currency).toBe('NGN')
      expect(body.profile.paymentProvider).toBe('paystack')
      expect(body.profile.countryCode).toBe('NG')
      // NGN amounts stored as kobo (cents equivalent): 5000 NGN = 500000 kobo
      expect(body.profile.singleAmount).toBe(500000)
    })

    it('Kenyan user with Paystack and KES currency - SHOULD SUCCEED', async () => {
      await createTestUserWithSession('ke-paystack@test.com')

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'kepaystack',
          displayName: 'Kenyan Paystack User',
          country: 'Kenya',
          countryCode: 'KE',
          currency: 'KES',
          purpose: 'support',
          pricingModel: 'single',
          singleAmount: 500, // 500 KES
          paymentProvider: 'paystack',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.currency).toBe('KES')
      expect(body.profile.paymentProvider).toBe('paystack')
      expect(body.profile.countryCode).toBe('KE')
      // KES amounts stored as cents: 500 KES = 50000 cents
      expect(body.profile.singleAmount).toBe(50000)
    })

    it('South African user with Paystack and ZAR currency - SHOULD SUCCEED', async () => {
      await createTestUserWithSession('za-paystack@test.com')

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'zapaystack',
          displayName: 'South African Paystack User',
          country: 'South Africa',
          countryCode: 'ZA',
          currency: 'ZAR',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 100, // 100 ZAR
          paymentProvider: 'paystack',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.currency).toBe('ZAR')
      expect(body.profile.paymentProvider).toBe('paystack')
    })

    // -------------------------------------------------------------------------
    // STRIPE CROSS-BORDER SCENARIOS - Must use USD
    // -------------------------------------------------------------------------
    it('Nigerian user with Stripe and USD currency - SHOULD SUCCEED', async () => {
      await createTestUserWithSession('ng-stripe-usd@test.com')

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'ngstripeusd',
          displayName: 'Nigerian Stripe USD User',
          country: 'Nigeria',
          countryCode: 'NG',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 10, // $10 USD
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.currency).toBe('USD')
      expect(body.profile.paymentProvider).toBe('stripe')
      expect(body.profile.singleAmount).toBe(1000) // $10 = 1000 cents
    })

    it('Nigerian user with Stripe and NGN currency - SHOULD SUCCEED', async () => {
      await createTestUserWithSession('ng-stripe-ngn@test.com')

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'ngstripengn',
          displayName: 'Nigerian Stripe NGN User',
          country: 'Nigeria',
          countryCode: 'NG',
          currency: 'NGN', // Any Stripe-supported currency is allowed
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 5000,
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.currency).toBe('NGN')
      expect(body.profile.paymentProvider).toBe('stripe')
    })

    it('Kenyan user with Stripe and KES currency - SHOULD SUCCEED', async () => {
      await createTestUserWithSession('ke-stripe-kes@test.com')

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'kestripeks',
          displayName: 'Kenyan Stripe KES User',
          country: 'Kenya',
          countryCode: 'KE',
          currency: 'KES', // Any Stripe-supported currency is allowed
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500,
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.currency).toBe('KES')
      expect(body.profile.paymentProvider).toBe('stripe')
    })

    it('Ghanaian user with Stripe and GHS currency - SHOULD SUCCEED', async () => {
      await createTestUserWithSession('gh-stripe-ghs@test.com')

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'ghstripeghs',
          displayName: 'Ghanaian Stripe GHS User',
          country: 'Ghana',
          countryCode: 'GH',
          currency: 'GHS', // Any Stripe-supported currency is allowed
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 50,
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.currency).toBe('GHS')
      expect(body.profile.paymentProvider).toBe('stripe')
    })

    // -------------------------------------------------------------------------
    // STRIPE NATIVE COUNTRIES - Can use any supported currency
    // -------------------------------------------------------------------------
    it('US user with Stripe and USD - SHOULD SUCCEED', async () => {
      await createTestUserWithSession('us-stripe@test.com')

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'usstripe',
          displayName: 'US Stripe User',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 5,
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.currency).toBe('USD')
      expect(body.profile.paymentProvider).toBe('stripe')
    })

    it('UK user with Stripe and GBP - SHOULD SUCCEED', async () => {
      await createTestUserWithSession('uk-stripe@test.com')

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'ukstripe',
          displayName: 'UK Stripe User',
          country: 'United Kingdom',
          countryCode: 'GB',
          currency: 'GBP',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 5,
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.currency).toBe('GBP')
    })

    it('South African user with Stripe and ZAR - SHOULD SUCCEED (ZA has native Stripe)', async () => {
      await createTestUserWithSession('za-stripe@test.com')

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'zastripe',
          displayName: 'ZA Stripe User',
          country: 'South Africa',
          countryCode: 'ZA',
          currency: 'ZAR',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 100,
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.currency).toBe('ZAR')
      // ZA is NOT cross-border, it has native Stripe support
    })

    // -------------------------------------------------------------------------
    // EDGE CASES
    // -------------------------------------------------------------------------
    it('Nigerian user with no paymentProvider and NGN currency - SHOULD SUCCEED', async () => {
      await createTestUserWithSession('ng-no-provider@test.com')

      // When no paymentProvider is specified, we allow any currency
      // (provider will be set during payment setup)
      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'ngnoprovider',
          displayName: 'Nigerian No Provider',
          country: 'Nigeria',
          countryCode: 'NG',
          currency: 'NGN',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 5000,
          // paymentProvider NOT specified - still allowed
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.currency).toBe('NGN')
    })

    it('Cross-border user can update profile with Paystack even if previously had no provider', async () => {
      const { user } = await createTestUserWithSession('ng-update@test.com')

      // First create profile without payment provider
      await db.profile.create({
        data: {
          userId: user.id,
          username: 'ngupdate',
          displayName: 'Nigerian Update User',
          country: 'Nigeria',
          countryCode: 'NG',
          currency: 'NGN',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500000, // 5000 NGN in kobo
        },
      })

      // Then PATCH to add Paystack
      const res = await authRequest('/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          paymentProvider: 'paystack',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.paymentProvider).toBe('paystack')
      expect(body.profile.currency).toBe('NGN')
    })

    it('Cross-border user can switch to Stripe with any Stripe-supported currency', async () => {
      const { user } = await createTestUserWithSession('ng-switch-provider@test.com')

      // First create profile with Paystack and NGN
      await db.profile.create({
        data: {
          userId: user.id,
          username: 'ngswitchprovider',
          displayName: 'Nigerian Switch Provider',
          country: 'Nigeria',
          countryCode: 'NG',
          currency: 'NGN',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500000,
          paymentProvider: 'paystack',
        },
      })

      // PATCH to switch to Stripe without changing currency should succeed
      // (Cross-border Stripe users can now use any Stripe-supported currency)
      const res = await authRequest('/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.paymentProvider).toBe('stripe')
      expect(body.profile.currency).toBe('NGN') // Currency unchanged
    })

    it('Cross-border user can switch to Stripe if also updating to USD', async () => {
      const { user } = await createTestUserWithSession('ng-switch-both@test.com')

      // First create profile with Paystack and NGN
      await db.profile.create({
        data: {
          userId: user.id,
          username: 'ngswitchboth',
          displayName: 'Nigerian Switch Both',
          country: 'Nigeria',
          countryCode: 'NG',
          currency: 'NGN',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500000,
          paymentProvider: 'paystack',
        },
      })

      // PATCH to switch to Stripe AND USD should succeed
      const res = await authRequest('/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          paymentProvider: 'stripe',
          currency: 'USD',
          singleAmount: 10, // $10 USD
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.paymentProvider).toBe('stripe')
      expect(body.profile.currency).toBe('USD')
    })
  })

  // =============================================================================
  // CURRENCY MINIMUM VALIDATION TESTS
  // Ensure minimum amounts are enforced correctly for each currency
  // =============================================================================
  describe('PUT /profile - Currency minimum validation', () => {
    it('rejects NGN amount below minimum (₦1,000)', async () => {
      await createTestUserWithSession('ngn-min@test.com')

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'ngnmin',
          displayName: 'NGN Min Test',
          country: 'Nigeria',
          countryCode: 'NG',
          currency: 'NGN',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 500, // 500 NGN - below ₦1,000 minimum
          paymentProvider: 'paystack',
        }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('minimum')
    })

    it('accepts NGN amount at minimum (₦1,000)', async () => {
      await createTestUserWithSession('ngn-exact-min@test.com')

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'ngnexactmin',
          displayName: 'NGN Exact Min Test',
          country: 'Nigeria',
          countryCode: 'NG',
          currency: 'NGN',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 1000, // Exactly at ₦1,000 minimum
          paymentProvider: 'paystack',
        }),
      })

      expect(res.status).toBe(200)
    })

    it('rejects USD amount below minimum ($1)', async () => {
      await createTestUserWithSession('usd-min@test.com')

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'usdmin',
          displayName: 'USD Min Test',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 0.50, // $0.50 - below $1 minimum
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('minimum')
    })

    it('accepts USD amount at minimum ($1)', async () => {
      await createTestUserWithSession('usd-exact-min@test.com')

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'usdexactmin',
          displayName: 'USD Exact Min Test',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 1, // Exactly $1
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(200)
    })
  })
})
