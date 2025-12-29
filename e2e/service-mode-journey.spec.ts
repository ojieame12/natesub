import { test, expect } from '@playwright/test';
import path from 'path';

// Always use local backend for E2E tests (not production)
const API_URL = 'http://localhost:3001';
const APP_URL = 'http://localhost:5173';

// Use shorter unique IDs for testing
const uniqueId = Date.now().toString(36);
const CREATOR_EMAIL = `svc_${uniqueId}@test.com`;
const CREATOR_USERNAME = `svc${uniqueId}`;
const CREATOR_FIRST_NAME = 'Service';
const CREATOR_LAST_NAME = 'Creator';
const SERVICE_DESCRIPTION = 'I offer weekly 1-on-1 coaching sessions to help entrepreneurs build their personal brand and grow their business.';
const SERVICE_PRICE = '50';

test.describe('Service Mode Journey', () => {

  test('Full service flow: Onboard with service purpose -> AI Generation -> Launch with perks', async ({ page, request }) => {
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

    // Stub AI perks generation to avoid hitting real AI
    await page.route('**/ai/generate-perks', async (route) => {
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

    // Stub AI banner generation
    await page.route('**/ai/generate-banner', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          bannerUrl: `${APP_URL}/logo.svg`,
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

    // Set the auth token in localStorage (like mobile auth flow)
    await page.evaluate((authToken) => {
      localStorage.setItem('nate_auth_token', authToken);
      localStorage.setItem('nate_has_session', 'true');
    }, token);

    // 2. Navigate to onboarding - IdentityStep (step 3)
    await page.goto(redirectTo);
    await expect(page).toHaveURL(/\/onboarding/);

    // Wait for the IdentityStep to load
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

    // 3. PurposeStep - "What's this for?"
    await expect(page.locator('h1:has-text("What\'s this for?")')).toBeVisible({ timeout: 10000 });

    // Select "Services" purpose
    await page.click('.purpose-step-card:has-text("Services")');

    // 4. AvatarUploadStep - Upload avatar
    await expect(page.locator('h1:has-text("Add a photo")')).toBeVisible({ timeout: 10000 });

    // Upload avatar
    const avatarPath = path.join(process.cwd(), 'public', 'logo.svg');
    await page.setInputFiles('input[type="file"]', avatarPath);

    // Wait for upload to complete and continue button to be enabled
    await expect(page.locator('.avatar-preview img, .avatar-upload-preview img')).toBeVisible({ timeout: 10000 });

    // Click Continue
    await page.click('button:has-text("Continue")');

    // 5. PersonalUsernameStep - "Claim your link"
    await expect(page.locator('h1:has-text("Claim your link")')).toBeVisible({ timeout: 10000 });

    // Fill username
    await page.fill('input[placeholder="yourname"]', CREATOR_USERNAME);

    // Wait for availability check
    await expect(page.locator('.username-helper-success')).toBeVisible({ timeout: 10000 });

    // Click Continue
    await page.click('button:has-text("Continue")');

    // 6. PaymentMethodStep - "Connect payments"
    await expect(page.locator('h1:has-text("Connect payments")')).toBeVisible({ timeout: 10000 });

    // Select Stripe
    await page.click('.payment-method-card:has-text("Stripe")');

    // Click "Connect with Stripe" - stub returns alreadyOnboarded: true
    await page.click('button:has-text("Connect with Stripe")');

    // 7. ServiceDescriptionStep - "Describe your service"
    await expect(page.locator('h1:has-text("Describe your service")')).toBeVisible({ timeout: 10000 });

    // Fill service description
    await page.fill('textarea', SERVICE_DESCRIPTION);

    // Fill price
    await page.fill('.service-price-input', SERVICE_PRICE);

    // Click Continue
    await page.click('button:has-text("Continue")');

    // 8. AIGeneratingStep - Wait for AI generation (stubbed)
    // The AI step auto-advances after generation completes
    // We should see the loading state briefly then move to Review
    await expect(page.locator('text=/Analyzing|Crafting|Creating|Almost ready/i')).toBeVisible({ timeout: 5000 });

    // 9. PersonalReviewStep - "Set up your page"
    await expect(page.locator('h1:has-text("Set up your page")')).toBeVisible({ timeout: 15000 });

    // Verify perks are displayed (3 perks from AI)
    await expect(page.locator('.service-perk-item')).toHaveCount(3, { timeout: 5000 });

    // Verify service description is shown
    await expect(page.locator('textarea.service-description-input')).toHaveValue(SERVICE_DESCRIPTION);

    // Purpose should show "Services" and be locked (no chevron)
    await expect(page.locator('.setup-purpose-value:has-text("Services")')).toBeVisible();

    // Click "Launch My Page"
    await page.click('button:has-text("Launch My Page")');

    // Should redirect to public page
    await expect(page).toHaveURL(`/${CREATOR_USERNAME}`, { timeout: 15000 });

    // 10. Verify Public Page shows service mode elements
    // Verify creator name is displayed
    await expect(page.locator(`text=${CREATOR_FIRST_NAME} ${CREATOR_LAST_NAME}`)).toBeVisible({ timeout: 10000 });

    // Verify "Retainer" badge or service mode indicator
    await expect(page.locator('text=/Retainer|Services/i')).toBeVisible({ timeout: 5000 });

    // Verify perks are shown on public page
    await expect(page.locator('text=/Weekly 1-on-1|Personalized action|Priority email/i')).toBeVisible({ timeout: 5000 });

    console.log('[E2E] Service mode journey completed successfully!');
  });

  test('Service mode: Skip AI and add perks manually', async ({ page, request }) => {
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
      await route.fulfill({ status: 404, body: '' });
    });

    // Make AI generation slow so we can test skip button
    await page.route('**/ai/generate-perks', async (route) => {
      // Delay response to simulate slow AI
      await new Promise(resolve => setTimeout(resolve, 10000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ perks: [] }),
      });
    });

    const uniqueId2 = Date.now().toString(36);
    const email = `skip_${uniqueId2}@test.com`;
    const username = `skip${uniqueId2}`;

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
    await page.fill('input[placeholder="First name"]', 'Skip');
    await page.fill('input[placeholder="Last name"]', 'Test');
    await page.click('.country-selector');
    await page.click('.country-option:has-text("Nigeria")');
    await page.click('button:has-text("Continue")');

    // PurposeStep - Select Services
    await expect(page.locator('h1:has-text("What\'s this for?")')).toBeVisible({ timeout: 10000 });
    await page.click('.purpose-step-card:has-text("Services")');

    // AvatarUploadStep
    await expect(page.locator('h1:has-text("Add a photo")')).toBeVisible({ timeout: 10000 });
    const avatarPath = path.join(process.cwd(), 'public', 'logo.svg');
    await page.setInputFiles('input[type="file"]', avatarPath);
    await expect(page.locator('.avatar-preview img, .avatar-upload-preview img')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Continue")');

    // UsernameStep
    await expect(page.locator('h1:has-text("Claim your link")')).toBeVisible({ timeout: 10000 });
    await page.fill('input[placeholder="yourname"]', username);
    await expect(page.locator('.username-helper-success')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Continue")');

    // PaymentMethodStep
    await expect(page.locator('h1:has-text("Connect payments")')).toBeVisible({ timeout: 10000 });
    await page.click('.payment-method-card:has-text("Stripe")');
    await page.click('button:has-text("Connect with Stripe")');

    // ServiceDescriptionStep
    await expect(page.locator('h1:has-text("Describe your service")')).toBeVisible({ timeout: 10000 });
    await page.fill('textarea', 'Test service description for manual perk entry testing.');
    await page.fill('.service-price-input', '25');
    await page.click('button:has-text("Continue")');

    // AIGeneratingStep - Click skip button
    await expect(page.locator('.ai-generating-skip, button:has-text("Skip")')).toBeVisible({ timeout: 5000 });
    await page.click('.ai-generating-skip, button:has-text("Skip")');

    // PersonalReviewStep - Should have 0 perks, need to add manually
    await expect(page.locator('h1:has-text("Set up your page")')).toBeVisible({ timeout: 10000 });

    // Verify no perks yet
    await expect(page.locator('.service-perk-item')).toHaveCount(0);

    // Add 3 perks manually
    for (let i = 1; i <= 3; i++) {
      await page.click('.service-perk-add-btn, button:has-text("Add perk")');
      await page.fill('.service-perk-add-form input', `Manual perk ${i}`);
      await page.click('.service-perk-save');
    }

    // Verify 3 perks now exist
    await expect(page.locator('.service-perk-item')).toHaveCount(3);

    // Launch
    await page.click('button:has-text("Launch My Page")');

    // Should redirect to public page
    await expect(page).toHaveURL(`/${username}`, { timeout: 15000 });

    console.log('[E2E] Service mode skip + manual perks journey completed!');
  });

});
