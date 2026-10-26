/**
 * Granular bitmask RBAC scope matrix for developer API keys (issue #730).
 *
 * A developer API key's permissions are stored as a single integer bitmask on
 * the `ApiKey.scopes` column (see schema.prisma). Each permission scope is one
 * bit, so:
 *
 *   - checking a required scope  → one bitwise AND (hasScope)
 *   - granting a scope           → one bitwise OR  (addScope)
 *   - revoking a scope           → one bitwise AND-NOT (removeScope)
 *
 * …all constant-time, with no joins, no scope tables, and no parsing. The
 * stable, human-readable contract exposed to API consumers is the set of
 * scope *names* ("wallets:read", "wallets:write", "alerts:write",
 * "webhooks:admin"); the integer bit values are an internal implementation
 * detail callers never need to know.
 *
 * The bitmask is a plain `number` (safe for up to 2^53 distinct bits; we use
 * four today and reserve the higher bits for future scopes). Adding a new
 * scope is a one-line addition to `ScopeMatrix` with the next power of two.
 */
import crypto from 'crypto';

/**
 * The permission scope matrix. Each key is a stable scope name (the public
 * contract); each value is its bit in the integer bitmask.
 */
export const ScopeMatrix = {
  /** Read access to a user's wallets and their ingestion status. */
  'wallets:read': 1 << 0,
  /** Create, update, and delete wallets. */
  'wallets:write': 1 << 1,
  /** Create, update, toggle, and delete alert rules. */
  'alerts:write': 1 << 2,
  /** Full administration of webhooks (create, delete, test, inspect logs). */
  'webhooks:admin': 1 << 3,
} as const;

/** A valid scope name — the public, human-readable permission contract. */
export type ScopeName = keyof typeof ScopeMatrix;

/** A permission bitmask: the bitwise OR of every granted scope bit. */
export type ScopeBitmask = number;

/**
 * Every defined scope OR'd together. Useful as a "wildcard" mask when issuing
 * a key with full access, or to enumerate all known scope names via
 * `scopeNamesFromMask(ALL_SCOPES)`.
 */
export const ALL_SCOPES: ScopeBitmask = Object.values(ScopeMatrix).reduce(
  (mask, bit) => mask | bit,
  0,
);

const VALID_SCOPE_NAMES: ReadonlySet<string> = new Set(Object.keys(ScopeMatrix));

/**
 * Throws a RangeError if `scope` is not one of the names in ScopeMatrix.
 * Guards the manipulation helpers against typos that would silently produce
 * a key with the wrong (or no) permissions.
 */
function assertValidScope(scope: ScopeName): void {
  if (!VALID_SCOPE_NAMES.has(scope)) {
    throw new RangeError(
      `Unknown RBAC scope "${String(scope)}". Valid scopes: ${[...VALID_SCOPE_NAMES].join(', ')}.`,
    );
  }
}

/**
 * Returns true iff every bit of `scope` is set in `mask` — i.e. the mask grants
 * that scope. This is the primitive the rbac middleware uses to gate a route.
 */
export function hasScope(mask: ScopeBitmask, scope: ScopeName): boolean {
  assertValidScope(scope);
  const bit = ScopeMatrix[scope];
  return (mask & bit) === bit;
}

/**
 * Returns a new mask with `scope`'s bit set. Idempotent: adding an already
 * granted scope is a no-op. Use to compose a key's permission set at creation.
 */
export function addScope(mask: ScopeBitmask, scope: ScopeName): ScopeBitmask {
  assertValidScope(scope);
  return mask | ScopeMatrix[scope];
}

/**
 * Returns a new mask with `scope`'s bit cleared. Idempotent: removing a scope
 * that wasn't granted is a no-op. Use to narrow a key's permissions.
 */
export function removeScope(mask: ScopeBitmask, scope: ScopeName): ScopeBitmask {
  assertValidScope(scope);
  return mask & ~ScopeMatrix[scope];
}

/**
 * Returns true iff `mask` grants every one of `scopes` (AND semantics). A route
 * guarded by `requireScopes('wallets:write', 'alerts:write')` requires both.
 */
export function hasAllScopes(mask: ScopeBitmask, scopes: ScopeName[]): boolean {
  return scopes.every((s) => hasScope(mask, s));
}

/**
 * Returns true iff `mask` grants at least one of `scopes` (OR semantics). An
 * empty `scopes` array is considered satisfied (vacuously true).
 */
export function hasAnyScope(mask: ScopeBitmask, scopes: ScopeName[]): boolean {
  return scopes.length === 0 ? true : scopes.some((s) => hasScope(mask, s));
}

/**
 * Builds a bitmask from a list of scope names. Duplicates and overlaps are
 * harmless (OR is idempotent).
 */
export function buildMask(scopes: ScopeName[]): ScopeBitmask {
  return scopes.reduce((mask, s) => addScope(mask, s), 0);
}

/**
 * Returns the list of scope names represented by `mask`, in the canonical
 * order they are declared in ScopeMatrix. Useful for displaying a key's
 * granted scopes to the developer.
 */
export function scopeNamesFromMask(mask: ScopeBitmask): ScopeName[] {
  return (Object.keys(ScopeMatrix) as ScopeName[]).filter((s) => hasScope(mask, s));
}

/**
 * Returns the subset of `required` scope names that are NOT present in `mask`.
 * Used by the rbac middleware to build the descriptive 403 error message on a
 * violation, naming exactly which scopes the caller is missing.
 */
export function missingScopes(mask: ScopeBitmask, required: ScopeName[]): ScopeName[] {
  return required.filter((s) => !hasScope(mask, s));
}

// ── API key generation & hashing ─────────────────────────────────────────────
//
// Raw API keys are `sk_live_` + 32 random bytes (base64url) — high entropy, URL
// safe, and visually distinct from the `sk_test_`-prefixed test keys a staging
// environment would use. Only the SHA-256 hash is persisted; the raw key is
// returned to the caller exactly once at creation and never retrievable again.

const API_KEY_PREFIX = 'sk_live_';

/**
 * Generates a new raw API key together with its SHA-256 hash (what we store)
 * and a non-secret display prefix (what we show in listings).
 */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const secret = crypto.randomBytes(32).toString('base64url');
  const key = `${API_KEY_PREFIX}${secret}`;
  return { key, hash: hashApiKey(key), prefix: key.slice(0, 12) };
}

/**
 * SHA-256 hash of a raw API key. Stored in `ApiKey.keyHash` so a compromised
 * database cannot recover usable keys. Lookup is by hash, never by raw key.
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}
