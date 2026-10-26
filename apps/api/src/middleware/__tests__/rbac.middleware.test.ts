/**
 * Integration tests for the RBAC scope middleware (issue #730).
 *
 * These boot a minimal Fastify app wired with the real `authenticate` +
 * `requireScopes(...)` preHandlers, mock the API-key Prisma lookup, and hit
 * real routes with `app.inject()` to assert the HTTP behaviour a client
 * observes:
 *
 *   - a key lacking a required scope is rejected with 403 + a descriptive
 *     missing-scope message (the core acceptance criterion),
 *   - a key holding the scope reaches the handler (200),
 *   - invalid / inactive / expired keys are rejected with 401,
 *   - a request with no credential at all is rejected with 401.
 *
 * The session-JWT fallback (`authenticateHook`) is stubbed so the test stays
 * focused on RBAC scope enforcement and doesn't pull in JWT/Redis wiring; the
 * real JWT path is covered by the existing auth + error-envelope suites.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Stub the session-JWT fallback so we exercise the API-key path in isolation.
// The real authenticateHook is covered by the auth/error-envelope suites.
vi.mock('../../middleware/auth.middleware', () => ({
  authenticateHook: vi.fn(async (request: any) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const { AuthenticationError } = await import('../../lib/errors');
      throw new AuthenticationError(
        'You must be logged in to perform this action.',
        'AUTH_REQUIRED',
      );
    }
    // Tests below never rely on a real JWT; mark a session user so any route
    // that is reached through the JWT path has request.user set.
    request.user = { id: 'session-user', email: 'session@example.com' };
  }),
}));

// Mock the Prisma client so the API-key lookup is deterministic per test.
vi.mock('../../lib/prisma', () => {
  const mockPrisma: any = {
    apiKey: { findUnique: vi.fn() },
  };
  return { prisma: mockPrisma };
});

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { authenticate, requireScopes } from '../rbac.middleware';
import { AppError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { hashApiKey, buildMask } from '../../modules/auth/api-key-rbac';

const RAW_KEY = 'sk_live_testkey_integration_abc123';
const KEY_HASH = hashApiKey(RAW_KEY);

function apiKeyRecord(overrides: Partial<{
  id: string;
  userId: string;
  scopes: number;
  isActive: boolean;
  expiresAt: Date | null;
}> = {}) {
  return {
    id: 'key-1',
    userId: 'user-1',
    scopes: 0,
    isActive: true,
    expiresAt: null,
    user: { id: 'user-1', email: 'dev@example.com' },
    ...overrides,
  };
}

function buildTestApp(): FastifyInstance {
  const app = Fastify();
  // Mirror app.ts's documented error envelope so the assertions match what
  // a real client would receive: { error: { code, message, requestId } }.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: String(request.id),
        },
      });
    }
    return reply.code(error.statusCode ?? 500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
        requestId: String(request.id),
      },
    });
  });

  app.post(
    '/wallets',
    { preHandler: [authenticate, requireScopes('wallets:write')] },
    async () => ({ ok: true, action: 'wallet-write' }),
  );
  app.get(
    '/wallets',
    { preHandler: [authenticate, requireScopes('wallets:read')] },
    async (request) => ({ ok: true, userId: request.user?.id }),
  );
  // A route guarded by multiple scopes (AND semantics).
  app.post(
    '/multi',
    { preHandler: [authenticate, requireScopes('wallets:write', 'alerts:write')] },
    async () => ({ ok: true }),
  );
  return app;
}

describe('RBAC scope middleware (issue #730)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildTestApp();
    await app.ready();
  });

  beforeEach(() => {
    // Reset call history (and any per-test resolved value) between cases so
    // spy-call-count assertions are isolated to the single request below.
    vi.mocked(prisma.apiKey.findUnique).mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an API key lacking the required scope with 403 + descriptive message', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(
      apiKeyRecord({ scopes: buildMask(['wallets:read']) }) as any,
    );

    const res = await app.inject({
      method: 'POST',
      url: '/wallets', // requires wallets:write
      headers: { 'x-api-key': RAW_KEY },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe('INSUFFICIENT_SCOPE');
    // Descriptive message must name the exact missing scope.
    expect(body.error.message).toContain('wallets:write');
  });

  it('allows an API key that holds the required scope through to the handler', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(
      apiKeyRecord({ scopes: buildMask(['wallets:write']) }) as any,
    );

    const res = await app.inject({
      method: 'POST',
      url: '/wallets',
      headers: { 'x-api-key': RAW_KEY },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, action: 'wallet-write' });
  });

  it('enforces scopes per route (read key can GET but not POST)', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(
      apiKeyRecord({ scopes: buildMask(['wallets:read']) }) as any,
    );

    const getRes = await app.inject({
      method: 'GET',
      url: '/wallets',
      headers: { 'x-api-key': RAW_KEY },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().userId).toBe('user-1');

    const postRes = await app.inject({
      method: 'POST',
      url: '/wallets',
      headers: { 'x-api-key': RAW_KEY },
    });
    expect(postRes.statusCode).toBe(403);
    expect(postRes.json().error.message).toContain('wallets:write');
  });

  it('requires multiple scopes (AND) and names every missing one', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(
      apiKeyRecord({ scopes: buildMask(['wallets:read']) }) as any,
    );

    const res = await app.inject({
      method: 'POST',
      url: '/multi',
      headers: { 'x-api-key': RAW_KEY },
    });

    expect(res.statusCode).toBe(403);
    const msg = res.json().error.message;
    expect(msg).toContain('wallets:write');
    expect(msg).toContain('alerts:write');
  });

  it('rejects an unknown API key with 401 (not 403)', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/wallets',
      headers: { 'x-api-key': 'sk_live_does_not_exist' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_API_KEY');
  });

  it('rejects a deactivated API key with 401', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(
      apiKeyRecord({ isActive: false, scopes: buildMask(['wallets:read']) }) as any,
    );

    const res = await app.inject({
      method: 'GET',
      url: '/wallets',
      headers: { 'x-api-key': RAW_KEY },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_API_KEY');
  });

  it('rejects an expired API key with 401', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(
      apiKeyRecord({
        scopes: buildMask(['wallets:read']),
        expiresAt: new Date(Date.now() - 60_000),
      }) as any,
    );

    const res = await app.inject({
      method: 'GET',
      url: '/wallets',
      headers: { 'x-api-key': RAW_KEY },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('EXPIRED_API_KEY');
  });

  it('rejects a request with no credential at all with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/wallets' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_REQUIRED');
  });

  it('looks up the API key by its SHA-256 hash, not the raw key', async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(
      apiKeyRecord({ scopes: buildMask(['wallets:read']) }) as any,
    );

    await app.inject({
      method: 'GET',
      url: '/wallets',
      headers: { 'x-api-key': RAW_KEY },
    });

    expect(prisma.apiKey.findUnique).toHaveBeenCalledTimes(1);
    const call = vi.mocked(prisma.apiKey.findUnique).mock.calls[0][0] as any;
    expect(call.where.keyHash).toBe(KEY_HASH);
    expect(call.where.keyHash).not.toBe(RAW_KEY);
  });
});
