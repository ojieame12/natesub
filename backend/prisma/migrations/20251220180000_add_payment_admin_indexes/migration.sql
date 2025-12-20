-- Admin payment analytics indexes
-- These support admin revenue/overview queries that filter by occurredAt.

CREATE INDEX IF NOT EXISTS "payments_status_type_occurredAt_idx"
ON "payments"("status", "type", "occurredAt");

CREATE INDEX IF NOT EXISTS "payments_creatorId_status_occurredAt_idx"
ON "payments"("creatorId", "status", "occurredAt");

