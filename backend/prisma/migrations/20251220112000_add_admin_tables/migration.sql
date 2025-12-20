-- Admin monitoring tables and enums
-- Safe to run on existing databases (uses IF NOT EXISTS where possible)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReminderType') THEN
    CREATE TYPE "ReminderType" AS ENUM (
      'request_unopened_24h',
      'request_unopened_72h',
      'request_unpaid_3d',
      'request_expiring',
      'invoice_due_7d',
      'invoice_due_3d',
      'invoice_due_1d',
      'invoice_overdue_1d',
      'invoice_overdue_7d',
      'payout_completed',
      'payout_failed',
      'payroll_ready',
      'onboarding_incomplete_24h',
      'onboarding_incomplete_72h',
      'bank_setup_incomplete',
      'no_subscribers_7d'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReminderChannel') THEN
    CREATE TYPE "ReminderChannel" AS ENUM ('email', 'sms', 'push');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReminderStatus') THEN
    CREATE TYPE "ReminderStatus" AS ENUM ('scheduled', 'sent', 'failed', 'canceled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SystemLogType') THEN
    CREATE TYPE "SystemLogType" AS ENUM (
      'email_sent',
      'email_failed',
      'reminder_sent',
      'reminder_failed',
      'update_sent',
      'invoice_created',
      'invoice_sent',
      'user_error',
      'payment_error',
      'webhook_error',
      'payout_initiated',
      'payout_completed',
      'payout_failed'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SystemLogLevel') THEN
    CREATE TYPE "SystemLogLevel" AS ENUM ('info', 'warning', 'error');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TicketStatus') THEN
    CREATE TYPE "TicketStatus" AS ENUM ('open', 'in_progress', 'resolved', 'closed');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TicketPriority') THEN
    CREATE TYPE "TicketPriority" AS ENUM ('low', 'normal', 'high', 'urgent');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TicketCategory') THEN
    CREATE TYPE "TicketCategory" AS ENUM ('general', 'billing', 'technical', 'account', 'payout', 'dispute');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'received',
  "error" TEXT,
  "payload" JSONB,
  "subscriptionId" TEXT,
  "paymentId" TEXT,
  "userId" TEXT,
  "processingTimeMs" INTEGER,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_eventId_key" ON "webhook_events"("eventId");
CREATE INDEX IF NOT EXISTS "webhook_events_provider_eventType_idx" ON "webhook_events"("provider", "eventType");
CREATE INDEX IF NOT EXISTS "webhook_events_status_idx" ON "webhook_events"("status");
CREATE INDEX IF NOT EXISTS "webhook_events_receivedAt_idx" ON "webhook_events"("receivedAt");
CREATE INDEX IF NOT EXISTS "webhook_events_userId_idx" ON "webhook_events"("userId");

CREATE TABLE IF NOT EXISTS "reminders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "type" "ReminderType" NOT NULL,
  "channel" "ReminderChannel" NOT NULL DEFAULT 'email',
  "status" "ReminderStatus" NOT NULL DEFAULT 'scheduled',
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "reminders_entityType_entityId_type_key" ON "reminders"("entityType", "entityId", "type");
CREATE INDEX IF NOT EXISTS "reminders_status_scheduledFor_idx" ON "reminders"("status", "scheduledFor");
CREATE INDEX IF NOT EXISTS "reminders_userId_idx" ON "reminders"("userId");

CREATE TABLE IF NOT EXISTS "system_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "type" "SystemLogType" NOT NULL,
  "level" "SystemLogLevel" NOT NULL DEFAULT 'info',
  "userId" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "stackTrace" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "system_logs_type_createdAt_idx" ON "system_logs"("type", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "system_logs_level_createdAt_idx" ON "system_logs"("level", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "system_logs_userId_createdAt_idx" ON "system_logs"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "system_logs_createdAt_idx" ON "system_logs"("createdAt");

CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" TEXT,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "category" "TicketCategory" NOT NULL,
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" "TicketStatus" NOT NULL DEFAULT 'open',
  "priority" "TicketPriority" NOT NULL DEFAULT 'normal',
  "assignedTo" TEXT,
  "adminNotes" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolution" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "support_tickets_status_createdAt_idx" ON "support_tickets"("status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "support_tickets_userId_idx" ON "support_tickets"("userId");
CREATE INDEX IF NOT EXISTS "support_tickets_email_idx" ON "support_tickets"("email");
CREATE INDEX IF NOT EXISTS "support_tickets_priority_status_idx" ON "support_tickets"("priority", "status");

CREATE TABLE IF NOT EXISTS "support_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ticketId" UUID NOT NULL,
  "isAdmin" BOOLEAN NOT NULL,
  "senderName" TEXT,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "support_messages_ticketId_createdAt_idx" ON "support_messages"("ticketId", "createdAt");

CREATE TABLE IF NOT EXISTS "daily_stats" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "date" DATE NOT NULL,
  "totalUsers" INTEGER NOT NULL DEFAULT 0,
  "newUsers" INTEGER NOT NULL DEFAULT 0,
  "activeCreators" INTEGER NOT NULL DEFAULT 0,
  "activeSubscriptions" INTEGER NOT NULL DEFAULT 0,
  "newSubscriptions" INTEGER NOT NULL DEFAULT 0,
  "canceledSubscriptions" INTEGER NOT NULL DEFAULT 0,
  "totalVolumeCents" BIGINT NOT NULL DEFAULT 0,
  "platformFeeCents" BIGINT NOT NULL DEFAULT 0,
  "creatorPayoutsCents" BIGINT NOT NULL DEFAULT 0,
  "paymentCount" INTEGER NOT NULL DEFAULT 0,
  "failedPayments" INTEGER NOT NULL DEFAULT 0,
  "refundCount" INTEGER NOT NULL DEFAULT 0,
  "refundAmountCents" BIGINT NOT NULL DEFAULT 0,
  "disputeCount" INTEGER NOT NULL DEFAULT 0,
  "stripeVolumeCents" BIGINT NOT NULL DEFAULT 0,
  "paystackVolumeCents" BIGINT NOT NULL DEFAULT 0,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "daily_stats_date_key" ON "daily_stats"("date");
CREATE INDEX IF NOT EXISTS "daily_stats_date_idx" ON "daily_stats"("date" DESC);
