/**
 * E2E Test Fixtures - Provides API stubs for UI Smoke testing
 *
 * ARCHITECTURE NOTE:
 * This file provides route stubs for "UI Smoke" tests that validate
 * page rendering without database dependencies.
 *
 * For "E2E Integration" tests that validate real flows, use:
 * - e2eLogin() from auth.helper.ts to create real users
 * - Only stub external providers (Stripe, Paystack, ipapi)
 * - Let requests flow to the real backend
 *
 * Current approach (UI Smoke):
 * - Fast and reliable
 * - No DB cold-start issues
 * - Tests UI rendering and client-side logic
 * - Does NOT test server persistence or API behavior
 *
 * Future approach (E2E Integration):
 * - Use local test database (not Neon)
 * - Use seedTestCreator() from auth.helper.ts
 * - Only stub external checkout URLs
 * - Tests full flow including persistence
 */

import { Page } from '@playwright/test';

const APP_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3001';

export interface TestUser {
  id: string;
  email: string;
  token: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  hasProfile?: boolean;
  paymentProvider?: 'stripe' | 'paystack';
  stripeAccountId?: string;
  paystackSubaccountCode?: string;
}

export function createTestUser(overrides: Partial<TestUser> = {}): TestUser {
  const uniqueId = Date.now().toString(36);
  return {
    id: `user_${uniqueId}`,
    email: `e2e_${uniqueId}@test.com`,
    token: `test_token_${uniqueId}`,
    username: `e2e${uniqueId}`,
    firstName: 'Test',
    lastName: 'Creator',
    country: 'NG',
    hasProfile: false,
    paymentProvider: 'stripe',
    stripeAccountId: `acct_test_${uniqueId}`,
    ...overrides,
  };
}

/**
 * Setup all API stubs for a complete onboarding flow test
 */
export async function setupOnboardingStubs(page: Page, user: TestUser) {
  const now = new Date().toISOString();

  // Stub e2e-login endpoint
  await page.route('**/auth/e2e-login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: user.token,
        user: {
          id: user.id,
          email: user.email,
          createdAt: now,
        },
        onboarding: {
          hasProfile: user.hasProfile,
          hasActivePayment: false,
          step: 3,
          branch: 'personal',
          data: null,
          redirectTo: '/onboarding?step=identity',
        },
      }),
    });
  });

  // Stub auth/me endpoint - returns current user state
  await page.route('**/auth/me', async (route) => {
    const profileData = user.hasProfile ? {
      id: `profile_${user.id}`,
      userId: user.id,
      username: user.username,
      displayName: `${user.firstName} ${user.lastName}`,
      bio: null,
      avatarUrl: null,
      paymentProvider: user.paymentProvider,
      stripeAccountId: user.stripeAccountId,
      paystackSubaccountCode: user.paystackSubaccountCode,
      country: user.country,
      currency: user.country === 'NG' ? 'NGN' : 'USD',
    } : null;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: user.id,
        email: user.email,
        createdAt: now,
        profile: profileData,
        onboarding: {
          hasProfile: user.hasProfile,
          hasActivePayment: !!profileData?.stripeAccountId || !!profileData?.paystackSubaccountCode,
          step: user.hasProfile ? 0 : 3,
          branch: 'personal',
          data: null,
          redirectTo: user.hasProfile ? '/dashboard' : '/onboarding?step=identity',
        },
      }),
    });
  });

  // Stub profile endpoint (GET/PUT/PATCH /profile)
  await page.route('**/profile', async (route) => {
    const method = route.request().method();

    // PUT/PATCH - Save profile updates
    if (method === 'PUT' || method === 'PATCH') {
      user.hasProfile = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profile: {
            id: `profile_${user.id}`,
            userId: user.id,
            username: user.username,
            displayName: `${user.firstName} ${user.lastName}`,
            bio: null,
            avatarUrl: `${APP_URL}/logo.svg`,
            bannerUrl: null,
            paymentProvider: user.paymentProvider,
            country: user.country,
            currency: user.country === 'NG' ? 'NGN' : 'USD',
          },
        }),
      });
      return;
    }

    // GET - Return profile or 404
    if (!user.hasProfile) {
      await route.fulfill({ status: 404, body: JSON.stringify({ error: 'Not found' }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: `profile_${user.id}`,
        userId: user.id,
        username: user.username,
        displayName: `${user.firstName} ${user.lastName}`,
        bio: null,
        avatarUrl: `${APP_URL}/logo.svg`,
        bannerUrl: null,
        paymentProvider: user.paymentProvider,
        country: user.country,
        currency: user.country === 'NG' ? 'NGN' : 'USD',
        tiers: [],
        singleAmount: 1000, // $10 or ₦1000
      }),
    });
  });

  // Stub activity/metrics endpoint
  await page.route('**/activity/metrics', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        totalSubscribers: 0,
        activeSubscribers: 0,
        newThisMonth: 0,
        churned: 0,
        mrr: 0,
        totalRevenue: 0,
      }),
    });
  });

  // Stub onboarding save endpoint
  await page.route('**/auth/onboarding', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
      return;
    }
    await route.continue();
  });

  // Stub username availability check
  await page.route('**/profile/check-username**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ available: true }),
    });
  });

  // Stub media upload
  await page.route('**/media/upload-url', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        uploadUrl: `${APP_URL}/__e2e-upload__`,
        publicUrl: `${APP_URL}/logo.svg`,
      }),
    });
  });
  await page.route('**/__e2e-upload__', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 200, body: '' });
      return;
    }
    await route.fulfill({ status: 404 });
  });

  // Stub Stripe Connect onboarding
  await page.route('**/stripe/connect', async (route) => {
    // Return alreadyOnboarded: true to skip actual Stripe redirect
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        alreadyOnboarded: true,
        accountId: user.stripeAccountId,
      }),
    });
  });

  // Stub Paystack bank list (route is /paystack/banks/:country)
  await page.route('**/paystack/banks/*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        banks: [
          { code: '058', name: 'Guaranty Trust Bank' },
          { code: '044', name: 'Access Bank' },
          { code: '033', name: 'United Bank for Africa' },
        ],
      }),
    });
  });

  // Stub Paystack account verification
  await page.route('**/paystack/resolve-account', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        account_name: 'PAYSTACK TEST CREATOR',
        account_number: '0123456789',
        bank_code: '058',
      }),
    });
  });

  // Stub Paystack subaccount creation
  await page.route('**/paystack/connect', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subaccountCode: user.paystackSubaccountCode || `ACCT_test_${Date.now()}`,
      }),
    });
  });

  // Stub AI endpoints for service mode
  await page.route('**/profile/generate-perks', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        perks: [
          { id: 'perk-1', title: 'Weekly 1-on-1 coaching call', enabled: true },
          { id: 'perk-2', title: 'Personalized action plan', enabled: true },
          { id: 'perk-3', title: 'Priority email support', enabled: true },
        ],
      }),
    });
  });

  await page.route('**/profile/generate-banner', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        bannerUrl: `${APP_URL}/logo.svg`,
        wasGenerated: true,
        variant: 'standard',
        generationsRemaining: 2,
      }),
    });
  });

  // Stub AI config check
  await page.route('**/config/ai', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ available: true }),
    });
  });
}

/**
 * Setup stubs for a completed creator (has profile, ready for public page)
 */
export async function setupCompletedCreatorStubs(page: Page, user: TestUser) {
  const profileData = {
    id: `profile_${user.id}`,
    userId: user.id,
    username: user.username,
    displayName: `${user.firstName} ${user.lastName}`,
    bio: 'Test creator bio',
    avatarUrl: `${APP_URL}/logo.svg`,
    bannerUrl: null,
    paymentProvider: user.paymentProvider,
    stripeAccountId: user.stripeAccountId,
    paystackSubaccountCode: user.paystackSubaccountCode,
    country: user.country,
    currency: user.country === 'NG' ? 'NGN' : 'USD',
    tiers: [],
    singleAmount: 1000,
    purpose: 'support',
  };

  // Stub public creator page fetch
  await page.route(`**/${user.username}`, async (route) => {
    // Let the page navigate, but stub the API call
    await route.continue();
  });

  // Stub public profile fetch (by username)
  await page.route(`**/users/${user.username}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        profile: profileData,
        viewerSubscription: null,
        isOwner: false,
      }),
    });
  });

  // Stub checkout session creation
  await page.route('**/checkout/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: `cs_test_${Date.now()}`,
        url: `${APP_URL}/${user.username}/success?session_id=test`,
      }),
    });
  });

  // Stub checkout success (Stripe)
  await page.route('**/checkout/success**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        subscription: {
          id: `sub_test_${Date.now()}`,
          status: 'active',
        },
      }),
    });
  });
}

/**
 * Setup auth token in localStorage
 */
export async function setAuthToken(page: Page, token: string) {
  await page.evaluate((authToken) => {
    localStorage.setItem('nate_auth_token', authToken);
    localStorage.setItem('nate_has_session', 'true');
  }, token);
}
