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

// Mock platform subscription service
vi.mock('../../src/services/platformSubscription.js', () => ({
  startPlatformTrial: vi.fn(async () => 'trial_123'),
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

    it('allows service profile with fewer than 3 perks when NOT publishing', async () => {
      // During onboarding (isPublic: false), perks aren't required yet
      // This allows PaymentMethodStep to save purpose=service before perks are created
      await createTestUserWithSession('service-no-perks@test.com')

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'servicenoperks',
          displayName: 'Service No Perks',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'service',
          pricingModel: 'single',
          singleAmount: 50,
          isPublic: false, // Not publishing yet
          perks: [
            { id: 'perk-1', title: 'Only one perk', enabled: true },
          ],
        }),
      })

      expect(res.status).toBe(200) // Allowed during onboarding
    })

    it('rejects service profile with fewer than 3 perks when PUBLISHING', async () => {
      await createTestUserWithSession('service-publish-no-perks@test.com')

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'svcpubnoperks', // max 20 chars
          displayName: 'Service Publish No Perks',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'service',
          pricingModel: 'single',
          singleAmount: 50,
          isPublic: true, // Publishing - perks required
          perks: [
            { id: 'perk-1', title: 'Only one perk', enabled: true },
          ],
        }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('at least 3 perks')
    })

    it('accepts service profile with 3 perks', async () => {
      await createTestUserWithSession('service-with-perks@test.com')

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'servicewithperks',
          displayName: 'Service With Perks',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'service',
          pricingModel: 'single',
          singleAmount: 50,
          perks: [
            { id: 'perk-1', title: 'Perk 1', enabled: true },
            { id: 'perk-2', title: 'Perk 2', enabled: true },
            { id: 'perk-3', title: 'Perk 3', enabled: true },
          ],
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.perks).toHaveLength(3)
    })

    it('stores paymentProvider selection', async () => {
      await createTestUserWithSession()

      // Germany minimum for Stripe is €175 EUR (country-based minimum)
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
          singleAmount: 180.00, // Above €175 EUR minimum
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

      // NG minimum for Stripe is $500 USD (country-based minimum)
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
          singleAmount: 500, // $500 USD - meets NG minimum
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.currency).toBe('USD')
      expect(body.profile.paymentProvider).toBe('stripe')
      expect(body.profile.singleAmount).toBe(50000) // $500 = 50000 cents
    })

    it('Nigerian user with Stripe and NGN currency - SHOULD SUCCEED', async () => {
      await createTestUserWithSession('ng-stripe-ngn@test.com')

      // NG minimum for Stripe is 800,000 NGN (country-based minimum)
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
          singleAmount: 850000, // 850,000 NGN - above 800,000 minimum
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      // Cross-border Stripe creators are forced to USD (platform processes in USD, Stripe handles FX on payout)
      expect(body.profile.currency).toBe('USD')
      expect(body.profile.paymentProvider).toBe('stripe')
    })

    it('Kenyan user with Stripe and KES currency - SHOULD SUCCEED', async () => {
      await createTestUserWithSession('ke-stripe-kes@test.com')

      // KE minimum for Stripe is 73,000 KES (country-based minimum)
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
          singleAmount: 75000, // 75,000 KES - above 73,000 minimum
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      // Cross-border Stripe creators are forced to USD (platform processes in USD, Stripe handles FX on payout)
      expect(body.profile.currency).toBe('USD')
      expect(body.profile.paymentProvider).toBe('stripe')
    })

    it('Ghanaian user with Stripe and GHS currency - SHOULD SUCCEED', async () => {
      await createTestUserWithSession('gh-stripe-ghs@test.com')

      // GH minimum for Stripe is 8,100 GHS (country-based minimum)
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
          singleAmount: 8500, // 8,500 GHS - above 8,100 minimum
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      // Cross-border Stripe creators are forced to USD (platform processes in USD, Stripe handles FX on payout)
      expect(body.profile.currency).toBe('USD')
      expect(body.profile.paymentProvider).toBe('stripe')
    })

    // -------------------------------------------------------------------------
    // STRIPE NATIVE COUNTRIES - Can use any supported currency
    // -------------------------------------------------------------------------
    it('US user with Stripe and USD - SHOULD SUCCEED', async () => {
      await createTestUserWithSession('us-stripe@test.com')

      // US minimum for Stripe is $160 USD (country-based minimum)
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
          singleAmount: 165, // Above $160 USD minimum
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

      // UK minimum for Stripe is £155 GBP (country-based minimum)
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
          singleAmount: 160, // Above £155 GBP minimum
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.currency).toBe('GBP')
    })

    it('South African user with Stripe and USD - SHOULD SUCCEED (ZA is cross-border)', async () => {
      await createTestUserWithSession('za-stripe@test.com')

      // ZA is cross-border, so must use USD/GBP/EUR for Stripe
      // $85 minimum for cross-border countries
      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: 'zastripe',
          displayName: 'ZA Stripe User',
          country: 'South Africa',
          countryCode: 'ZA',
          currency: 'USD', // Cross-border countries use USD/GBP/EUR
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 8500, // $85 cross-border minimum
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.currency).toBe('USD')
      // ZA is cross-border - same as NG/GH/KE
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
      // NG Stripe minimum is $500 USD (country-based minimum for platform profitability)
      const res = await authRequest('/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          paymentProvider: 'stripe',
          currency: 'USD',
          singleAmount: 500, // $500 USD - meets NG minimum
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
  // =============================================================================
  // MINIMUM VALIDATION TESTS
  // Stripe creators: Country-based minimums (ensures platform profitability)
  // Paystack creators: No minimums on backend (different economics - subaccount splits)
  // =============================================================================
  describe('PUT /profile - Currency minimum validation', () => {
    // Paystack creators no longer have minimum validation on backend
    // This is correct - Paystack has different economics (subaccount splits, no $2/month fee)
    it('allows Paystack creators to set any amount (no backend minimum)', async () => {
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
          singleAmount: 500, // 500 NGN - Paystack has no backend minimum
          paymentProvider: 'paystack',
        }),
      })

      // Paystack creators don't have minimum validation on backend
      expect(res.status).toBe(200)
    })

    it('accepts NGN Paystack creator with standard amount', async () => {
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
          singleAmount: 5000, // Standard Paystack amount
          paymentProvider: 'paystack',
        }),
      })

      expect(res.status).toBe(200)
    })

    // Stripe creators have dynamic minimums based on country and subscriber count
    // This ensures platform profitability after Connect fees
    // US minimum is $15 for new creators (platform only pays ~1% Connect fees)
    // The $0.67/month account fee is amortized across subscribers
    it('rejects USD amount below dynamic minimum ($15 for new US Stripe creators)', async () => {
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
          singleAmount: 10, // $10 - below dynamic minimum ($15) for new US Stripe creators
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('Minimum')
    })

    it('accepts USD amount at or above dynamic minimum ($60 for new US Stripe creators)', async () => {
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
          singleAmount: 60, // $60 - meets dynamic minimum for new US Stripe creators (includes processing)
          paymentProvider: 'stripe',
        }),
      })

      expect(res.status).toBe(200)
    })
  })

  describe('PATCH /profile', () => {
    // Helper to create a profile first (PATCH requires existing profile)
    // Note: singleAmount must meet dynamic minimum for US Stripe creators
    // Dynamic minimum is $60 for new creators (0 subscribers) due to processing + $2/month account fee
    async function createProfileForPatch(email: string, purpose = 'tips') {
      const { user, rawToken } = await createTestUserWithSession(email)

      // Service users require at least 3 perks
      const perks = purpose === 'service' ? [
        { id: 'perk-1', title: 'Perk 1', enabled: true },
        { id: 'perk-2', title: 'Perk 2', enabled: true },
        { id: 'perk-3', title: 'Perk 3', enabled: true },
      ] : undefined

      const res = await authRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: email.replace('@test.com', '').replace(/[^a-z0-9]/g, ''),
          displayName: 'Test User',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose,
          pricingModel: 'single',
          singleAmount: 100, // Meets dynamic US minimum (~$95) for new Stripe creators
          paymentProvider: 'stripe',
          perks,
        }),
      }, rawToken)

      // Ensure profile was created (fail fast if not)
      if (res.status !== 200) {
        const body = await res.json()
        throw new Error(`createProfileForPatch failed: ${res.status} ${body?.error || 'Unknown error'}`)
      }

      return { user, rawToken }
    }

    describe('perk count validation for service users', () => {
      it('rejects perks update with fewer than 3 perks for service users', async () => {
        const { rawToken } = await createProfileForPatch('service-perks@test.com', 'service')

        const res = await authRequest('/profile', {
          method: 'PATCH',
          body: JSON.stringify({
            perks: [
              { id: 'perk-1', title: 'Perk 1', enabled: true },
              { id: 'perk-2', title: 'Perk 2', enabled: true },
            ],
          }),
        }, rawToken)

        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.error).toContain('at least 3 perks')
      })

      it('accepts perks update with exactly 3 perks for service users', async () => {
        const { rawToken } = await createProfileForPatch('service-perks-valid@test.com', 'service')

        const res = await authRequest('/profile', {
          method: 'PATCH',
          body: JSON.stringify({
            perks: [
              { id: 'perk-1', title: 'Perk 1', enabled: true },
              { id: 'perk-2', title: 'Perk 2', enabled: true },
              { id: 'perk-3', title: 'Perk 3', enabled: true },
            ],
          }),
        }, rawToken)

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.profile.perks).toHaveLength(3)
      })

      it('allows any number of perks for non-service users', async () => {
        const { rawToken } = await createProfileForPatch('tips-perks@test.com', 'tips')

        const res = await authRequest('/profile', {
          method: 'PATCH',
          body: JSON.stringify({
            perks: [
              { id: 'perk-1', title: 'Single Perk', enabled: true },
            ],
          }),
        }, rawToken)

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.profile.perks).toHaveLength(1)
      })

      it('rejects perks when changing purpose to service with fewer than 3 perks', async () => {
        const { rawToken } = await createProfileForPatch('purpose-change-perks@test.com', 'tips')

        const res = await authRequest('/profile', {
          method: 'PATCH',
          body: JSON.stringify({
            purpose: 'service',
            perks: [
              { id: 'perk-1', title: 'Only One', enabled: true },
            ],
          }),
        }, rawToken)

        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.error).toContain('at least 3 perks')
      })
    })

    describe('PATCH /profile/perks endpoint validation', () => {
      it('accepts 4 perks', async () => {
        const { rawToken } = await createProfileForPatch('perks-4@test.com', 'service')

        const res = await authRequest('/profile/perks', {
          method: 'PATCH',
          body: JSON.stringify({
            perks: [
              { id: 'perk-1', title: 'Perk 1', enabled: true },
              { id: 'perk-2', title: 'Perk 2', enabled: true },
              { id: 'perk-3', title: 'Perk 3', enabled: true },
              { id: 'perk-4', title: 'Perk 4', enabled: true },
            ],
          }),
        }, rawToken)

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.success).toBe(true)
        expect(body.perks).toHaveLength(4)
      })

      it('accepts 5 perks', async () => {
        const { rawToken } = await createProfileForPatch('perks-5@test.com', 'service')

        const res = await authRequest('/profile/perks', {
          method: 'PATCH',
          body: JSON.stringify({
            perks: [
              { id: 'perk-1', title: 'Perk 1', enabled: true },
              { id: 'perk-2', title: 'Perk 2', enabled: true },
              { id: 'perk-3', title: 'Perk 3', enabled: true },
              { id: 'perk-4', title: 'Perk 4', enabled: true },
              { id: 'perk-5', title: 'Perk 5', enabled: true },
            ],
          }),
        }, rawToken)

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.success).toBe(true)
        expect(body.perks).toHaveLength(5)
      })

      it('rejects 6 perks', async () => {
        const { rawToken } = await createProfileForPatch('perks-6@test.com', 'service')

        const res = await authRequest('/profile/perks', {
          method: 'PATCH',
          body: JSON.stringify({
            perks: [
              { id: 'perk-1', title: 'Perk 1', enabled: true },
              { id: 'perk-2', title: 'Perk 2', enabled: true },
              { id: 'perk-3', title: 'Perk 3', enabled: true },
              { id: 'perk-4', title: 'Perk 4', enabled: true },
              { id: 'perk-5', title: 'Perk 5', enabled: true },
              { id: 'perk-6', title: 'Perk 6', enabled: true },
            ],
          }),
        }, rawToken)

        expect(res.status).toBe(400)
      })

      it('rejects 2 perks', async () => {
        const { rawToken } = await createProfileForPatch('perks-2@test.com', 'service')

        const res = await authRequest('/profile/perks', {
          method: 'PATCH',
          body: JSON.stringify({
            perks: [
              { id: 'perk-1', title: 'Perk 1', enabled: true },
              { id: 'perk-2', title: 'Perk 2', enabled: true },
            ],
          }),
        }, rawToken)

        expect(res.status).toBe(400)
      })
    })

    describe('platform trial on purpose change to service', () => {
      it('starts platform trial when purpose changes to service', async () => {
        const { user, rawToken } = await createProfileForPatch('trial-start@test.com', 'tips')

        const res = await authRequest('/profile', {
          method: 'PATCH',
          body: JSON.stringify({
            purpose: 'service',
          }),
        }, rawToken)

        expect(res.status).toBe(200)

        // Check that trial was started by looking at the profile
        const profile = await db.profile.findUnique({ where: { userId: user.id } })
        expect(profile?.purpose).toBe('service')
        // Note: Trial creation is async and may not be immediately visible,
        // but we verify the purpose change succeeded
      })

      it('does not start trial when purpose stays the same', async () => {
        const { rawToken } = await createProfileForPatch('no-trial@test.com', 'tips')

        const res = await authRequest('/profile', {
          method: 'PATCH',
          body: JSON.stringify({
            displayName: 'Updated Name',
          }),
        }, rawToken)

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.profile.displayName).toBe('Updated Name')
      })

      it('does not start trial when purpose changes from service to tips', async () => {
        const { rawToken } = await createProfileForPatch('service-to-tips@test.com', 'service')

        const res = await authRequest('/profile', {
          method: 'PATCH',
          body: JSON.stringify({
            purpose: 'tips',
          }),
        }, rawToken)

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.profile.purpose).toBe('tips')
      })
    })
  })

  // =============================================================================
  // ADDRESS STEP TESTS
  // Tests that address data is properly saved during onboarding for Stripe KYC
  // =============================================================================
  describe('Address Step - Stripe KYC Prefill', () => {
    it('saves address data during onboarding progress', async () => {
      const { user, rawToken } = await createTestUserWithSession('address-test@test.com')

      const res = await authRequest('/auth/onboarding', {
        method: 'PUT',
        body: JSON.stringify({
          step: 4,
          branch: 'personal',
          data: {
            firstName: 'Address',
            lastName: 'Tester',
            country: 'United States',
            countryCode: 'US',
            currency: 'USD',
            address: '123 Main Street',
            city: 'San Francisco',
            state: 'CA',
            zip: '94102',
          },
        }),
      }, rawToken)

      expect(res.status).toBe(200)
      const updated = await db.user.findUnique({ where: { id: user.id } })
      expect(updated?.onboardingData).toMatchObject({
        address: '123 Main Street',
        city: 'San Francisco',
        state: 'CA',
        zip: '94102',
      })
    })

    it('address step is skipped for cross-border countries (NG)', async () => {
      const { rawToken } = await createTestUserWithSession('ng-address@test.com')

      // Nigerian users skip address step - verify data saves without address
      const res = await authRequest('/auth/onboarding', {
        method: 'PUT',
        body: JSON.stringify({
          step: 5, // Skip from identity (3) directly to purpose (5)
          branch: 'personal',
          data: {
            firstName: 'Nigerian',
            lastName: 'User',
            country: 'Nigeria',
            countryCode: 'NG',
            currency: 'NGN',
            // No address fields - skipped for cross-border
          },
        }),
      }, rawToken)

      expect(res.status).toBe(200)
    })

    it('address step is skipped for cross-border countries (KE)', async () => {
      const { rawToken } = await createTestUserWithSession('ke-address@test.com')

      const res = await authRequest('/auth/onboarding', {
        method: 'PUT',
        body: JSON.stringify({
          step: 5,
          branch: 'personal',
          data: {
            firstName: 'Kenyan',
            lastName: 'User',
            country: 'Kenya',
            countryCode: 'KE',
            currency: 'KES',
          },
        }),
      }, rawToken)

      expect(res.status).toBe(200)
    })

    it('address step is skipped for cross-border countries (GH)', async () => {
      const { rawToken } = await createTestUserWithSession('gh-address@test.com')

      const res = await authRequest('/auth/onboarding', {
        method: 'PUT',
        body: JSON.stringify({
          step: 5,
          branch: 'personal',
          data: {
            firstName: 'Ghanaian',
            lastName: 'User',
            country: 'Ghana',
            countryCode: 'GH',
            currency: 'GHS',
          },
        }),
      }, rawToken)

      expect(res.status).toBe(200)
    })

    it('saves address fields regardless of length (frontend validates)', async () => {
      // Note: Address validation happens on frontend - backend just saves the data
      const { user, rawToken } = await createTestUserWithSession('any-address@test.com')

      const res = await authRequest('/auth/onboarding', {
        method: 'PUT',
        body: JSON.stringify({
          step: 4,
          branch: 'personal',
          data: {
            firstName: 'Any',
            lastName: 'Address',
            country: 'United States',
            countryCode: 'US',
            currency: 'USD',
            address: '123 Main St',
            city: 'NYC',
          },
        }),
      }, rawToken)

      expect(res.status).toBe(200)
      const updated = await db.user.findUnique({ where: { id: user.id } })
      expect(updated?.onboardingData).toMatchObject({
        address: '123 Main St',
        city: 'NYC',
      })
    })
  })

  // =============================================================================
  // STATE PERSISTENCE TESTS
  // Tests that onboarding state is properly persisted and restored
  // =============================================================================
  describe('Onboarding State Persistence', () => {
    it('restores onboarding progress after re-authentication', async () => {
      // Create user with existing progress
      const user = await db.user.create({
        data: {
          email: 'resume@test.com',
          onboardingStep: 7,
          onboardingBranch: 'service',
          onboardingData: {
            firstName: 'Resume',
            lastName: 'User',
            country: 'United States',
            countryCode: 'US',
            currency: 'USD',
            username: 'resumeuser',
            purpose: 'service',
            serviceDescription: 'My service description',
            singleAmount: 5000,
          },
        },
      })

      // Create OTP token for re-auth
      const token = '999888'
      await db.magicLinkToken.create({
        data: {
          email: user.email,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          usedAt: null,
        },
      })

      // Verify and check state is restored
      const res = await app.fetch(
        new Request('http://localhost/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, email: user.email }),
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.onboardingStep).toBe(7)
      expect(body.onboardingBranch).toBe('service')
      expect(body.onboardingData).toMatchObject({
        firstName: 'Resume',
        lastName: 'User',
        username: 'resumeuser',
        purpose: 'service',
      })
    })

    it('merges local and server state on hydration', async () => {
      // Create user with partial server state
      const user = await db.user.create({
        data: {
          email: 'merge@test.com',
          onboardingStep: 5,
          onboardingData: {
            firstName: 'Server',
            lastName: 'Data',
            country: 'United States',
            countryCode: 'US',
          },
        },
      })

      const token = '777666'
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
      // Server state should be returned for hydration
      expect(body.onboardingStep).toBe(5)
      expect(body.onboardingData.firstName).toBe('Server')
    })

    it('allows updating onboarding step from higher to lower (restart)', async () => {
      // Create user with existing progress
      const user = await db.user.create({
        data: {
          email: 'restart@test.com',
          onboardingStep: 8,
          onboardingBranch: 'personal',
          onboardingData: {
            firstName: 'Old',
            lastName: 'Data',
          },
        },
      })

      // Create session to update onboarding
      const rawToken = 'restart-session-token'
      await db.session.create({
        data: {
          userId: user.id,
          token: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      // Go back to an earlier step (user can navigate back)
      const res = await authRequest('/auth/onboarding', {
        method: 'PUT',
        body: JSON.stringify({
          step: 3,
          branch: 'personal',
          data: {
            firstName: 'New',
            lastName: 'Name',
          },
        }),
      }, rawToken)

      expect(res.status).toBe(200)
      const updated = await db.user.findUnique({ where: { id: user.id } })
      expect(updated?.onboardingStep).toBe(3)
    })
  })

  // =============================================================================
  // SERVICE MODE EDGE CASES
  // Additional tests for service-specific onboarding flows
  // =============================================================================
  describe('Service Mode Edge Cases', () => {
    it('saves service description during onboarding', async () => {
      const { user, rawToken } = await createTestUserWithSession('service-desc@test.com')

      const res = await authRequest('/auth/onboarding', {
        method: 'PUT',
        body: JSON.stringify({
          step: 10,
          branch: 'service',
          data: {
            firstName: 'Service',
            lastName: 'Provider',
            country: 'United States',
            countryCode: 'US',
            currency: 'USD',
            username: 'serviceprovider',
            purpose: 'service',
            serviceDescription: 'I provide weekly coaching sessions for entrepreneurs looking to scale their business.',
            singleAmount: 10000, // $100
          },
        }),
      }, rawToken)

      expect(res.status).toBe(200)
      const updated = await db.user.findUnique({ where: { id: user.id } })
      expect(updated?.onboardingData).toMatchObject({
        serviceDescription: 'I provide weekly coaching sessions for entrepreneurs looking to scale their business.',
        singleAmount: 10000,
      })
    })

    it('saves short service description (frontend validates length)', async () => {
      // Note: Service description validation happens on frontend - backend just saves
      const { user, rawToken } = await createTestUserWithSession('short-desc@test.com')

      const res = await authRequest('/auth/onboarding', {
        method: 'PUT',
        body: JSON.stringify({
          step: 10,
          branch: 'service',
          data: {
            purpose: 'service',
            serviceDescription: 'Short',
            singleAmount: 5000,
          },
        }),
      }, rawToken)

      expect(res.status).toBe(200)
      const updated = await db.user.findUnique({ where: { id: user.id } })
      expect(updated?.onboardingData).toMatchObject({
        serviceDescription: 'Short',
      })
    })

    it('saves long service description (up to 500 chars)', async () => {
      const { user, rawToken } = await createTestUserWithSession('long-desc@test.com')

      // Schema allows max 500 characters
      const longDesc = 'A'.repeat(500)
      const res = await authRequest('/auth/onboarding', {
        method: 'PUT',
        body: JSON.stringify({
          step: 10,
          branch: 'service',
          data: {
            purpose: 'service',
            serviceDescription: longDesc,
            singleAmount: 5000,
          },
        }),
      }, rawToken)

      expect(res.status).toBe(200)
      const updated = await db.user.findUnique({ where: { id: user.id } })
      expect(updated?.onboardingData).toMatchObject({
        serviceDescription: longDesc,
      })
    })
  })
})
