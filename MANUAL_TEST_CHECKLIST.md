# NatePay Manual Testing Checklist

## Pre-Deployment Setup

- [ ] Railway test environment online: `natesub-test.up.railway.app`
- [ ] Vercel frontend deployed
- [ ] Database migrations run: `railway run npx prisma migrate deploy`
- [ ] Environment variables verified (Stripe test keys, etc.)

---

## Creator Onboarding Flow (US/Stripe)

### 1. Sign Up & Magic Link
- [ ] Visit app homepage
- [ ] Click "Get Started" or sign up
- [ ] Enter email: `yourname+creator@gmail.com`
- [ ] Receive magic link email
- [ ] Click magic link → redirects to app
- [ ] Session established (not logged out)

### 2. Identity Step
- [ ] Enter first name: "Test"
- [ ] Enter last name: "Creator"
- [ ] Select country: "United States"
- [ ] Click Continue
- [ ] Advances to next step

### 3. Address Step (US only)
- [ ] Enter street: "123 Test St"
- [ ] Enter city: "San Francisco"
- [ ] Enter state: "CA"
- [ ] Enter zip: "94102"
- [ ] Click Continue

### 4. Username Step
- [ ] Enter username (unique): `testcreator123`
- [ ] Green checkmark shows (available)
- [ ] Click Continue

### 5. Purpose Step
- [ ] Select "Support" or "Services"
- [ ] Click Continue

### 6. Pricing Step
- [ ] See default $10/month
- [ ] Can edit amount
- [ ] Click Continue

### 7. Avatar Step (Optional)
- [ ] Can upload avatar or skip
- [ ] Click Continue

### 8. Payment Method (Stripe)
- [ ] Click "Connect Stripe"
- [ ] Redirected to Stripe Express onboarding
- [ ] Complete Stripe test account setup
- [ ] Redirected back to app
- [ ] See "Connected" status

### 9. Review & Publish
- [ ] See profile preview
- [ ] All info correct (name, username, price)
- [ ] Click "Publish Profile"
- [ ] Success message
- [ ] Redirected to dashboard

---

## Creator Dashboard

### Dashboard Overview
- [ ] Dashboard loads (not redirected to onboarding)
- [ ] See subscriber count (0 initially)
- [ ] See revenue metrics ($0.00)
- [ ] See activity feed (empty)
- [ ] All cards/sections render

### Profile Management
- [ ] Can edit display name
- [ ] Can edit bio
- [ ] Can change pricing
- [ ] Changes save successfully

### Analytics
- [ ] Can view analytics page
- [ ] See page views (once public link visited)
- [ ] See conversion funnel

---

## Public Creator Page

### As Anonymous Visitor
- [ ] Visit: `your-app.com/testcreator123`
- [ ] Page loads (not 404)
- [ ] See creator name
- [ ] See profile photo/avatar
- [ ] See pricing ($10/month or configured amount)
- [ ] See "Subscribe" button

---

## Subscriber Flow

### 1. Subscribe
- [ ] Click "Subscribe" on creator page
- [ ] Enter email: `yourname+sub@gmail.com`
- [ ] Click Continue
- [ ] Redirected to Stripe Checkout (or Paystack)

### 2. Payment
- [ ] Enter test card: `4242 4242 4242 4242`
- [ ] Expiry: Any future date (12/34)
- [ ] CVC: Any 3 digits (123)
- [ ] ZIP: 12345
- [ ] Click Subscribe
- [ ] Payment processes

### 3. Success Page
- [ ] Redirected to success page
- [ ] See confirmation message
- [ ] See creator info
- [ ] Receive confirmation email

### 4. Subscriber Portal
- [ ] Click "Manage subscription" link (from email)
- [ ] Or visit `/subscriptions`
- [ ] Enter subscriber email
- [ ] Enter OTP from email
- [ ] See subscription list
- [ ] Can view subscription details
- [ ] Can cancel subscription
- [ ] Cancellation works (set to cancel at period end)

---

## Creator Receives Payment

### After Subscriber Subscribes
- [ ] Creator dashboard shows +1 subscriber
- [ ] Revenue increases
- [ ] Activity feed shows new subscription
- [ ] Analytics shows conversion

### Email Notifications (if configured)
- [ ] Creator receives "New subscriber" email
- [ ] Subscriber receives "Welcome" email

---

## Cross-Border Flow (Nigeria/Paystack)

### NG Creator Onboarding
- [ ] Sign up with NG email
- [ ] Select Nigeria as country
- [ ] Skip address step (NG doesn't require)
- [ ] Connect Paystack (not Stripe)
- [ ] Complete onboarding
- [ ] Publish profile

### NG Subscriber Payment
- [ ] Visit NG creator page
- [ ] Subscribe
- [ ] Redirected to Paystack checkout
- [ ] Complete Paystack payment (test card)
- [ ] Success confirmation

---

## Billing & Platform Subscription (Service Users)

### Service Creator
- [ ] Complete onboarding with purpose: "Services"
- [ ] Auto-enrolled in 60-day free trial
- [ ] See trial info in dashboard
- [ ] Can access `/billing` page
- [ ] See trial end date
- [ ] (Optional) Add payment method for after trial

---

## Edge Cases & Error Handling

### Invalid Email
- [ ] Try signing up with `notanemail`
- [ ] See validation error
- [ ] Cannot proceed

### Taken Username
- [ ] Try username that exists
- [ ] See "Username taken" message
- [ ] Red X indicator

### Payment Failure
- [ ] Use declining test card: `4000 0000 0000 0002`
- [ ] See payment failed message
- [ ] Not charged
- [ ] Can retry

### Expired Magic Link
- [ ] Request magic link
- [ ] Wait 15+ minutes
- [ ] Try using link
- [ ] See "Link expired" message
- [ ] Can request new link

---

## API Health Checks

- [ ] Visit: `api-url/health/live` → Returns 200
- [ ] Visit: `api-url/health/ready` → Returns 200

---

## Mobile Responsiveness (Quick Check)

- [ ] Resize browser to mobile width
- [ ] Onboarding flow works
- [ ] Dashboard responsive
- [ ] Public page works
- [ ] Checkout flow works

---

## Summary Checklist

**Critical Flows:**
- [ ] Creator can onboard (US/Stripe)
- [ ] Creator can publish profile
- [ ] Public page loads
- [ ] Subscriber can pay
- [ ] Creator receives payment notification
- [ ] Subscriber portal works

**Nice-to-Have:**
- [ ] NG/Paystack flow works
- [ ] Service mode/trial works
- [ ] Analytics track correctly
- [ ] All emails deliver

---

## Issues to Log

Track any issues found:
1. 
2. 
3. 

---

## Sign-Off

- [ ] All critical flows tested
- [ ] No blocking issues found
- [ ] Ready for production deployment

Tester: _______________
Date: _______________
