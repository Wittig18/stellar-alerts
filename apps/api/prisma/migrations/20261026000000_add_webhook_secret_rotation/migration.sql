-- Dual-secret webhook signing rotation (#721).
--
-- Adds storage for a "previous" encrypted signing secret alongside the
-- active one, plus the timestamp at which that previous secret stops being
-- honored. This lets subscribers verify payloads signed with either secret
-- during a 24h rotation grace window, so routine/compromise-driven secret
-- rotation never breaks webhook delivery for subscribers who haven't yet
-- redeployed the new secret.
ALTER TABLE "Webhook"
ADD COLUMN "previousSecretCiphertext" TEXT,
ADD COLUMN "previousSecretIv" TEXT,
ADD COLUMN "previousSecretAuthTag" TEXT,
ADD COLUMN "previousKeyVersion" INTEGER,
ADD COLUMN "previousSecretExpiresAt" TIMESTAMP(3);

-- Backs the lazy-expiry sweep that finds webhooks whose grace period has
-- elapsed so the previous secret can be dropped.
CREATE INDEX IF NOT EXISTS "Webhook_previousSecretExpiresAt_idx" ON "Webhook"("previousSecretExpiresAt");
