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

## Testing
- Backend: `cd backend && npm test`
- Frontend: `npm run test:run`
