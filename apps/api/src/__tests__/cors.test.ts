import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Mock env
vi.mock('../config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    TELEGRAM_BOT_TOKEN: 'test-token',
    JWT_SECRET: 'test-super-secret-jwt-key-for-testing-only',
    REDIS_URL: 'redis://localhost:6379',
    PORT: '3001',
    APP_URL: 'http://localhost:3000',
    CSRF_ALLOWED_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_MAX: 100,
    WASM_ANALYZER_MAX_UPLOAD_BYTES: 5242880,
  },
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  },
}));

vi.mock('../plugins/prisma', () => ({
  default: async () => {},
}));

vi.mock('../plugins/websocket', () => ({
  registerSSEPushPlugin: async () => {},
}));

vi.mock('../plugins/metrics', () => ({
  default: async () => {},
}));

vi.mock('../plugins/degraded-mode', () => ({
  default: async () => {},
}));

vi.mock('../lib/queue', () => ({
  alertQueue: null,
}));

vi.mock('../lib/soroban', () => ({
  sorobanServer: {},
}));

vi.mock('../lib/redis', () => ({
  checkRedisReadiness: vi.fn().mockResolvedValue(true),
  getRedisStatus: vi.fn().mockReturnValue({ connected: true }),
}));

// Stub out route modules so buildApp doesn't load unrelated controllers
vi.mock('../modules/auth/auth.routes', () => ({ authRoutes: async () => {} }));
vi.mock('../modules/wallets/wallets.routes', () => ({ walletsRoutes: async () => {} }));
vi.mock('../modules/payments/payments.routes', () => ({ paymentsRoutes: async () => {} }));
vi.mock('../modules/webhooks/webhooks.routes', () => ({ webhooksRoutes: async () => {} }));
vi.mock('../modules/account/account.routes', () => ({ accountRoutes: async () => {} }));
vi.mock('../modules/notifications/notifications.routes', () => ({ notificationsRoutes: async () => {} }));
vi.mock('../modules/alert-rules/alert-rules.routes', () => ({ alertRulesRoutes: async () => {} }));
vi.mock('../modules/dead-letters/dead-letters.routes', () => ({ deadLettersRoutes: async () => {} }));
vi.mock('../modules/slack/slack.routes', () => ({ slackRoutes: async () => {} }));
vi.mock('../modules/graphql/graphql.routes', () => ({ graphqlRoutes: async () => {} }));
vi.mock('../modules/exports/exports.routes', () => ({ exportsRoutes: async () => {} }));
vi.mock('../modules/simulation/simulation.routes', () => ({ simulationRoutes: async () => {} }));
vi.mock('../modules/discord-interactions', () => ({ discordInteractionsRoutes: async () => {} }));
vi.mock('../modules/admin/admin.routes', () => ({ adminRoutes: async () => {} }));

import { buildApp } from '../app';

describe('CORS and Preflight security controls (Issue #7)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  }, 15000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('Preflight OPTIONS requests', () => {
    it('returns correct CORS origin and preflight headers for whitelisted origin', async () => {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'content-type',
        },
      });

      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-methods']).toBeDefined();
    });

    it('does not return access-control-allow-origin for unauthorized origin', async () => {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: {
          origin: 'http://malicious-origin.com',
          'access-control-request-method': 'POST',
        },
      });

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('Direct HTTP requests with Origin', () => {
    it('sets CORS headers when origin matches APP_URL whitelist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: 'http://localhost:3000',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('omits access-control-allow-origin for unauthorized origin', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: 'http://unauthorized-domain.com',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('allows requests without Origin header (server-to-server / curl)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    });
  });
});
