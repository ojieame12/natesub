# Test Golden Suite + Coverage Map

This is the “don’t break the app” checklist: what features exist, which backend services/pages they touch, and which tests prove they still work.

If your goal is **fast PR confidence**, run the **Golden Suite** (commands below). If your goal is **provider realism**, run the scheduled “real payments” job (Stripe/Paystack test keys).

## Golden Suite (run on every PR)

- **Backend:** `cd backend && npm test`
- **Frontend:** `npm run test:run`
- **Build:** `cd backend && npm run build` and `npm run build`
- **E2E smoke (stub payments):**
  - Start backend with `PAYMENTS_MODE=stub` (never production)
  - Start frontend (`npm run dev`)
  - Run Playwright: `npm run test:e2e` (requires `npm run test:e2e:install` once)

## System Map (services + pages)

### External integrations
- **Stripe:** Connect onboarding, Checkout Sessions, webhooks (subscriptions + payments)
- **Paystack:** bank resolution, subaccounts, transaction initialize/verify, transfer webhooks
- **Resend:** OTP email delivery
- **Cloudflare R2 (S3-compatible):** signed uploads for avatar/photo/voice
- **Redis/BullMQ:** distributed locks + background webhook processing + billing jobs (when configured)
- **AI providers:** Gemini/Perplexity/Replicate (optional) for onboarding page generation
- **Bird SMS:** optional SMS delivery

### Backend route → service map
Source of truth: `backend/src/app.ts`

- `GET/POST /auth/*` → `backend/src/services/auth.ts`, `backend/src/services/email.ts`
- `GET/PUT/PATCH /profile/*` → `backend/src/routes/profile.ts` + `backend/src/schemas/profile.ts`
- `GET /users/:username` → `backend/src/routes/users.ts`
- `POST /stripe/connect` + status/refresh → `backend/src/services/stripe.ts`
- `POST /paystack/connect` + banks/resolve/status → `backend/src/services/paystack.ts`
- `POST /checkout/session` + verify endpoints → `backend/src/routes/checkout.ts` (+ fee calc, provider routing)
- `POST /webhooks/{stripe,paystack}` → `backend/src/routes/webhooks/*` (+ async worker when Redis exists)
- `POST /analytics/view` + `PATCH /analytics/view/:id` + `GET /analytics/stats` → `backend/src/routes/analytics.ts`
- `POST /media/upload-url` → `backend/src/services/storage.ts`
- `GET/POST /subscriptions/*` + `GET /my-subscriptions/*` → subscription lifecycle + portals
- `POST /requests/*` + public accept/decline → creator “requests” + public pay links
- `POST /updates/*` → creator updates + delivery
- `GET /payroll/*` + `/verify/:code` → payroll PDF generation + public verification
- `GET/POST /billing/*` → platform subscription (service plan)
- `POST /ai/*` → AI page generation
- `POST /jobs/*` + cron callers in `api/cron/*` → scheduled jobs
- `GET /admin/*` → admin-only endpoints (low touch)

### Frontend route map (pages/views)
Source of truth: `src/App.tsx`

- `/onboarding` → Email → OTP → Identity → Username → Payments → Review/Launch
- `/onboarding/paystack` and `/onboarding/paystack/complete` → Paystack bank connect + confirmation page
- `/settings/payments/*` → Stripe connect, refresh, completion UI
- `/payment/success` → Paystack checkout return page (subscriber)
- `/:username` → public creator page + subscribe UI (templates)
- Creator app: `/dashboard`, `/activity`, `/subscribers`, `/profile`, `/edit-page`, `/templates`, `/updates/*`, `/requests/*`, `/payroll/*`, `/settings/*`
- Public request pay links: `/r/:token` and `/r/:token/success`

## Critical Flows (step-by-step) + What proves them

### 1) Auth (email OTP / magic link)
1. UI: `src/onboarding/EmailStep.tsx` calls `POST /auth/magic-link`
2. UI: `src/onboarding/OtpStep.tsx` calls `POST /auth/verify`, stores cookie/token, navigates using `redirectTo`
3. API: `GET /auth/me` drives “smart routing” (resume onboarding vs dashboard)

Tests that cover it:
- Backend: `backend/tests/integration/auth.test.ts`
- Frontend: `src/onboarding/EmailStep.test.tsx`, `src/onboarding/OtpStep.test.tsx`

### 2) Creator onboarding → profile creation
1. UI collects identity + purpose + pricing model (single vs tiers)
2. API: `PUT /profile` persists profile + pricing + template, clears onboarding state when complete
3. API: `GET /profile/onboarding-status` returns progress + next step

Tests that cover it:
- Backend: `backend/tests/integration/onboarding.test.ts`, `backend/tests/integration/e2e-flows.test.ts`
- Backend contract: `backend/tests/contract/profile.test.ts` (schema stays stable)
- Frontend: `src/onboarding/store.test.ts`, `src/onboarding/AvatarUploadStep.test.tsx`

### 3) Connect payouts (Stripe)
1. UI: `src/onboarding/PaymentMethodStep.tsx` or `src/PaymentSettings.tsx`
2. API: `POST /stripe/connect` returns Stripe onboarding link (or `alreadyOnboarded`)
3. Redirect: Stripe → return URL → `/settings/payments/complete`
4. UI: `src/StripeComplete.tsx` polls `GET /stripe/connect/status` (+ refresh flow)

Tests that cover it:
- Backend: `backend/tests/integration/onboarding.test.ts` (Stripe connect/status)
- Frontend: `src/StripeComplete.test.tsx`
- E2E (stub): `e2e/creator-journey.spec.ts`

### 4) Connect payouts (Paystack)
1. UI: `src/onboarding/PaystackConnect.tsx`
2. API: `GET /paystack/banks/:country`, `POST /paystack/resolve-account`, `POST /paystack/connect`
3. UI return page: `/onboarding/paystack/complete` shows “bank connected”

Tests that cover it:
- Backend: `backend/tests/integration/paystack-connect.test.ts`, `backend/tests/integration/onboarding.test.ts`
- Frontend: (no dedicated `PaystackOnboardingComplete` test yet)

### 5) Public creator page load (templates + owner detection)
1. UI route: `/:username` → `src/subscribe/UserPage.tsx`
2. API: `GET /users/:username` returns profile + `isOwner` + `viewerSubscription`

Tests that cover it:
- Backend: `backend/tests/integration/e2e-flows.test.ts` (public profile + viewer subscription)
- Frontend: `src/subscribe/UserPage.test.tsx`

### 6) Subscriber checkout (Stripe + Paystack) + geo-routing
1. UI: `src/subscribe/SubscribeBoundary.tsx`
2. UI determines `payerCountry`:
   - cached: `sessionStorage['natepay_payer_country']`
   - else: `fetch('https://ipapi.co/country/')` (best-effort)
3. UI calls `POST /checkout/session` with `{ creatorUsername, amount, interval, payerCountry, subscriberEmail?, viewId? }`
4. Backend `backend/src/routes/checkout.ts`:
   - validates price matches creator pricing
   - computes fee breakdown (`backend/src/services/fees.ts`)
   - selects provider:
     - creator has both providers + payerCountry in Paystack countries → Paystack
     - else → Stripe (or creator default)
5. Redirect:
   - Stripe returns to `/:username?success=true&session_id=...`
   - Paystack returns to `/payment/success?reference=...&creator=...`
6. UI verifies:
   - `GET /checkout/session/:id/verify` (Stripe anti-spoof)
   - `GET /checkout/verify/:reference` (Paystack)

Tests that cover it:
- Backend: `backend/tests/integration/checkout.test.ts` (Stripe vs Paystack routing + verify endpoints)
- Backend: `backend/tests/integration/stripe-africa.test.ts` (cross-border classification helpers)
- Frontend: `src/subscribe/SubscribeBoundary.test.tsx` (Stripe verify + Paystack verify + payerCountry wiring + IP cache behavior)
- E2E (stub Stripe path): `e2e/creator-journey.spec.ts`

### 7) Webhooks (authoritative state)
1. Providers call `/webhooks/stripe` and `/webhooks/paystack`
2. Worker processes events and updates `Payment`, `Subscription`, payouts, retries
3. Idempotency + audit stored in `WebhookEvent`

Tests that cover it:
- Backend: `backend/tests/integration/webhooks.test.ts`
- Backend: `backend/tests/integration/paystack-webhooks.test.ts`

### 8) Editing profile / page settings
1. UI: `/edit-page` + `/profile` + `/templates`
2. API: `PATCH /profile` and `PATCH /profile/settings`
3. Side effects: username uniqueness, template changes, feeMode changes, publish state

Tests that cover it:
- Backend: `backend/tests/integration/e2e-flows.test.ts` (patches username/bio/pricing/template/settings)
- Backend: `backend/tests/contract/profile.test.ts` (schema enforcement)
- Frontend: `src/subscribe/SubscribeBoundary.test.tsx` (feeMode toggle calls settings update)

### 9) Subscriptions (creator + subscriber)
1. Creator: `/subscribers` (list/cancel)
2. Subscriber: `/my-subscriptions` (manage/cancel)
3. Backend: `GET /subscriptions`, `POST /subscriptions/:id/cancel`, `/my-subscriptions/*`

Tests that cover it:
- Backend: `backend/tests/integration/subscriptions.test.ts`
- Backend: `backend/tests/integration/my-subscriptions.test.ts`

### 10) Requests (creator invoices / pay links)
1. Creator: create + send request (`/requests`)
2. Recipient: public page `/r/:token`, accept → Stripe checkout link, success return

Tests that cover it:
- Backend: `backend/tests/integration/requests.test.ts`
- Frontend: store tests only (`src/request/store.test.ts`)

### 11) Updates (creator posts to subscribers)
1. Creator: create/list/send updates (`/updates/*`)
2. Backend: persists update + delivery metrics

Tests that cover it:
- Backend: `backend/tests/integration/updates.test.ts`
- Frontend: store tests (`src/updates/store.test.ts`)

### 12) Media uploads (avatar/photo/voice)
1. UI asks for signed upload URL
2. Direct upload to R2
3. UI stores resulting `publicUrl` on profile/update/request

Tests that cover it:
- Backend: `backend/tests/integration/media.test.ts`
- Frontend: `src/onboarding/AvatarUploadStep.test.tsx` (upload UX + calling the upload-url flow)

### 13) Analytics (page views + conversion)
1. UI: public page records view (`POST /analytics/view`) with UTM + device
2. UI: checkout updates view (`PATCH /analytics/view/:id`) for funnel steps
3. Creator: `GET /analytics/stats` aggregates conversion + views

Tests that cover it:
- Backend: `backend/tests/integration/analytics.test.ts`
- Frontend: `src/subscribe/SubscribeBoundary.test.tsx` (records page view w/ UTM presence)

### 14) Payroll (creator reports + verification)
1. Creator: `/payroll` listing + detail + PDF
2. Public: `/verify/:code` verification page

Tests that cover it:
- Backend: `backend/tests/integration/payroll.test.ts`

### 15) Platform billing (service plan)
1. UI: `/settings/billing` shows plan status + starts trial checkout + opens portal
2. Backend: `/billing/*` endpoints, Stripe billing, redirect back with `?success=true`

Tests that cover it:
- Backend: `backend/tests/integration/billing.test.ts`
- Frontend: `src/Billing.test.tsx`

## Known gaps (good next “golden” additions)

- **E2E Paystack checkout path** (today’s Playwright test covers Stripe path; backend/unit tests cover Paystack, but adding an E2E Paystack smoke test would catch UI wiring regressions).
- **Paystack onboarding complete page UI test**: `src/PaystackOnboardingComplete.tsx` is untested.
- **Admin/Jobs endpoints**: minimal direct test coverage (low-risk, but worth a smoke test if you change them often).

For payment architecture risks (cross-border currency correctness, server-side geo hardening, fallback logic), see `DUAL_PAYMENTS_AUDIT.md`.

