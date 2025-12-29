-- Add global banner generation count to Profile
-- This tracks AI banner generations per user (max 5) and survives onboarding completion

ALTER TABLE "profiles" ADD COLUMN "bannerGenerationCount" INTEGER NOT NULL DEFAULT 0;
