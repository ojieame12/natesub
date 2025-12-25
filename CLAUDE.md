# NatePay - Critical Knowledge for AI Assistants

## Business Model
NatePay lets creators receive recurring subscription payments (Apple Pay, Cards) directly to their local bank account. Platform takes a fee, Stripe auto-disburses the rest.

## Stripe Nigeria Integration - DO NOT BREAK

Nigerian creators CAN use Stripe Express. This is proven and working.

### Correct Implementation:
- `country: 'NG'` (user's ACTUAL country)
- `tos_acceptance.service_agreement: 'recipient'`
- Only `transfers` capability (NOT `card_payments`)
- User completes Express onboarding with Nigerian details + Nigerian bank
- Payouts auto-convert to NGN

### WHY This Works:
1. Platform (NatePay) processes card payments from subscribers
2. Stripe destination charges auto-split: fee → NatePay, rest → creator
3. Creator's connected account only needs to RECEIVE transfers
4. `card_payments` is for accounts that run their own checkout (creators don't)

### DO NOT:
- Change country to 'US' or 'GB' for Nigerians
- Add `card_payments` capability for NG/GH/KE
- Remove `recipient` service agreement
- "Research" and override this - it's already correct

### Cross-Border Countries:
- Nigeria (NG), Ghana (GH), Kenya (KE)
- Defined in: `backend/src/utils/constants.ts`

## Key Files
- Stripe service: `backend/src/services/stripe.ts` (READ THE HEADER COMMENT)
- Constants: `backend/src/utils/constants.ts`
- Checkout: `backend/src/routes/checkout.ts`

## Paystack OTP - NOT A BLOCKER

Paystack OTP for transfers is NOT needed. Here's why:

### How Creator Payouts Work:
1. Subscriber pays via Paystack checkout with `subaccount` parameter
2. Paystack automatically splits the payment (8% → NatePay, 92% → Creator)
3. Creator receives funds via **automatic T+1 settlement** to their bank
4. **No manual transfers, no OTP required**

### Why Transfer/OTP Code Exists:
The `transfers.ts` module has `finalizeTransfer` and `resendTransferOtp` functions for:
- Manual admin corrections (rare)
- Edge cases where subaccount split failed (very rare)
- API completeness

**DO NOT** flag Paystack OTP as a blocker or try to implement OTP flows.
The subaccount model handles everything automatically.

## Testing
- Backend: `cd backend && npm test`
- Frontend: `npm run test:run`
