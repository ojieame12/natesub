-- Add TTL cleanup indexes
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");
CREATE INDEX "magic_link_tokens_expiresAt_idx" ON "magic_link_tokens"("expiresAt");
CREATE INDEX "page_views_createdAt_idx" ON "page_views"("createdAt");

-- Add Payment job query optimization indexes
CREATE INDEX "payments_type_status_createdAt_idx" ON "payments"("type", "status", "createdAt");
CREATE INDEX "payments_subscriptionId_status_createdAt_idx" ON "payments"("subscriptionId", "status", "createdAt");
CREATE INDEX "payments_creatorId_occurredAt_idx" ON "payments"("creatorId", "occurredAt");

-- Add PageView -> Profile FK relation (cascade delete)
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
