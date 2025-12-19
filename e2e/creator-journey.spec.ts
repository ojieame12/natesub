import { test, expect } from '@playwright/test';

const CREATOR_EMAIL = `creator_${Date.now()}@example.com`;
const CREATOR_USERNAME = `creator_${Date.now()}`;
const SUBSCRIBER_EMAIL = `sub_${Date.now()}@example.com`;

test.describe('Creator Journey (Golden Path)', () => {
  
  test('Full flow: Onboard -> Connect Stripe (Stub) -> Public Page -> Subscribe (Stub)', async ({ page, request, baseURL }) => {
    // 1. Creator Login (Backdoor)
    const loginRes = await request.post(`${baseURL}/api/auth/e2e-login`, {
      data: { email: CREATOR_EMAIL }
    });
    expect(loginRes.ok()).toBeTruthy();
    
    // Set cookie in browser context (Playwright automatically shares cookies if we used browser context, but here we used APIRequest context which is separate. We need to manually set cookie or visit a page to set it.)
    // Actually, request.post sets cookies in the APIRequestContext, not the BrowserContext of 'page'.
    // We need to get the cookie from loginRes and add it to 'page'.
    const loginBody = await loginRes.json();
    const headers = loginRes.headers();
    // In a real app, the cookie is set via Set-Cookie header. 
    // Playwright APIRequestContext handles this automatically for subsequent API calls, but for 'page' we need to transfer it.
    // However, our backend e2e-login also returns the token in the body for mobile apps. We can use that if we want, 
    // but typically web relies on httpOnly cookies.
    
    // Easier way: Extract Set-Cookie header manually or just use the token to set a cookie.
    // Since our backend sets httpOnly cookie, we can't read it via document.cookie.
    // We'll parse the Set-Cookie header.
    const setCookie = headers['set-cookie'];
    if (setCookie) {
      const sessionPart = setCookie.split(';')[0];
      const [name, value] = sessionPart.split('=');
      await page.context().addCookies([{
        name,
        value,
        domain: 'localhost', // or 127.0.0.1
        path: '/',
      }]);
    }

    // 2. Onboarding: Identity Step
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/onboarding/);
    
    // Fill Identity
    await page.fill('input[name="username"]', CREATOR_USERNAME);
    await page.fill('input[name="displayName"]', 'Test Creator');
    // Country might be a select or inferred. Assuming defaults or simple input for now.
    // If it's a select:
    // await page.click('text=Select Country');
    // await page.click('text=United States');
    // For now, let's assume the test user creation in e2e-login didn't set full profile, so we are at step 3.
    
    await page.click('button:has-text("Continue")');

    // 3. Profile Step (Bio)
    await expect(page.locator('text=Tell us about yourself')).toBeVisible();
    await page.fill('textarea[name="bio"]', 'This is an E2E test bio.');
    await page.click('button:has-text("Continue")');

    // 4. Payment Method Step (Connect Stripe)
    await expect(page.locator('text=Connect payments')).toBeVisible();
    await page.click('text=Stripe'); // Select Stripe
    await page.click('button:has-text("Connect with Stripe")');

    // STUB REDIRECT CHECK
    // Should go to /payment/stub?... -> then redirect back to /onboarding?step=6 (Launch)
    // We expect to end up at Launch Review
    await expect(page.locator('text=Review & Launch')).toBeVisible({ timeout: 10000 });

    // 5. Launch
    await page.click('button:has-text("Launch Page")');
    await expect(page).toHaveURL('/dashboard');

    // 6. Visit Public Page (as Subscriber)
    // Clear cookies to simulate new user
    await page.context().clearCookies();
    await page.goto(`/${CREATOR_USERNAME}`);
    await expect(page.locator(`text=${CREATOR_USERNAME}`)).toBeVisible();

    // 7. Subscribe
    await page.click('button:has-text("Subscribe")'); // Or whatever the main CTA is
    
    // Enter Email
    await page.fill('input[type="email"]', SUBSCRIBER_EMAIL);
    await page.click('button:has-text("Continue")'); // Or "Subscribe"

    // STUB CHECKOUT
    // Should redirect to stub URL and back to success
    // Verification: Look for success message
    await expect(page.locator('text=Payment Successful')).toBeVisible({ timeout: 15000 });
  });

});
