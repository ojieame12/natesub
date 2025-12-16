-- Add billing address fields to profiles (used for invoices/receipts)
ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "state" TEXT,
  ADD COLUMN IF NOT EXISTS "zip" TEXT;

