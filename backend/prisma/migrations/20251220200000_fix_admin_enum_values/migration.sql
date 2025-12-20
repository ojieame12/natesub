-- Add missing admin enum values to SystemLogType
-- These are required for admin auth logging to work

DO $$
BEGIN
  -- Add admin_access if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'admin_access' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'SystemLogType')) THEN
    ALTER TYPE "SystemLogType" ADD VALUE 'admin_access';
  END IF;
END $$;

DO $$
BEGIN
  -- Add admin_access_denied if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'admin_access_denied' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'SystemLogType')) THEN
    ALTER TYPE "SystemLogType" ADD VALUE 'admin_access_denied';
  END IF;
END $$;

DO $$
BEGIN
  -- Add admin_action if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'admin_action' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'SystemLogType')) THEN
    ALTER TYPE "SystemLogType" ADD VALUE 'admin_action';
  END IF;
END $$;
