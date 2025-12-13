#!/bin/bash
# Fee Model v2 Integration Test Script
# Run with test keys only - never use production keys!

# ============================================
# CONFIGURATION - Replace with your test values
# ============================================
API_BASE="http://localhost:3001"  # Your local backend
STRIPE_TEST_KEY="sk_test_..."     # Stripe test secret key
PAYSTACK_TEST_KEY="sk_test_..."   # Paystack test secret key

# Test creator (must exist in DB with profile)
CREATOR_ID="your-test-creator-uuid"
CREATOR_EMAIL="creator@test.com"

# ============================================
# STRIPE TESTS
# ============================================

echo "=== STRIPE FEE V2 TESTS ==="

# 1. Create a test checkout session ($100/month subscription)
echo -e "\n1. Creating Stripe checkout session..."
curl -s -X POST "$API_BASE/api/checkout/create" \
  -H "Content-Type: application/json" \
  -d '{
    "creatorId": "'$CREATOR_ID'",
    "amount": 10000,
    "currency": "USD",
    "interval": "month"
  }' | jq .

# After running, check Stripe Dashboard for:
# - Line item unit_amount should be > 10000 (includes fee)
# - Metadata should show: creatorAmount=10000, feeModel=progressive_v2

# 2. Verify invoice.created applied fee (check logs)
echo -e "\n2. Check server logs for:"
echo "   [invoice.created] Applied fee XXX on creator amount 10000 to invoice inv_..."

# 3. After payment, check DB
echo -e "\n3. DB verification queries (run in Railway):"
cat << 'SQL'

-- Check subscription stores creator price (not gross)
SELECT id, amount, "feeModel", currency
FROM subscriptions
WHERE "creatorId" = 'CREATOR_ID'
ORDER BY "createdAt" DESC LIMIT 1;
-- Expected: amount = 10000 (creator price), feeModel = 'progressive_v2'

-- Check payment record has correct breakdown
SELECT id, "grossCents", "amountCents", "feeCents", "netCents",
       "feeModel", "feeEffectiveRate", "feeWasCapped"
FROM payments
WHERE "creatorId" = 'CREATOR_ID'
ORDER BY "createdAt" DESC LIMIT 1;
-- Expected: grossCents > netCents, netCents = 10000, feeCents = difference

-- Check LTV is based on net (creator earnings)
SELECT id, "ltvCents" FROM subscriptions
WHERE "creatorId" = 'CREATOR_ID'
ORDER BY "createdAt" DESC LIMIT 1;
-- Expected: ltvCents = 10000 (not gross amount)

-- Check NO alert activities
SELECT * FROM activities
WHERE type IN ('fee_mismatch_alert', 'fee_missing_alert')
ORDER BY "createdAt" DESC LIMIT 5;
-- Expected: Empty or no recent entries

SQL

# ============================================
# STRIPE RENEWAL TEST (via Test Clock)
# ============================================

echo -e "\n=== STRIPE RENEWAL TEST ==="
echo "To test renewals, use Stripe Test Clocks:"
echo "1. Create test clock: stripe test_clocks create --frozen_time=$(date +%s)"
echo "2. Create customer attached to test clock"
echo "3. Create subscription"
echo "4. Advance time: stripe test_clocks advance --frozen_time=<+1 month>"
echo "5. Check invoice.created and invoice.paid webhooks fire correctly"

# ============================================
# PAYSTACK TESTS
# ============================================

echo -e "\n=== PAYSTACK FEE V2 TESTS ==="

# 1. Initialize Paystack transaction (NGN 10,000 creator price)
echo -e "\n1. Initialize Paystack transaction..."
# Note: This would typically go through your checkout endpoint
curl -s -X POST "$API_BASE/api/checkout/paystack/initialize" \
  -H "Content-Type: application/json" \
  -d '{
    "creatorId": "'$CREATOR_ID'",
    "amount": 1000000,
    "currency": "NGN",
    "interval": "month",
    "email": "subscriber@test.com"
  }' | jq .

# 2. Simulate webhook (for local testing only)
echo -e "\n2. To simulate Paystack webhook locally:"
cat << 'WEBHOOK'
curl -X POST "http://localhost:3001/webhooks/paystack" \
  -H "Content-Type: application/json" \
  -H "x-paystack-signature: <generate-hmac-sha512>" \
  -d '{
    "event": "charge.success",
    "data": {
      "id": 123456789,
      "reference": "TEST_REF_001",
      "amount": 1080000,
      "currency": "NGN",
      "customer": {
        "email": "subscriber@test.com",
        "customer_code": "CUS_test123"
      },
      "authorization": {
        "authorization_code": "AUTH_test123"
      },
      "metadata": {
        "creatorId": "CREATOR_ID",
        "tierId": null,
        "interval": "month",
        "feeModel": "progressive_v2",
        "creatorAmount": 1000000,
        "serviceFee": 80000,
        "feeEffectiveRate": 0.08,
        "feeWasCapped": false
      }
    }
  }'
WEBHOOK

# 3. DB verification for Paystack
echo -e "\n3. Paystack DB verification queries:"
cat << 'SQL'

-- Check subscription stores creator price
SELECT id, amount, "feeModel", currency, "paystackAuthorizationCode"
FROM subscriptions
WHERE "creatorId" = 'CREATOR_ID' AND currency = 'NGN'
ORDER BY "createdAt" DESC LIMIT 1;
-- Expected: amount = 1000000 (creator price in kobo)

-- Check payment record
SELECT id, "grossCents", "feeCents", "netCents", "feeModel",
       "feeEffectiveRate", "feeWasCapped", "paystackTransactionRef"
FROM payments
WHERE "creatorId" = 'CREATOR_ID' AND currency = 'NGN'
ORDER BY "createdAt" DESC LIMIT 1;
-- Expected: grossCents = 1080000, netCents = 1000000, feeCents = 80000

-- Check payout record exists with metadata
SELECT id, type, "amountCents", "feeModel", "feeEffectiveRate", "feeWasCapped"
FROM payments
WHERE "creatorId" = 'CREATOR_ID' AND type = 'payout'
ORDER BY "createdAt" DESC LIMIT 1;
-- Expected: type = 'payout', feeModel/effectiveRate populated

SQL

# ============================================
# BILLING JOB TEST (Paystack renewals)
# ============================================

echo -e "\n=== BILLING JOB TEST ==="
echo "To test Paystack renewals:"
echo "1. Set subscription currentPeriodEnd to past date"
echo "2. Run: npx ts-node -e \"import { processRecurringBilling } from './src/jobs/billing.js'; processRecurringBilling().then(console.log)\""
echo "3. Verify:"
echo "   - Charge amount = creator price + fee (NOT fee-on-fee)"
echo "   - Payout record created once (check idempotency)"
echo "   - Transfer initiated once"

cat << 'SQL'

-- Set subscription to due for renewal (run in Railway DB)
UPDATE subscriptions
SET "currentPeriodEnd" = NOW() - INTERVAL '1 day'
WHERE id = 'SUBSCRIPTION_ID';

-- After billing job runs, check:
-- 1. New payment with grossCents = creatorAmount + newFee
-- 2. Payout record with feeModel metadata
-- 3. No duplicate payouts (idempotency)

SELECT type, COUNT(*), MAX("createdAt")
FROM payments
WHERE "subscriptionId" = 'SUBSCRIPTION_ID'
GROUP BY type;

SQL

# ============================================
# FEE CALCULATION VERIFICATION
# ============================================

echo -e "\n=== FEE CALCULATION EXAMPLES ==="
echo "Expected fees (service user, 8% base, capped at \$75 USD / NGN 120,000):"
echo ""
echo "USD Examples:"
echo "  \$100 creator price -> \$8 fee (8%) -> \$108 total"
echo "  \$500 creator price -> \$40 fee (8%) -> \$540 total"
echo "  \$1000 creator price -> \$75 fee (CAPPED) -> \$1075 total"
echo "  \$5000 creator price -> \$100 fee (2% FLOOR) -> \$5100 total"
echo ""
echo "NGN Examples (in kobo, /100 for naira):"
echo "  NGN 10,000 creator -> NGN 800 fee (8%) -> NGN 10,800 total"
echo "  NGN 100,000 creator -> NGN 8,000 fee (8%) -> NGN 108,000 total"
echo "  NGN 2,000,000 creator -> NGN 120,000 fee (CAPPED) -> NGN 2,120,000 total"
echo "  NGN 10,000,000 creator -> NGN 200,000 fee (2% FLOOR) -> NGN 10,200,000 total"

echo -e "\n=== TEST COMPLETE ==="
echo "Review the queries above and run them against your test database."
echo "All alerts (fee_mismatch_alert, fee_missing_alert) should be absent for successful runs."
