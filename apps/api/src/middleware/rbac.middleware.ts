/**
 * Fastify preHandler middleware enforcing per-route RBAC scope checks on
 * developer API keys (issue #730).
 *
 * Two pieces compose to gate a route by scope:
 *
 *   1. `authenticate` — a unified preHandler that authenticates EITHER a
 *      developer API key (sent in the `x-api-key` header) OR a session JWT
 *      (sent in `Authorization: Bearer`). When an API key is present it takes
 *      precedence: the key's SHA-256 hash is looked up, validated (active,
 *      not expired), and its granted scope bitmask is attached to
 *      `request.apiKey` (plus a minimal `request.user` so handlers reading
 *      `request.user.id` work for key-authenticated requests). Otherwise the
 *      request is authenticated as a session JWT via the existing
 *      `authenticateHook`. One path or the other must succeed, otherwise a
 *      401 is raised.
 *
 *   2. `requireScopes(...scopes)` — a preHandler factory returning a guard
 *      that verifies the authenticated API key possesses every required
 *      scope bit before the route handler runs. Session-JWT-authenticated
 *      requests (no `request.apiKey`) are allowed through unchanged — scope
 *      checks apply only to developer API keys. On a violation it throws
 *      AuthorizationError (403) with a descriptive message naming the exact
 *      missing scope(s).
 *
 * Usage on a route:
 *
 *   app.post('/wallets', { preHandler: [authenticate, requireScopes('wallets:write')] }, handler);
 *
 * Or at the plugin level with per-route scope narrowing:
 *
 *   app.addHook('preHandler', authenticate);
 *   app.get('/wallets', { preHandler: [requireScopes('wallets:read')] }, handler);
 */
import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticateHook } from './auth.middleware';
import {
  ScopeMatrix,
  ScopeName,
  ScopeBitmask,
  hasAllScopes,
  missingScopes,
  hashApiKey,
} from '../modules/auth/api-key-rbac';
import { AuthenticationError, AuthorizationError } from '../lib/errors';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Set by `authenticate` when the request was made with a developer API
     * key (vs. a session JWT). Carries the key id, owning user id, and the
     * granted scope bitmask that `requireScopes` checks against.
     */
    apiKey?: {
      id: string;
      userId: string;
      scopes: ScopeBitmask;
    };
  }
}

const API_KEY_HEADER = 'x-api-key';

/**
 * Extracts a raw API key from the request, or null when none was supplied.
 * API keys travel in the `x-api-key` header (kept distinct from the
 * `Authorization: Bearer` JWT header so the two auth modes never collide and
 * the logger's redaction list already covers `x-api-key`).
 */
function extractApiKey(request: FastifyRequest): string | null {
  const header = request.headers[API_KEY_HEADER];
  if (typeof header === 'string' && header.trim().length > 0) {
    return header.trim();
  }
  return null;
}

/**
 * Resolves and validates the supplied API key, attaching the granted scope
 * bitmask to `request.apiKey` and a minimal `request.user`. Throws
 * AuthenticationError (401) for a key that doesn't exist, is deactivated, or
 * has expired — so the caller sees a 401 (bad credentials) rather than a 403,
 * matching REST conventions for invalid auth material.
 */
async function authenticateApiKey(request: FastifyRequest, rawKey: string): Promise<void> {
  const keyHash = hashApiKey(rawKey);
  const record = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { user: { select: { id: true, email: true } } },
  });

  if (!record || !record.isActive) {
    throw new AuthenticationError('Invalid or inactive API key.', 'INVALID_API_KEY');
  }

  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
    throw new AuthenticationError('API key has expired.', 'EXPIRED_API_KEY');
  }

  request.apiKey = {
    id: record.id,
    userId: record.userId,
    scopes: record.scopes,
  };
  // Also populate request.user so route handlers that read request.user.id
  // work for key-authenticated requests exactly as they do for JWT sessions.
  request.user = { id: record.user.id, email: record.user.email };
}

/**
 * Unified authentication preHandler for routes that accept EITHER a developer
 * API key (via the `x-api-key` header) or a session JWT (via
 * `Authorization: Bearer`). When an API key is present it takes precedence;
 * otherwise the request is authenticated as a session JWT through the existing
 * `authenticateHook`. Exactly one of the two must succeed; a request with
 * neither credential is rejected with a 401 by the JWT path.
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const rawKey = extractApiKey(request);
  if (rawKey) {
    await authenticateApiKey(request, rawKey);
    return;
  }
  await authenticateHook(request, reply);
}

/**
 * preHandler factory: returns a guard that enforces the authenticated API key
 * possesses every one of `requiredScopes` before the route handler runs.
 *
 * Scope enforcement applies to API-key-authenticated requests only. A
 * session-JWT user (`request.apiKey` unset) is not subject to scope checks —
 * web UI sessions keep their existing access; only developer API keys are
 * scoped. If no credential authenticated the request at all, a 401 is raised
 * (the `authenticate` hook would already have done so, but this keeps the
 * guard safe to compose with `authenticateHook` alone too).
 *
 * On a violation it throws AuthorizationError (403) carrying the
 * `INSUFFICIENT_SCOPE` code and a message naming exactly which scope(s) the
 * key is missing, e.g.:
 *   "API key is missing required scope(s): wallets:write."
 */
export function requireScopes(...requiredScopes: ScopeName[]) {
  if (requiredScopes.length === 0) {
    throw new RangeError('requireScopes() requires at least one scope name.');
  }
  // Validate every scope name up front so a typo in a route definition fails
  // at app boot (when the factory runs), not on the first matching request.
  for (const scope of requiredScopes) {
    if (!(scope in ScopeMatrix)) {
      throw new RangeError(`requireScopes() received unknown scope "${String(scope)}".`);
    }
  }

  return async function rbacScopeGuard(request: FastifyRequest): Promise<void> {
    // Session-JWT requests are not subject to API key scope checks.
    if (!request.apiKey) {
      if (!request.user) {
        throw new AuthenticationError(
          'Authentication is required before an API key scope check.',
          'AUTH_REQUIRED',
        );
      }
      return;
    }

    if (!hasAllScopes(request.apiKey.scopes, requiredScopes)) {
      const missing = missingScopes(request.apiKey.scopes, requiredScopes);
      throw new AuthorizationError(
        `API key is missing required scope(s): ${missing.join(', ')}.`,
        'INSUFFICIENT_SCOPE',
      );
    }
  };
}
