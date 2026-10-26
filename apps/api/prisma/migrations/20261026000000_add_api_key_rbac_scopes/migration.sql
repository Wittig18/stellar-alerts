-- Developer API keys with granular bitmask RBAC scopes (#730).
--
-- Introduces the ApiKey table backing developer API keys (automation bots,
-- microservices, internal dashboards). Only the SHA-256 hash of the raw key
-- is stored (`keyHash`); the plaintext key is returned to the caller exactly
-- once at creation and never persisted or retrievable. `scopes` is a plain
-- integer bitmask whose set bits encode the granted permission scopes (see
-- ScopeMatrix in modules/auth/api-key-rbac.ts): wallets:read, wallets:write,
-- alerts:write, webhooks:admin. The rbac middleware checks a required scope
-- with a single bitwise AND before a route handler runs, so a leaked
-- read-only telemetry key can no longer delete active alerts.
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- Unique index backing the @unique on keyHash: a lookup key never collides
-- and the raw key cannot be recovered from the stored hash.
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- Indexes backing the @@index declarations in prisma/schema.prisma.
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");
CREATE INDEX "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");
CREATE INDEX "ApiKey_isActive_idx" ON "ApiKey"("isActive");

-- Owning-user relation; deleting a user cascades to their API keys.
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
