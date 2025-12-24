-- Add FraudWarning table for TC40/SAFE fraud report tracking (Visa VAMP compliance)
CREATE TABLE IF NOT EXISTS "fraud_warnings" (
    "id" TEXT NOT NULL,
    "stripeWarningId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "fraudType" TEXT NOT NULL,
    "actionable" BOOLEAN NOT NULL,
    "paymentId" TEXT,
    "creatorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_warnings_pkey" PRIMARY KEY ("id")
);

-- Add DisputeEvidence table for chargeback defense evidence collection
CREATE TABLE IF NOT EXISTS "dispute_evidence" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "checkoutIp" TEXT,
    "checkoutUserAgent" TEXT,
    "checkoutAcceptLanguage" TEXT,
    "checkoutTimestamp" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "loginCount" INTEGER NOT NULL DEFAULT 0,
    "contentAccessCount" INTEGER NOT NULL DEFAULT 0,
    "confirmationEmailSent" BOOLEAN NOT NULL DEFAULT false,
    "confirmationEmailId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- Add new ReminderType values for subscription renewal reminders
-- Note: Prisma enums in PostgreSQL are handled differently, these values
-- are already added via the enum definition in schema.prisma

-- Create indexes for FraudWarning
CREATE UNIQUE INDEX IF NOT EXISTS "fraud_warnings_stripeWarningId_key" ON "fraud_warnings"("stripeWarningId");
CREATE INDEX IF NOT EXISTS "fraud_warnings_createdAt_idx" ON "fraud_warnings"("createdAt");
CREATE INDEX IF NOT EXISTS "fraud_warnings_creatorId_createdAt_idx" ON "fraud_warnings"("creatorId", "createdAt");

-- Create unique index for DisputeEvidence
CREATE UNIQUE INDEX IF NOT EXISTS "dispute_evidence_paymentId_key" ON "dispute_evidence"("paymentId");

-- Add foreign key for DisputeEvidence -> Payment
ALTER TABLE "dispute_evidence"
ADD CONSTRAINT "dispute_evidence_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "payments"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
