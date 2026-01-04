/**
 * END-TO-END FLOW TESTS
 * =====================
 *
 * These tests verify critical user journeys through the application:
 * 1. Edit Profile - Creator updates their page settings
 * 2. Launch Page - Creator makes their page live (isPublic toggle)
 * 3. Public Page - Visitors can view creator pages
 * 4. Subscribe Flow - Subscriber completes checkout for a creator
 *
 * These are integration tests that test the full request/response cycle
 * without mocking the database, ensuring routes work end-to-end.
 */

import { createHmac } from 'crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { env } from '../../src/config/env.js'
import { resetDatabase, disconnectDatabase } from '../helpers/db.js'

// Mock Stripe service for checkout tests
const mockCreateCheckoutSession = vi.fn()
const mockGetAccountStatus = vi.fn()

vi.mock('../../src/services/stripe.js', async () => {
  const actual = await vi.importActual('../../src/services/stripe.js')
  return {
    ...actual,
    createCheckoutSession: (...args: any[]) => mockCreateCheckoutSession(...args),
    getAccountStatus: (...args: any[]) => mockGetAccountStatus(...args),
  }
})

// Mock email service
vi.mock('../../src/services/email.js', () => ({
  sendOtpEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
}))

// Hash function matching auth service
function hashToken(token: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex')
}

// Helper to create authenticated user with session
async function createAuthenticatedUser(email = 'test@example.com') {
  const user = await db.user.create({
    data: { email },
  })

  const rawToken = `session-${Date.now()}-${Math.random().toString(36)}`
  const session = await db.session.create({
    data: {
      userId: user.id,
      token: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  return { user, session, rawToken, cookie: `session=${rawToken}` }
}

// Helper to create a complete creator profile
async function createCreatorProfile(userId: string, overrides: any = {}) {
  return db.profile.create({
    data: {
      userId,
      username: `creator${Date.now()}`,
      displayName: 'Test Creator',
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'tips',
      pricingModel: 'single',
      singleAmount: 500, // $5.00 in cents
      isPublic: true,
      payoutStatus: 'active',
      stripeAccountId: 'acct_test_123',
      ...overrides,
    },
  })
}

// Helper for authenticated requests
function authRequest(path: string, cookie: string, options: RequestInit = {}) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        ...options.headers,
      },
    })
  )
}

// Helper for public requests
function publicRequest(path: string, options: RequestInit = {}) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
  )
}

describe('E2E Flows', () => {
  beforeEach(async () => {
    await resetDatabase()
    vi.clearAllMocks()

    // Default mock for Stripe account status
    mockGetAccountStatus.mockResolvedValue({
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    })
  })

  afterAll(async () => {
    await resetDatabase()
    await disconnectDatabase()
  })

  /**
   * EDIT PROFILE FLOW
   * =================
   * Tests that creators can update their profile settings after initial setup.
   * Uses PATCH /profile endpoint for partial updates.
   */
  describe('Edit Profile Flow', () => {
    it('allows creator to update display name', async () => {
      const { user, cookie } = await createAuthenticatedUser()
      await createCreatorProfile(user.id, { displayName: 'Original Name' })

      const res = await authRequest('/profile', cookie, {
        method: 'PATCH',
        body: JSON.stringify({ displayName: 'Updated Name' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.displayName).toBe('Updated Name')
    })

    it('allows creator to update bio', async () => {
      const { user, cookie } = await createAuthenticatedUser()
      await createCreatorProfile(user.id, { bio: null })

      const res = await authRequest('/profile', cookie, {
        method: 'PATCH',
        body: JSON.stringify({ bio: 'This is my updated bio!' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.bio).toBe('This is my updated bio!')
    })

    it('allows creator to update pricing from single to tiers', async () => {
      const { user, cookie } = await createAuthenticatedUser()
      await createCreatorProfile(user.id, {
        pricingModel: 'single',
        singleAmount: 500,
      })

      const res = await authRequest('/profile', cookie, {
        method: 'PATCH',
        body: JSON.stringify({
          pricingModel: 'tiers',
          tiers: [
            { id: 'tier-1', name: 'Basic', amount: 5.00, perks: ['Thanks'], isPopular: false },
            { id: 'tier-2', name: 'Pro', amount: 15.00, perks: ['Thanks', 'Shoutout'], isPopular: true },
          ],
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.pricingModel).toBe('tiers')
      expect(body.profile.tiers).toHaveLength(2)
      // Amounts converted to cents
      expect((body.profile.tiers as any[])[0].amount).toBe(500)
      expect((body.profile.tiers as any[])[1].amount).toBe(1500)
    })

    it('allows creator to change username if available', async () => {
      const { user, cookie } = await createAuthenticatedUser()
      const profile = await createCreatorProfile(user.id, { username: 'oldusername' })

      const res = await authRequest('/profile', cookie, {
        method: 'PATCH',
        body: JSON.stringify({ username: 'newusername' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.username).toBe('newusername')
      expect(body.profile.shareUrl).toContain('newusername')
    })

    it('rejects username change if taken by another user', async () => {
      // Create first user with username
      const { user: user1 } = await createAuthenticatedUser('user1@test.com')
      await createCreatorProfile(user1.id, { username: 'takenusername' })

      // Create second user trying to take that username
      const { user: user2, cookie: cookie2 } = await createAuthenticatedUser('user2@test.com')
      await createCreatorProfile(user2.id, { username: 'myusername' })

      const res = await authRequest('/profile', cookie2, {
        method: 'PATCH',
        body: JSON.stringify({ username: 'takenusername' }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('already taken')
    })

    it('allows creator to update avatar URL', async () => {
      const { user, cookie } = await createAuthenticatedUser()
      await createCreatorProfile(user.id)

      const newAvatarUrl = 'https://cdn.example.com/avatar.jpg'
      const res = await authRequest('/profile', cookie, {
        method: 'PATCH',
        body: JSON.stringify({ avatarUrl: newAvatarUrl }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.avatarUrl).toBe(newAvatarUrl)
    })

    it('allows creator to update template', async () => {
      const { user, cookie } = await createAuthenticatedUser()
      // Create profile without template set
      await createCreatorProfile(user.id, {})

      const res = await authRequest('/profile', cookie, {
        method: 'PATCH',
        body: JSON.stringify({ template: 'boundary' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.template).toBe('boundary')
    })

    it('rejects patch without existing profile', async () => {
      const { cookie } = await createAuthenticatedUser()
      // No profile created

      const res = await authRequest('/profile', cookie, {
        method: 'PATCH',
        body: JSON.stringify({ displayName: 'Test' }),
      })

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.error).toContain('Profile not found')
    })
  })

  /**
   * LAUNCH PAGE FLOW
   * ================
   * Tests the visibility toggle (isPublic) for creator pages.
   * Profiles start as draft (isPublic=false) until user explicitly launches.
   */
  describe('Launch Page Flow', () => {
    it('profile is draft by default after creation', async () => {
      const { user, cookie } = await createAuthenticatedUser()

      const res = await authRequest('/profile', cookie, {
        method: 'PUT',
        body: JSON.stringify({
          username: 'newcreator',
          displayName: 'New Creator',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 5.00,
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      // Profile starts as draft until "Launch My Page" step
      expect(body.profile.isPublic).toBe(false)
    })

    it('profile becomes public when isPublic is set to true', async () => {
      const { user, cookie } = await createAuthenticatedUser()

      const res = await authRequest('/profile', cookie, {
        method: 'PUT',
        body: JSON.stringify({
          username: 'launchedcreator',
          displayName: 'Launched Creator',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 5.00,
          isPublic: true, // User clicks "Launch My Page"
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.isPublic).toBe(true)
    })

    it('settings update respects isPublic value', async () => {
      const { user, cookie } = await createAuthenticatedUser()
      await createCreatorProfile(user.id, { isPublic: true })

      // Set isPublic to false (unpublish)
      const res = await authRequest('/profile/settings', cookie, {
        method: 'PATCH',
        body: JSON.stringify({ isPublic: false }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      // Settings now respects the value (can unpublish)
      expect(body.settings.isPublic).toBe(false)
    })

    it('returns correct settings for creator', async () => {
      const { user, cookie } = await createAuthenticatedUser()
      await createCreatorProfile(user.id, {
        feeMode: 'absorb', // Legacy value, should return 'split' regardless
        notificationPrefs: {
          push: true,
          email: false,
          subscriberAlerts: true,
          paymentAlerts: true,
        },
      })

      const res = await authRequest('/profile/settings', cookie)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.isPublic).toBe(true)
      expect(body.feeMode).toBe('split') // Always returns 'split' now
      expect(body.notificationPrefs.email).toBe(false)
    })

    it('ignores feeMode updates and always returns split', async () => {
      const { user, cookie } = await createAuthenticatedUser()
      await createCreatorProfile(user.id, { feeMode: 'pass_to_subscriber' })

      // Try to update feeMode - should be ignored
      const res = await authRequest('/profile/settings', cookie, {
        method: 'PATCH',
        body: JSON.stringify({ feeMode: 'absorb' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.settings.feeMode).toBe('split') // Always returns 'split'
    })
  })

  /**
   * PUBLIC PAGE FLOW
   * ================
   * Tests that visitors can view public creator pages.
   * Uses GET /users/:username endpoint.
   */
  describe('Public Page Flow', () => {
    it('returns public profile for valid username', async () => {
      const { user } = await createAuthenticatedUser()
      const profile = await createCreatorProfile(user.id, {
        username: 'publiccreator',
        displayName: 'Public Creator',
        bio: 'Welcome to my page!',
      })

      const res = await publicRequest('/users/publiccreator')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.username).toBe('publiccreator')
      expect(body.profile.displayName).toBe('Public Creator')
      expect(body.profile.bio).toBe('Welcome to my page!')
    })

    it('returns 404 for non-existent username', async () => {
      const res = await publicRequest('/users/nonexistentuser')

      expect(res.status).toBe(404)
    })

    it('returns pricing info for public page (converted to display amount)', async () => {
      const { user } = await createAuthenticatedUser()
      await createCreatorProfile(user.id, {
        username: 'pricedcreator',
        pricingModel: 'single',
        singleAmount: 1000, // $10.00 in cents
      })

      const res = await publicRequest('/users/pricedcreator')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.pricingModel).toBe('single')
      // API returns display amount (dollars), not cents
      expect(body.profile.singleAmount).toBe(10)
    })

    it('returns tier pricing for tiered creator', async () => {
      const { user } = await createAuthenticatedUser()
      await createCreatorProfile(user.id, {
        username: 'tieredcreator',
        pricingModel: 'tiers',
        tiers: [
          { id: 't1', name: 'Basic', amount: 500, perks: ['Thanks'], isPopular: false },
          { id: 't2', name: 'Pro', amount: 1500, perks: ['Thanks', 'DM'], isPopular: true },
        ],
      })

      const res = await publicRequest('/users/tieredcreator')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.profile.pricingModel).toBe('tiers')
      expect(body.profile.tiers).toHaveLength(2)
    })

    it('includes subscription status when viewer is authenticated', async () => {
      // Create creator
      const { user: creator } = await createAuthenticatedUser('creator@test.com')
      const profile = await createCreatorProfile(creator.id, { username: 'viewablecreator' })

      // Create subscriber with active subscription
      const { user: subscriber, cookie } = await createAuthenticatedUser('subscriber@test.com')
      await db.subscription.create({
        data: {
          subscriberId: subscriber.id,
          creatorId: profile.userId,
          amount: 500,
          currency: 'USD',
          interval: 'month', // Must be 'month' not 'monthly'
          status: 'active',
          provider: 'stripe',
          providerSubscriptionId: 'sub_test',
          startDate: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      })

      const res = await authRequest('/users/viewablecreator', cookie)

      expect(res.status).toBe(200)
      const body = await res.json()
      // Response uses viewerSubscription, not subscription
      expect(body.viewerSubscription).toBeDefined()
      expect(body.viewerSubscription.isActive).toBe(true)
    })
  })

  /**
   * SUBSCRIBE FLOW
   * ==============
   * Tests the checkout flow for subscribers supporting creators.
   * Uses POST /checkout/session endpoint.
   */
  describe('Subscribe Flow', () => {
    it('creates Stripe checkout session for subscriber', async () => {
      const { user } = await createAuthenticatedUser()
      await createCreatorProfile(user.id, {
        username: 'supportme',
        stripeAccountId: 'acct_creator_123',
        singleAmount: 500, // Amount must match
        payoutStatus: 'active',
      })

      mockCreateCheckoutSession.mockResolvedValue({
        id: 'cs_test_checkout',
        url: 'https://checkout.stripe.com/test',
      })

      const res = await publicRequest('/checkout/session', {
        method: 'POST',
        body: JSON.stringify({
          creatorUsername: 'supportme',
          amount: 500, // Must match singleAmount
          interval: 'month', // Must be 'month' not 'monthly'
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.provider).toBe('stripe')
      expect(body.url).toContain('stripe.com')
      expect(mockCreateCheckoutSession).toHaveBeenCalled()
    })

    it('rejects checkout for creator without payment setup', async () => {
      const { user } = await createAuthenticatedUser()
      await createCreatorProfile(user.id, {
        username: 'nopaymentssetup',
        stripeAccountId: null,
        payoutStatus: 'not_started',
      })

      const res = await publicRequest('/checkout/session', {
        method: 'POST',
        body: JSON.stringify({
          creatorUsername: 'nopaymentssetup',
          amount: 500,
          interval: 'one_time',
        }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('payment')
    })

    it('rejects checkout for non-existent creator', async () => {
      const res = await publicRequest('/checkout/session', {
        method: 'POST',
        body: JSON.stringify({
          creatorUsername: 'doesnotexist',
          amount: 500,
          interval: 'one_time',
        }),
      })

      expect(res.status).toBe(404)
    })

    it('prevents creator from subscribing to themselves', async () => {
      const { user, cookie } = await createAuthenticatedUser()
      await createCreatorProfile(user.id, {
        username: 'selfsubscribe',
        stripeAccountId: 'acct_self_123',
      })

      const res = await authRequest('/checkout/session', cookie, {
        method: 'POST',
        body: JSON.stringify({
          creatorUsername: 'selfsubscribe',
          amount: 500,
          interval: 'one_time',
        }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('cannot subscribe to your own')
    })

    it('supports one-time payments', async () => {
      const { user } = await createAuthenticatedUser()
      await createCreatorProfile(user.id, {
        username: 'onetimecreator',
        stripeAccountId: 'acct_onetime_123',
        singleAmount: 2000, // Amount must match
        payoutStatus: 'active',
      })

      mockCreateCheckoutSession.mockResolvedValue({
        id: 'cs_test_onetime',
        url: 'https://checkout.stripe.com/onetime',
      })

      const res = await publicRequest('/checkout/session', {
        method: 'POST',
        body: JSON.stringify({
          creatorUsername: 'onetimecreator',
          amount: 2000, // Must match singleAmount
          interval: 'one_time',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.provider).toBe('stripe')
    })

    it('supports monthly subscriptions', async () => {
      const { user } = await createAuthenticatedUser()
      await createCreatorProfile(user.id, {
        username: 'monthlycreator',
        stripeAccountId: 'acct_monthly_123',
        singleAmount: 1000, // Amount must match
        payoutStatus: 'active',
      })

      mockCreateCheckoutSession.mockResolvedValue({
        id: 'cs_test_monthly',
        url: 'https://checkout.stripe.com/monthly',
      })

      const res = await publicRequest('/checkout/session', {
        method: 'POST',
        body: JSON.stringify({
          creatorUsername: 'monthlycreator',
          amount: 1000, // Must match singleAmount
          interval: 'month', // Must be 'month' not 'monthly'
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.provider).toBe('stripe')
    })
  })

  /**
   * FULL ONBOARDING TO LIVE
   * =======================
   * End-to-end test of complete creator journey.
   */
  describe('Full Creator Journey', () => {
    it('creator completes full journey: signup → profile → payments → live', async () => {
      // 1. User signs up (simulated by creating user)
      const { user, cookie } = await createAuthenticatedUser('newcreator@test.com')

      // 2. User creates profile with tiers (amounts in dollars, API converts to cents)
      // isPublic: true simulates the "Launch My Page" step where profile becomes visible
      // Note: US Stripe minimum is $160 (country-based minimum for platform profitability)
      const createRes = await authRequest('/profile', cookie, {
        method: 'PUT',
        body: JSON.stringify({
          username: 'mynewpage',
          displayName: 'My New Page',
          bio: 'Welcome to my creator page!',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'tiers',
          tiers: [
            { id: 'tier-basic', name: 'Basic', amount: 165.00, perks: ['Thanks'], isPopular: true },
          ],
          paymentProvider: 'stripe',
          isPublic: true, // Profile published (simulates "Launch My Page")
        }),
      })

      expect(createRes.status).toBe(200)
      const createBody = await createRes.json()
      expect(createBody.profile.username).toBe('mynewpage')
      expect(createBody.profile.isPublic).toBe(true)
      // Verify tier amount stored in cents
      expect((createBody.profile.tiers as any[])[0].amount).toBe(16500)

      // 3. Simulate Stripe onboarding complete (update profile directly)
      await db.profile.update({
        where: { userId: user.id },
        data: {
          stripeAccountId: 'acct_new_creator',
          payoutStatus: 'active',
        },
      })

      // 4. Check onboarding status shows complete
      const statusRes = await authRequest('/profile/onboarding-status', cookie)
      expect(statusRes.status).toBe(200)
      const statusBody = await statusRes.json()
      expect(statusBody.isComplete).toBe(true)
      expect(statusBody.canAcceptPayments).toBe(true)

      // 5. Public page is accessible
      const publicRes = await publicRequest('/users/mynewpage')
      expect(publicRes.status).toBe(200)
      const publicBody = await publicRes.json()
      expect(publicBody.profile.displayName).toBe('My New Page')
      // Public API returns display amount (dollars) for tiers
      expect((publicBody.profile.tiers as any[])[0].amount).toBe(165)

      // 6. Checkout works for subscribers (amount in cents, must match a tier)
      mockCreateCheckoutSession.mockResolvedValue({
        id: 'cs_final_test',
        url: 'https://checkout.stripe.com/final',
      })

      const checkoutRes = await publicRequest('/checkout/session', {
        method: 'POST',
        body: JSON.stringify({
          creatorUsername: 'mynewpage',
          tierId: 'tier-basic',
          amount: 16500, // Cents - must match tier amount
          interval: 'month',
        }),
      })

      expect(checkoutRes.status).toBe(200)
      const checkoutBody = await checkoutRes.json()
      expect(checkoutBody.provider).toBe('stripe')
    })
  })
})
