# Dual Payments Audit (Stripe + Paystack)

This document reviews the end‑to‑end “dual payments” implementation (Stripe for global/USD, Paystack for local) across onboarding → checkout → webhooks → payouts/recurring billing, and calls out risks, gaps, and scalability improvements.

## 1) Current Architecture (What You Have Today)

### Providers
- **Stripe**
  - Uses **Stripe Connect (Express)**.
  - One‑time payments: `application_fee_amount` + `transfer_data.destination`.
  - Subscriptions: `application_fee_percent` + `transfer_data.destination`.
  - Cross‑border mode is supported in code (collect in **USD**, payout to creator in local via Stripe account capabilities).
- **Paystack**
  - Uses Paystack **transaction initialize** for checkout.
  - Uses Paystack **authorization_code** for recurring charges (billing job).
  - Uses Paystack **Transfers** to pay creators (platform collects gross, then transfers net).

### “Dual” Behavior (Important Reality Check)
Checkout now supports **per-checkout provider routing** when a creator has both providers connected:
- If creator has **both** Stripe + Paystack:
  - Payers in `NG/KE/ZA/GH` → **Paystack**
  - All other countries → **Stripe**
  - If payer geo is missing/invalid → fallback to creator default (`profile.paymentProvider`, else Stripe).
- If creator has **only one** provider connected → always use that provider.

This enables a single creator to receive funds via both “global” (Stripe) and “local” (Paystack) without changing checkout UI.

## 2) End‑to‑End Flow

### 2.1 Creator Onboarding

**Frontend**
- Country/currency set in onboarding: `src/onboarding/IdentityStep.tsx`.
- Provider selection: `src/onboarding/PaymentMethodStep.tsx`.
- Paystack bank connect: `src/onboarding/PaystackConnect.tsx`.
- Creator can also manage connections later: `src/PaymentSettings.tsx`.

**Backend**
- Stripe connect: `backend/src/routes/stripe.ts` → `backend/src/services/stripe.ts`.
- Paystack connect: `backend/src/routes/paystack.ts` → `backend/src/services/paystack.ts`.

**State stored**
- Stripe: `profile.stripeAccountId`, `profile.payoutStatus`, `profile.paymentProvider`.
- Paystack: `profile.paystackSubaccountCode`, `profile.paystackBankCode`, `profile.paystackAccountNumber`, `profile.paymentProvider`, `profile.payoutStatus`.

### 2.2 Smart / Dynamic Checkout (Subscriber Payment Initiation)

**Frontend**
- Subscribe page calls checkout session API and redirects to returned URL:
  - `src/subscribe/SubscriptionLiquid.tsx` → `useCreateCheckout()` → `POST /checkout/session`.

**Backend**
- Provider selection + fee calc + dedupe: `backend/src/routes/checkout.ts`.
  - Determines provider from stored provider IDs + optional `payerCountry` (geo routing when both are connected).
  - Validates `amount` matches profile pricing.
  - Applies platform constraints for service providers (subscription required, debit cap).

**Paystack checkout path**
- Requires `subscriberEmail`.
- Validates Paystack currency/country match.
- Redis dedupe key prevents duplicate checkouts for same user/email/amount.
- Creates Paystack transaction (platform receives gross): `initializePaystackCheckout()` in `backend/src/services/paystack.ts`.

**Stripe checkout path**
- Verifies Connect account readiness (`chargesEnabled`/`payoutsEnabled` logic differs for cross‑border).
- Uses USD currency for cross‑border accounts, otherwise creator currency.
- Creates Checkout Session: `createCheckoutSession()` in `backend/src/services/stripe.ts`.
- Has session verification endpoint: `GET /checkout/session/:sessionId/verify`.

### 2.3 Webhooks (Authoritative Source of Truth)

**Stripe**
- Entry: `backend/src/routes/webhooks/stripe/index.ts`
- Processing: `backend/src/workers/webhookProcessor.ts` (async in prod with Redis)
- Handlers: `backend/src/routes/webhooks/stripe/*`

**Paystack**
- Entry: `backend/src/routes/webhooks/paystack/index.ts`
- Processing: `backend/src/workers/webhookProcessor.ts`
- Handlers:
  - Charges: `backend/src/routes/webhooks/paystack/charge.ts`
  - Transfers: `backend/src/routes/webhooks/paystack/transfer.ts`
  - Refunds: `backend/src/routes/webhooks/paystack/refund.ts`

**Audit/idempotency**
- All webhook receptions are recorded in `WebhookEvent` (`backend/prisma/schema.prisma`).

### 2.4 Recurring Billing

- **Stripe**: Stripe manages recurring charges; `invoice.paid` updates `Payment` + `Subscription`.
- **Paystack**: `backend/src/jobs/billing.ts` charges stored `authorization_code` on schedule and (new model) triggers a transfer payout.

### 2.5 Payouts

- **Stripe**: payouts are handled by Stripe Connect once the transfer is made; payout status tracked via account status checks/webhooks.
- **Paystack**: payout is a separate “transfer” lifecycle:
  - Payout `Payment` record is created **before** initiating transfer.
  - Transfer webhooks update payout status.
  - OTP flow is supported (`transfer.requires_otp` + finalize endpoint).

## 3) Fixes Applied During This Audit (Bugs Found)

### 3.1 Paystack transfer webhooks were being skipped incorrectly (fixed)
Problem: transfer events were being skipped when a payout `Payment` existed with the same reference. That’s expected (payout record is created before transfer) and prevented payout status updates.

Fix: only skip “already recorded” logic for `charge.success`, not for transfer/refund events.

File: `backend/src/routes/webhooks/paystack/index.ts`

### 3.2 Paystack webhook idempotency key was too coarse (fixed)
Problem: webhook events were keyed only by reference/id (`paystack_${reference}`), which can cause later lifecycle events (e.g. `transfer.requires_otp` → `transfer.success`) to be skipped.

Fix: key Paystack webhook events by **event type + reference/id**: `paystack_${event}_${referenceOrId}`.

File: `backend/src/routes/webhooks/paystack/index.ts`

### 3.3 Webhook processing required Redis in tests (fixed)
Problem: BullMQ queues attempted to connect to Redis during tests/CI, hanging locally.

Fix:
- `backend/src/lib/queue.ts` now uses a no-op in-memory queue when `NODE_ENV=test` or `REDIS_URL` is missing.
- Stripe/Paystack webhook routes process inline in tests/no-Redis and only enqueue when Redis is configured.
- Fixed Paystack eventId derivation inside the worker for correct idempotency.

Files:
- `backend/src/lib/queue.ts`
- `backend/src/routes/webhooks/stripe/index.ts`
- `backend/src/routes/webhooks/paystack/index.ts`
- `backend/src/workers/webhookProcessor.ts`

## 4) Biggest Gaps / Risks (Priority Ordered)

### P0 — Cross‑border currency + pricing consistency is currently unsafe
Symptoms:
- UI hints “collected in USD”, but onboarding defaults to local currency for cross‑border countries.
- Backend cross‑border Stripe checkout charges **USD** while fee calc + price validation still use `profile.currency`.

Risk:
- Amounts can be interpreted in the wrong currency (catastrophic over/under charging).

Recommendation:
Pick one:
1) **Force USD pricing** for cross‑border Stripe creators (store all creator prices in USD cents; show USD everywhere).
2) **Support local pricing but convert at checkout** (FX conversion service + store FX rate on payment/subscription for audit; adjust amount validation and UI display).

This requires a product decision before coding a “correct” solution.

### P0 — Smart provider detection has trust + availability weaknesses
Current implementation relies on a client-provided `payerCountry` (frontend uses `ipapi.co` and sends it to `POST /checkout/session`).

Risks:
- **Spoofable input**: clients can send any `payerCountry`; it’s not a security issue, but it can route users into the “wrong” checkout and increase failures.
- **Third‑party dependency**: `ipapi.co` introduces rate limits, latency, and an external outage surface area at the top of the funnel.
- **First‑click race**: if the geo lookup hasn’t completed when the user starts checkout, `payerCountry` is missing and routing falls back to creator default.
- **UI mismatch risk**: public profile returns a single `paymentProvider`, but backend may route to the other provider for some payers, so any “processed by Stripe/Paystack” copy can become inaccurate.

Recommended hardening:
- Prefer server-side geo headers when available (`cf-ipcountry`, `x-vercel-ip-country`) and treat client `payerCountry` as best-effort.
- Add a Paystack→Stripe fallback (only when Stripe is connected) if Paystack init fails with a provider/config/currency error.
- Unify the “Paystack-eligible countries” list across backend + frontend and align it with actual Paystack support.

### P1 — Paystack payout efficiency (recipient caching)
Each payout creates a fresh transfer recipient:
- Adds latency and increases Paystack API volume.
- Risks rate limiting at scale.

Recommendation:
- Store a `paystackRecipientCode` per creator (or per bank account fingerprint).
- Reuse it for transfers unless bank details change.

### P1 — Webhook rate limits are too low for growth
`webhookRateLimit` is `100/hour/IP` (`backend/src/middleware/rateLimit.ts`).
- At real volume, providers can exceed this (burst retries, multiple event types).
- Can result in missed state transitions if throttled.

Recommendation:
- Raise limits substantially and/or isolate webhook endpoints from general rate limiting.
- Keep signature verification as the primary defense.

### P2 — Stripe subscription fee rounding drift
Subscriptions use `application_fee_percent` (rounded) derived from a target fee amount.
- Creates mismatch between expected fee and Stripe’s computed fee.
- You already log mismatches in `invoice.paid`, which is good.

Recommendation:
- Decide acceptable tolerance, monitor, and (optionally) tune percent precision/rounding approach.

### P2 — Requests flow is Stripe‑only
`backend/src/routes/requests.ts` currently requires `stripeAccountId` and creates Stripe checkout sessions.
- There is no Paystack request acceptance flow.

Recommendation:
- Either explicitly scope “Requests are Stripe only”, or implement Paystack parity.

## 5) Scalability / Volume Readiness Notes

What’s strong already:
- `WebhookEvent` audit trail + retry metadata.
- Async processing via BullMQ (when Redis is configured).
- Idempotency keys for Stripe API calls.
- Distributed locks around subscription/payment creation and Paystack billing job.

What to add next for scale:
- Provider‑specific alerting dashboards (failed webhooks, payout mismatch, high retry counts).
- Backfill/reconciliation jobs that compare DB vs provider (Paystack `listTransactions()` exists; Stripe API can be queried similarly).
- Careful indexing/partitioning strategy for `payments` and `webhook_events` as they grow (time-based queries are common).

## 6) Open Questions (Need Product Decisions)

1) For creators in NG/KE/ZA/GH: do they set prices in **USD** or **local currency**?
2) Is “dual” intended as:
   - A creator can accept both providers concurrently, or
   - The platform supports both, but each creator chooses one?
3) For dual acceptance: should payer pick provider explicitly, or should the system auto-select (geo/currency)?
