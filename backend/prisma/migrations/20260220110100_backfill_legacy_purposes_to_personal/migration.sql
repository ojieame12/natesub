-- Backfill legacy purpose values to the new V5 personal/service model.
-- Run AFTER adding enum value 'personal' in Purpose.
UPDATE "profiles"
SET "purpose" = 'personal'
WHERE "purpose"::text NOT IN ('personal', 'service');
