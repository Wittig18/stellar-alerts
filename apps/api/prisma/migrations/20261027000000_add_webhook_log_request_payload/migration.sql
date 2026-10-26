-- AlterTable
-- durationMs is declared in schema.prisma but was never migrated; IF NOT EXISTS
-- keeps this safe for databases that were patched by hand.
ALTER TABLE "WebhookLog" ADD COLUMN IF NOT EXISTS "durationMs" DOUBLE PRECISION;
ALTER TABLE "WebhookLog" ADD COLUMN "requestUrl" TEXT;
ALTER TABLE "WebhookLog" ADD COLUMN "requestPayload" TEXT;

-- CreateIndex
CREATE INDEX "WebhookLog_webhookId_sentAt_idx" ON "WebhookLog"("webhookId", "sentAt");
