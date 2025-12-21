# Critical Fixes Plan

## Priority Order
1. **CRITICAL**: Cross-border currency bug (users charged wrong amounts)
2. **HIGH**: Fee-floor margin recalculation
3. **HIGH**: Remove dead tiered pricing UI
4. **MEDIUM**: Legacy +30 cents fix
5. **MEDIUM**: Support rate limiting

---

## Fix 1: Cross-Border Currency Bug (CRITICAL)

### Problem
Nigerian creator sets price as 5000 NGN → stored as 500000 kobo → displayed/charged as $5000 USD.

### Root Cause
- `IdentityStep.tsx` allows NG/GH/KE/ZA creators to select local currency
- Profile stores amounts in local currency units
- `users.ts` and `checkout.ts` switch to USD for display/charge without conversion

### Solution: Force USD for Cross-Border Creators

**Files to modify:**

#### 1. `src/onboarding/IdentityStep.tsx`
```diff
- { code: 'NG', name: 'Nigeria', flag: '🇳🇬', currency: 'NGN', crossBorder: true },
- { code: 'ZA', name: 'South Africa', flag: '🇿🇦', currency: 'ZAR', crossBorder: true },
- { code: 'KE', name: 'Kenya', flag: '🇰🇪', currency: 'KES', crossBorder: true },
- { code: 'GH', name: 'Ghana', flag: '🇬🇭', currency: 'GHS', crossBorder: true },
+ // Cross-border countries: creators price in USD, payouts convert to local currency
+ { code: 'NG', name: 'Nigeria', flag: '🇳🇬', currency: 'USD', crossBorder: true, localCurrency: 'NGN' },
+ { code: 'ZA', name: 'South Africa', flag: '🇿🇦', currency: 'USD', crossBorder: true, localCurrency: 'ZAR' },
+ { code: 'KE', name: 'Kenya', flag: '🇰🇪', currency: 'USD', crossBorder: true, localCurrency: 'KES' },
+ { code: 'GH', name: 'Ghana', flag: '🇬🇭', currency: 'USD', crossBorder: true, localCurrency: 'GHS' },
```

Add helper text when cross-border country selected:
```tsx
{selectedCountry?.crossBorder && (
  <div className="cross-border-notice">
    <Info size={14} />
    <span>
      You'll set prices in USD. Payouts convert to {selectedCountry.localCurrency} automatically.
    </span>
  </div>
)}
```

#### 2. `backend/src/routes/profile.ts` (validation)
Add backend validation to enforce USD for cross-border:
```typescript
// In PUT /profile handler, after parsing
const CROSS_BORDER_COUNTRIES = ['NG', 'GH', 'KE', 'ZA']
if (CROSS_BORDER_COUNTRIES.includes(data.countryCode) && data.currency !== 'USD') {
  return c.json({
    error: 'Cross-border creators must use USD pricing. Payouts will convert to your local currency.'
  }, 400)
}
```

#### 3. `backend/src/schemas/profile.ts`
Add minimum amount validation per currency:
```typescript
// Add after tierSchema
export const MIN_AMOUNTS: Record<string, number> = {
  USD: 100,   // $1.00 minimum
  EUR: 100,   // €1.00
  GBP: 100,   // £1.00
  NGN: 50000, // ₦500 (~$0.30) - only for Paystack local
  KES: 10000, // KSh100
  ZAR: 2000,  // R20
  GHS: 1000,  // ₵10
}

// Update singleAmount validation
singleAmount: z.number().positive().max(100000).refine(
  (val) => val >= 100, // Enforce $1 minimum (will be currency-aware at route level)
  { message: 'Minimum amount is $1.00' }
).optional().nullable(),
```

#### 4. Data Migration for Existing Cross-Border Creators
```sql
-- Identify affected profiles (DO NOT RUN - for review)
SELECT id, username, currency, "countryCode", "singleAmount"
FROM "Profile"
WHERE "countryCode" IN ('NG', 'GH', 'KE', 'ZA')
  AND currency != 'USD';

-- Migration would need manual review since we can't auto-convert amounts
-- without knowing the intended USD value
```

---

## Fix 2: Fee-Floor Margin Recalculation

### Problem
Processor fee is calculated before fee adjustments, so after bumping fees to meet minimum, the actual processor fee is higher than estimated.

### Solution
Recalculate processor fee after adjustments or use iterative approach.

**File: `backend/src/services/fees.ts`**

```diff
  // Apply processor buffer: ensure platform fee covers processor + margin
  let feeWasCapped = false
+ let finalEstimatedProcessorFee = estimatedProcessorFee
+
  if (totalFeeCents < minPlatformFee) {
    feeWasCapped = true
    // Increase fees proportionally to meet minimum
    const deficit = minPlatformFee - totalFeeCents
    // Split deficit: subscriber pays 60%, creator pays 40% (subscriber already paying gross)
    const subscriberExtra = Math.ceil(deficit * 0.6)
    const creatorExtra = deficit - subscriberExtra

    subscriberFeeCents += subscriberExtra
    creatorFeeCents += creatorExtra
    totalFeeCents = subscriberFeeCents + creatorFeeCents
    grossCents = amountCents + subscriberFeeCents
+
+   // Recalculate processor fee on new gross
+   finalEstimatedProcessorFee = estimateProcessorFee(grossCents, normalizedCurrency)
+
+   // If still under minimum after recalc, iterate once more
+   const newMinPlatformFee = finalEstimatedProcessorFee + minMargin
+   if (totalFeeCents < newMinPlatformFee) {
+     const extraDeficit = newMinPlatformFee - totalFeeCents
+     subscriberFeeCents += Math.ceil(extraDeficit * 0.6)
+     creatorFeeCents += extraDeficit - Math.ceil(extraDeficit * 0.6)
+     totalFeeCents = subscriberFeeCents + creatorFeeCents
+     grossCents = amountCents + subscriberFeeCents
+     finalEstimatedProcessorFee = estimateProcessorFee(grossCents, normalizedCurrency)
+   }
  }

  // Calculate net (what creator receives)
  const netCents = amountCents - creatorFeeCents

  // Calculate actual margin
- const estimatedMargin = totalFeeCents - estimatedProcessorFee
+ const estimatedMargin = totalFeeCents - finalEstimatedProcessorFee
```

---

## Fix 3: Remove Dead Tiered Pricing UI

### Problem
Frontend shows tiered fees (5%/2%) during onboarding, but backend uses split model (4%/4% = 8%).

### Solution
Remove tiered preview functions and update UI to show split model.

**Files to modify:**

#### 1. `src/utils/currency.ts`
Remove or deprecate:
- `calculateTieredFeePreview()` (lines ~560-610)
- `calculatePlatformFee()` (lines ~534-549)
- Related constants: `TIER1_LIMIT`, `TIERED_RATES`, etc.

#### 2. `src/onboarding/PersonalPricingStep.tsx`
```diff
- import { getCurrencySymbol, getSuggestedAmounts, calculateTieredFeePreview, formatAmountWithSeparators } from '../utils/currency'
+ import { getCurrencySymbol, getSuggestedAmounts, calculateFeePreview, formatAmountWithSeparators } from '../utils/currency'

  function FeePreviewBox({ amount, currency }: { amount: number; currency: string }) {
-     const feePreview = calculateTieredFeePreview(amount, false, 'standard')
+     const preview = calculateFeePreview(amount, currency)
+     const totalFeePercent = 8 // Always 8% (4% + 4%)

      return (
          <div className="fee-preview-box">
              <div className="fee-preview-row">
                  <span>Subscriber pays</span>
-                 <span>{formatAmountWithSeparators(amount, currency)}/mo</span>
+                 <span>{formatAmountWithSeparators(preview.subscriberPays, currency)}/mo</span>
              </div>
              <div className="fee-preview-divider" />
              <div className="fee-preview-row fee-deduction">
-                 <span>Platform fee ({feePreview.platformFeePercent})</span>
-                 <span>-{formatAmountWithSeparators(feePreview.platformFee!, currency)}</span>
-             </div>
-             <div className="fee-preview-row fee-deduction">
-                 <span>Processing ({feePreview.processingFeePercent})</span>
-                 <span>-{formatAmountWithSeparators(feePreview.processingFee!, currency)}</span>
+                 <span>Platform + processing ({totalFeePercent}%)</span>
+                 <span>-{formatAmountWithSeparators(preview.totalFee, currency)}</span>
              </div>
              <div className="fee-preview-divider" />
              <div className="fee-preview-row fee-total">
                  <span>You receive</span>
-                 <span>{formatAmountWithSeparators(feePreview.creatorReceives, currency)}/mo</span>
+                 <span>{formatAmountWithSeparators(preview.creatorReceives, currency)}/mo</span>
              </div>
-             <div className="fee-preview-note">
-                 <Info size={12} />
-                 <span>Lower platform fees on earnings above $500/mo</span>
-             </div>
          </div>
      )
  }
```

#### 3. `src/utils/pricing.ts`
Remove duplicate tiered functions (lines 22-136) - keep only split model functions.

#### 4. `backend/src/services/fees.ts`
Remove unused tiered functions (lines 385-562):
- `calculateTieredPlatformFee()`
- `getProcessingRate()`
- `calculateProcessingFee()`
- `calculateTieredFees()`
- `getEffectivePlatformRate()`

---

## Fix 4: Legacy +30 Cents Currency Issue

### Problem
`calculateLegacyFee()` adds `+ 30` regardless of currency. 30 kobo ≠ 30 cents.

### Solution
Use currency-appropriate fixed fees.

**File: `backend/src/services/fees.ts`**

```diff
+ // Fixed fee amounts per currency (for legacy calculations)
+ const LEGACY_FIXED_FEE: Record<string, number> = {
+   USD: 30,    // 30 cents
+   EUR: 25,    // 25 cents
+   GBP: 20,    // 20 pence
+   NGN: 10000, // ₦100 (100 * 100 kobo)
+   KES: 5000,  // KSh50
+   ZAR: 500,   // R5
+   GHS: 200,   // ₵2
+ }
+ const DEFAULT_LEGACY_FIXED = 30

  export function calculateLegacyFee(
    amountCents: number,
-   _purpose: 'personal' | 'service' | null
+   _purpose: 'personal' | 'service' | null,
+   currency: string = 'USD'
  ): { feeCents: number; netCents: number } {
+   const fixedFee = LEGACY_FIXED_FEE[currency.toUpperCase()] || DEFAULT_LEGACY_FIXED
    // Use 8% flat rate with buffer
-   const feeCents = Math.round(amountCents * PLATFORM_FEE_RATE) + 30
+   const feeCents = Math.round(amountCents * PLATFORM_FEE_RATE) + fixedFee
    return {
      feeCents,
      netCents: amountCents - feeCents,
    }
  }
```

Update callers to pass currency:
- `backend/src/jobs/billing.ts`
- `backend/src/routes/webhooks.ts` (if used)

---

## Fix 5: Support Ticket Rate Limiting

### Problem
`POST /support/tickets` has no rate limiting - anyone can spam ticket creation.

### Solution
Add rate limiting middleware.

**File: `backend/src/routes/support.ts`**

```diff
  import { Hono } from 'hono'
  import { z } from 'zod'
  import { db } from '../db/client.js'
  import { optionalAuth, requireAuth } from '../middleware/auth.js'
+ import { publicRateLimit } from '../middleware/rateLimit.js'
  import { sendSupportTicketConfirmationEmail } from '../services/email.js'
  import type { TicketCategory, TicketPriority } from '@prisma/client'

  // ...

- support.post('/tickets', optionalAuth, async (c) => {
+ support.post('/tickets', publicRateLimit, optionalAuth, async (c) => {
```

**Optional: Add stricter per-email rate limit**

```typescript
// In middleware/rateLimit.ts, add:
export const supportTicketRateLimit = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 3, // Max 3 tickets per hour per IP
  keyGenerator: (c) => {
    const body = c.req.raw.clone()
    // Include email in key if available
    return `support:${c.req.header('x-forwarded-for') || 'unknown'}`
  },
  message: 'Too many support tickets. Please wait before submitting another.',
})
```

---

## Testing Checklist

### Fix 1: Cross-Border Currency
- [ ] New Nigerian creator sees USD as currency
- [ ] Existing NGN creator prevented from creating new subscriptions (or migrated)
- [ ] Fee preview shows correct USD amounts
- [ ] Checkout charges correct USD amount
- [ ] Payout converts to NGN correctly

### Fix 2: Fee-Floor Margin
- [ ] Small amounts ($1) have positive margin after processor fees
- [ ] `estimatedMargin` in response reflects actual margin
- [ ] No negative margins in any currency

### Fix 3: Tiered UI Removal
- [ ] Onboarding shows 8% fee, not tiered
- [ ] No "lower fees above $500" messaging
- [ ] Fee preview matches checkout breakdown

### Fix 4: Legacy +30 Fix
- [ ] NGN subscriptions use ₦100 fixed fee, not 30 kobo
- [ ] USD subscriptions still use 30 cents
- [ ] Reconciliation shows correct fees

### Fix 5: Support Rate Limit
- [ ] 4th ticket in 1 hour returns 429
- [ ] Logged-in users have same limit
- [ ] Rate limit resets after window

---

## Rollout Order

1. **Fix 5** (Support rate limit) - No risk, deploy immediately
2. **Fix 4** (Legacy +30) - Low risk, only affects new legacy charges
3. **Fix 2** (Fee-floor recalc) - Medium risk, test with small amounts
4. **Fix 3** (Remove tiered UI) - Frontend only, can A/B test
5. **Fix 1** (Cross-border currency) - HIGHEST RISK, needs data migration plan

---

## Open Decision: Existing Cross-Border Creators

For creators already onboarded with NGN/KES/ZAR/GHS:

**Option A: Grandfather existing, enforce USD for new**
- Existing creators keep local currency pricing
- New cross-border creators must use USD
- Add migration tool for voluntary switch

**Option B: Force migration with notice**
- Email affected creators with migration deadline
- Auto-migrate amounts using FX rate at cutoff
- Risk: amounts may not match creator intent

**Recommendation:** Option A - less disruptive, no wrong guesses on intended prices.
