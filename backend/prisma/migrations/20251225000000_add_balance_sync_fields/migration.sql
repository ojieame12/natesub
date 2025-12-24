-- Add cached balance fields to Profile for fast dashboard loads
-- These are synced from Stripe/Paystack via balanceSync service

-- Cached Balance fields
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "balanceAvailableCents" INTEGER;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "balancePendingCents" INTEGER;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "balanceCurrency" TEXT;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "balanceLastSyncedAt" TIMESTAMP(3);

-- Last Payout Tracking fields (for activity feed)
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "lastPayoutAmountCents" INTEGER;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "lastPayoutAt" TIMESTAMP(3);
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "lastPayoutStatus" TEXT;
