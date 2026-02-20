-- Add 'personal' to Purpose enum for V5 onboarding contract
-- Safe on repeated deploys (checks existing enum labels first)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'Purpose' AND e.enumlabel = 'personal'
  ) THEN
    ALTER TYPE "Purpose" ADD VALUE 'personal';
  END IF;
END $$;
