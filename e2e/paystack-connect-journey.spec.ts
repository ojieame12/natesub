import { test, expect } from '@playwright/test';
import path from 'path';

// Always use local backend for E2E tests (not production)
const API_URL = 'http://localhost:3001';
const APP_URL = 'http://localhost:5173';

// Use shorter unique IDs for testing
const uniqueId = Date.now().toString(36);
const CREATOR_EMAIL = `ps_${uniqueId}@test.com`;
const CREATOR_USERNAME = `ps${uniqueId}`;
const CREATOR_FIRST_NAME = 'Paystack';
const CREATOR_LAST_NAME = 'Creator';

test.describe('Paystack Connect Journey (Nigerian Creator)', () => {

  test('Full flow: Onboard with Paystack -> Bank verification -> Launch', async ({ page, request }) => {
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

    // Stub Paystack bank list API
    await page.route('**/paystack/banks/*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          banks: [
            { code: '044', name: 'Access Bank', type: 'nuban' },
            { code: '058', name: 'Guaranty Trust Bank', type: 'nuban' },
            { code: '011', name: 'First Bank of Nigeria', type: 'nuban' },
            { code: '033', name: 'United Bank for Africa', type: 'nuban' },
            { code: '057', name: 'Zenith Bank', type: 'nuban' },
          ],
        }),
      });
    });

    // Stub Paystack account resolution
    await page.route('**/paystack/resolve-account', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          verified: true,
          accountName: 'PAYSTACK TEST CREATOR',
        }),
      });
    });

    // Stub Paystack connect (subaccount creation)
    await page.route('**/paystack/connect', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          subaccountCode: 'ACCT_TEST_123',
        }),
      });
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

    // Set the auth token in localStorage
    await page.evaluate((authToken) => {
      localStorage.setItem('nate_auth_token', authToken);
      localStorage.setItem('nate_has_session', 'true');
    }, token);

    // 2. Navigate to onboarding with the step parameter
    await page.goto(redirectTo);
    await expect(page).toHaveURL(/\/onboarding/);

    // Wait for the IdentityStep to load
    await expect(page.locator('h1:has-text("What should we call you?")')).toBeVisible({ timeout: 10000 });

    // Fill name
    await page.fill('input[placeholder="First name"]', CREATOR_FIRST_NAME);
    await page.fill('input[placeholder="Last name"]', CREATOR_LAST_NAME);

    // Select country - choose Nigeria (cross-border country, skips address step)
    await page.click('.country-selector');
    await expect(page.locator('.country-drawer')).toBeVisible();
    await page.click('.country-option:has-text("Nigeria")');

    // Click Continue
    await page.click('button:has-text("Continue")');

    // 3. PersonalUsernameStep - "Claim your link" (Nigeria skips address step)
    await expect(page.locator('h1:has-text("Claim your link")')).toBeVisible({ timeout: 10000 });

    // Fill username
    await page.fill('input[placeholder="yourname"]', CREATOR_USERNAME);

    // Wait for availability check
    await expect(page.locator('.username-helper-success')).toBeVisible({ timeout: 10000 });

    // Click Continue
    await page.click('button:has-text("Continue")');

    // 4. PaymentMethodStep - "Connect payments"
    await expect(page.locator('h1:has-text("Connect payments")')).toBeVisible({ timeout: 10000 });

    // Select Paystack (for Nigerian users)
    await page.click('.payment-method-card:has-text("Paystack")');

    // Paystack bank connection form should appear
    await expect(page.locator('text=/Select your bank|Bank/i')).toBeVisible({ timeout: 5000 });

    // Select a bank from the dropdown
    await page.click('.bank-selector, select[name="bank"]');
    await page.click('text=/Guaranty Trust Bank|GTBank/i');

    // Fill account number
    await page.fill('input[placeholder*="account" i], input[name="accountNumber"]', '0123456789');

    // Wait for account verification
    await expect(page.locator('text=/PAYSTACK TEST CREATOR|Verified/i')).toBeVisible({ timeout: 10000 });

    // Click "Connect Bank Account" or similar
    await page.click('button:has-text(/Connect|Continue/i)');

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

    // 6. Verify Public Page loads
    await expect(page.locator(`text=${CREATOR_FIRST_NAME} ${CREATOR_LAST_NAME}`)).toBeVisible({ timeout: 10000 });

    console.log('[E2E] Paystack connect journey completed successfully!');
  });

  test('Paystack bank verification failure handling', async ({ page, request }) => {
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

    // Stub Paystack bank list
    await page.route('**/paystack/banks/*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          banks: [
            { code: '044', name: 'Access Bank', type: 'nuban' },
          ],
        }),
      });
    });

    // Stub Paystack account resolution - FAILURE
    await page.route('**/paystack/resolve-account', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          verified: false,
          error: 'Account not found',
        }),
      });
    });

    const uniqueId2 = Date.now().toString(36);
    const email = `psfail_${uniqueId2}@test.com`;
    const username = `psfail${uniqueId2}`;

    // Login
    const loginRes = await request.post(`${API_URL}/auth/e2e-login`, {
      data: { email }
    });
    expect(loginRes.ok()).toBeTruthy();
    const loginBody = await loginRes.json();
    const token = loginBody.token;

    await page.goto('/');
    await page.evaluate((authToken) => {
      localStorage.setItem('nate_auth_token', authToken);
      localStorage.setItem('nate_has_session', 'true');
    }, token);

    // Navigate through onboarding quickly
    await page.goto('/onboarding?step=3');

    // IdentityStep
    await expect(page.locator('h1:has-text("What should we call you?")')).toBeVisible({ timeout: 10000 });
    await page.fill('input[placeholder="First name"]', 'Fail');
    await page.fill('input[placeholder="Last name"]', 'Test');
    await page.click('.country-selector');
    await page.click('.country-option:has-text("Nigeria")');
    await page.click('button:has-text("Continue")');

    // UsernameStep
    await expect(page.locator('h1:has-text("Claim your link")')).toBeVisible({ timeout: 10000 });
    await page.fill('input[placeholder="yourname"]', username);
    await expect(page.locator('.username-helper-success')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Continue")');

    // PaymentMethodStep - Select Paystack
    await expect(page.locator('h1:has-text("Connect payments")')).toBeVisible({ timeout: 10000 });
    await page.click('.payment-method-card:has-text("Paystack")');

    // Fill invalid account details
    await page.click('.bank-selector, select[name="bank"]');
    await page.click('text=/Access Bank/i');
    await page.fill('input[placeholder*="account" i], input[name="accountNumber"]', '0000000000');

    // Should see error message
    await expect(page.locator('text=/not found|invalid|error/i')).toBeVisible({ timeout: 10000 });

    console.log('[E2E] Paystack verification failure handled correctly!');
  });

});
