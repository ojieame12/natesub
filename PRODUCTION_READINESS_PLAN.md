# Production Readiness Plan

## Overview
This plan addresses all critical, high, and medium priority issues identified in the production readiness audit. Estimated total time: 6-8 hours of focused work.

---

## Phase 1: Critical Blockers (Must Fix Before Live Keys)
**Estimated Time: 2-3 hours**

### 1.1 Fix Paystack Webhook Idempotency Bug
**File:** `backend/src/routes/webhooks.ts` (line ~701)
**Issue:** If `eventId` is missing, idempotency check is skipped, allowing duplicate payments.
**Fix:**
```typescript
const eventId = data.id?.toString() || data.reference
if (!eventId) {
  console.error('[paystack] Webhook missing ID/reference:', event)
  return c.json({ error: 'Invalid webhook - missing ID' }, 400)
}
```

### 1.2 Verify Creator Account Before Checkout
**File:** `backend/src/routes/checkout.ts`
**Issue:** Checkout allowed even if creator's Stripe account isn't fully active.
**Fix:** Call `getAccountStatus()` and verify `chargesEnabled` before creating checkout.

### 1.3 Add Transaction Safety
**Files:** `backend/src/routes/webhooks.ts` (multiple handlers)
**Issue:** Subscription and payment created separately - inconsistent if one fails.
**Fix:** Wrap in `db.$transaction()`:
```typescript
await db.$transaction(async (tx) => {
  const subscription = await tx.subscription.upsert({ ... })
  await tx.payment.create({ ... })
})
```

### 1.4 Fix Refund Fee Calculation
**File:** `backend/src/routes/webhooks.ts` (line ~494)
**Issue:** Hardcoded 10% fee, should use creator's actual purpose.
**Fix:** Look up creator's purpose and use `getPlatformFeePercent()`.

---

## Phase 2: High Priority (Before Real Payments)
**Estimated Time: 2-3 hours**

### 2.1 Encrypt Stored Account Numbers
**Files:** `backend/src/services/paystack.ts`, `backend/src/utils/encryption.ts` (new)
**Issue:** `paystackAccountNumber` stored as plaintext PII.
**Fix:**
- Create encryption utility using Node.js crypto
- Encrypt before save, decrypt when needed
- Use env var `ENCRYPTION_KEY` for the key

### 2.2 Prevent Duplicate Paystack Checkouts
**File:** `backend/src/routes/checkout.ts`
**Issue:** Same user can get multiple checkout URLs for same subscription.
**Fix:**
- Generate deterministic reference from `creatorId + subscriberEmail + tierId`
- Check if pending payment with same reference exists
- Return existing URL or error if duplicate

### 2.3 Store Stripe Charge ID on Payments
**Files:** `backend/prisma/schema.prisma`, `backend/src/routes/webhooks.ts`
**Issue:** Refund matching by amount is unreliable.
**Fix:**
- Add `stripeChargeId` field to Payment model
- Store charge ID from `invoice.payment_succeeded` webhook
- Match refunds by charge ID instead of amount

### 2.4 Enable Dunning Emails
**File:** `backend/src/routes/webhooks.ts`
**Issue:** `sendPaymentFailedEmail()` exists but never called.
**Fix:** Call email function in `invoice.payment_failed` handler.

### 2.5 Enforce Platform Subscription for Service Users
**File:** `backend/src/middleware/auth.ts` or new middleware
**Issue:** Service users can use features without active subscription after trial.
**Fix:** Add middleware that checks `platformSubscriptionStatus` for service branch users.

---

## Phase 3: Medium Priority (First Week of Production)
**Estimated Time: 2-3 hours**

### 3.1 Add Paystack Webhook Tests
**File:** `backend/tests/integration/paystack-webhooks.test.ts` (new)
**Coverage:**
- `charge.success` - new subscription
- `charge.success` - recurring payment
- `charge.failed` - mark past_due
- Signature verification rejection
- Idempotency (duplicate webhook)

### 3.2 Improve Webhook Error Handling
**File:** `backend/src/routes/webhooks.ts`
**Issue:** All errors return 500, causing unnecessary retries.
**Fix:** Return 200 for successfully parsed events (even if processing fails), only 500 for infrastructure errors.

### 3.3 Add Stripe Idempotency Keys
**File:** `backend/src/services/stripe.ts`
**Issue:** No idempotency keys on Stripe API calls.
**Fix:** Add `idempotencyKey` to checkout session creation and other mutating calls.

### 3.4 Store Dispute ID on Payments
**Files:** `backend/prisma/schema.prisma`, `backend/src/routes/webhooks.ts`
**Issue:** Dispute matching by amount is unreliable.
**Fix:** Add `stripeDisputeId` field and store it.

### 3.5 Add Rate Limiting to Webhooks
**File:** `backend/src/routes/webhooks.ts`
**Issue:** No rate limiting on webhook endpoints.
**Fix:** Add IP-based rate limiting (100 requests/hour per IP).

---

## Phase 4: Environment & Deployment
**Estimated Time: 30 mins**

### 4.1 Generate Production Keys
- [ ] Stripe: Switch to live mode, get `sk_live_` keys
- [ ] Stripe: Create live webhook endpoint, get `whsec_` secret
- [ ] Paystack: Switch to live mode, get `sk_live_` keys
- [ ] Generate secure `ENCRYPTION_KEY` for account number encryption

### 4.2 Update Railway Environment
```bash
railway variables --set \
  STRIPE_SECRET_KEY="sk_live_xxx" \
  STRIPE_WEBHOOK_SECRET="whsec_xxx" \
  PAYSTACK_SECRET_KEY="sk_live_xxx" \
  PAYSTACK_WEBHOOK_SECRET="sk_live_xxx" \
  ENCRYPTION_KEY="$(openssl rand -hex 32)"
```

### 4.3 Configure Live Webhooks
- [ ] Stripe Dashboard: Add production webhook URL
- [ ] Paystack Dashboard: Add production webhook URL
- [ ] Verify both receive test events

---

## Execution Checklist

### Phase 1 (Critical)
- [ ] 1.1 Fix Paystack webhook idempotency
- [ ] 1.2 Verify creator account before checkout
- [ ] 1.3 Add transaction safety to webhooks
- [ ] 1.4 Fix refund fee calculation
- [ ] Run tests
- [ ] Deploy to Railway

### Phase 2 (High)
- [ ] 2.1 Encrypt account numbers
- [ ] 2.2 Prevent duplicate Paystack checkouts
- [ ] 2.3 Store Stripe charge ID
- [ ] 2.4 Enable dunning emails
- [ ] 2.5 Enforce platform subscription
- [ ] Run tests
- [ ] Deploy to Railway

### Phase 3 (Medium)
- [ ] 3.1 Add Paystack webhook tests
- [ ] 3.2 Improve webhook error handling
- [ ] 3.3 Add Stripe idempotency keys
- [ ] 3.4 Store dispute ID
- [ ] 3.5 Add webhook rate limiting
- [ ] Run tests
- [ ] Deploy to Railway

### Phase 4 (Go Live)
- [ ] 4.1 Generate all production keys
- [ ] 4.2 Update Railway environment
- [ ] 4.3 Configure live webhooks
- [ ] Test with small real payment ($1)
- [ ] Monitor for 24 hours
- [ ] Go live!

---

## Post-Launch Monitoring

### First 24 Hours
- Monitor Railway logs for webhook errors
- Check Stripe Dashboard for failed webhooks
- Check Paystack Dashboard for failed webhooks
- Verify first real payment flows correctly

### First Week
- Reconcile payments daily (Stripe/Paystack dashboards vs database)
- Monitor for duplicate payments
- Check dunning emails are sending
- Verify recurring billing job runs successfully

### Ongoing
- Weekly payment reconciliation
- Monitor dispute rate
- Track refund rate
- Review failed payment reasons
