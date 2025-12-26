import { test, expect } from '@playwright/test';
import path from 'path';

// Always use local backend for E2E tests (not production)
const API_URL = 'http://localhost:3001';
const APP_URL = 'http://localhost:5173';

// Use shorter unique IDs for testing
const uniqueId = Date.now().toString(36);
const CREATOR_EMAIL = `e2e_${uniqueId}@test.com`;
const CREATOR_USERNAME = `e2e${uniqueId}`;
const CREATOR_FIRST_NAME = 'Test';
const CREATOR_LAST_NAME = 'Creator';
const SUBSCRIBER_EMAIL = `sub_${uniqueId}@test.com`;

test.describe('Creator Journey (Golden Path)', () => {

  test('Full flow: Onboard -> Connect Stripe (Stub) -> Public Page -> Subscribe (Stub)', async ({ page, request }) => {
    // Stub media upload to avoid hitting real storage
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
      await route.fulfill({ status: 404, body: '' });
    });

    // 1. Creator Login (Backdoor) - calls backend directly
    console.log(`[E2E] Logging in with email: ${CREATOR_EMAIL}`);
    const loginRes = await request.post(`${API_URL}/auth/e2e-login`, {
      data: { email: CREATOR_EMAIL }
    });
    console.log(`[E2E] Login response status: ${loginRes.status()}`);
    expect(loginRes.ok()).toBeTruthy();

    // Get the login response body which includes the token
    const loginBody = await loginRes.json();
    const token = loginBody.token;
    const redirectTo = loginBody.onboarding?.redirectTo || '/onboarding?step=3';
    console.log(`[E2E] Redirect URL: ${redirectTo}`);

    // Visit the app first to access localStorage on the correct origin
    await page.goto('/');

    // Set the auth token in localStorage (like mobile auth flow)
    // This is more reliable than cookies for cross-port E2E testing
    await page.evaluate((authToken) => {
      localStorage.setItem('nate_auth_token', authToken);
      localStorage.setItem('nate_has_session', 'true');
    }, token);

    // 2. Navigate to onboarding with the step parameter
    // e2e-login creates user with onboardingStep: 3
    await page.goto(redirectTo);
    await expect(page).toHaveURL(/\/onboarding/);

    // Wait for the IdentityStep to load - look for the heading
    await expect(page.locator('h1:has-text("What should we call you?")')).toBeVisible({ timeout: 10000 });

    // Fill name
    await page.fill('input[placeholder="First name"]', CREATOR_FIRST_NAME);
    await page.fill('input[placeholder="Last name"]', CREATOR_LAST_NAME);

    // Select country - choose Nigeria to skip address step
    await page.click('.country-selector');
    await expect(page.locator('.country-drawer')).toBeVisible();
    await page.click('.country-option:has-text("Nigeria")');

    // Click Continue
    await page.click('button:has-text("Continue")');

    // 3. PersonalUsernameStep - "Claim your link"
    await expect(page.locator('h1:has-text("Claim your link")')).toBeVisible({ timeout: 10000 });

    // Fill username (placeholder="yourname")
    await page.fill('input[placeholder="yourname"]', CREATOR_USERNAME);

    // Wait for availability check to complete - look for "✓ Available" or just the success indicator
    await expect(page.locator('.username-helper-success')).toBeVisible({ timeout: 10000 });

    // Click Continue
    await page.click('button:has-text("Continue")');

    // 4. PaymentMethodStep - "Connect payments"
    await expect(page.locator('h1:has-text("Connect payments")')).toBeVisible({ timeout: 10000 });

    // Select Stripe (click the payment method card)
    await page.click('.payment-method-card:has-text("Stripe")');

    // Click "Connect with Stripe" - in stub mode, this returns alreadyOnboarded: true
    // which immediately proceeds to the next step
    await page.click('button:has-text("Connect with Stripe")');

    // 5. PersonalReviewStep - "Set up your page"
    await expect(page.locator('h1:has-text("Set up your page")')).toBeVisible({ timeout: 15000 });

    // Upload avatar (required)
    const avatarPath = path.join(process.cwd(), 'public', 'logo.svg');
    await page.setInputFiles('input[type="file"]', avatarPath);
    await expect(page.locator('.setup-avatar-image')).toBeVisible({ timeout: 10000 });

    // Click "Launch My Page"
    await page.click('button:has-text("Launch My Page")');

    // Should redirect to public page
    await expect(page).toHaveURL(`/${CREATOR_USERNAME}`, { timeout: 15000 });

    // 6. Visit Public Page (as Subscriber)
    // Clear auth storage to simulate a new anonymous user
    await page.context().clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto(`/${CREATOR_USERNAME}`);

    // Verify creator page loaded - look for the creator's name or username
    await expect(page.locator(`text=${CREATOR_FIRST_NAME} ${CREATOR_LAST_NAME}`)).toBeVisible({ timeout: 10000 });

    // 7. Subscribe flow
    // Click the main subscribe button
    await page.click('button:has-text("Subscribe")');

    // A subscription form/modal should appear - fill email
    await page.fill('input[type="email"]', SUBSCRIBER_EMAIL);

    // Click the confirm/continue button
    await page.click('button:has-text("Continue")');

    // 8. STUB CHECKOUT - should redirect back with success
    // In stub mode, the checkout URL immediately redirects to success page
    // Look for success indicators (the exact text may vary)
    await expect(page.locator('text=/success|subscribed|thank you/i')).toBeVisible({ timeout: 15000 });
  });

});
