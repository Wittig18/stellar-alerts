import { FastifyInstance } from 'fastify';
import { authenticate, requireScopes } from '../../middleware/rbac.middleware';
import { idempotencyHooks } from '../../middleware/idempotency.middleware';
import { webhooksController } from './webhooks.controller';
import { webhookSandboxReplayController } from './sandbox.controller';

export async function webhooksRoutes(app: FastifyInstance) {
  // Unified auth (API key or session JWT) + webhooks:admin scope enforcement
  // for developer API keys. Webhooks carry secrets and are operational, so all
  // webhook access (read and write) requires the webhooks:admin scope for an
  // API key; session users keep their existing access. (#730)
  app.addHook('preHandler', authenticate);

  // Mutations carry the idempotency guard; reads do not (#334).
  const idempotent = idempotencyHooks();
  const adminScope = requireScopes('webhooks:admin');

  app.post(
    '/webhooks',
    { preValidation: idempotent.preValidation, preHandler: [adminScope], onSend: idempotent.onSend, onResponse: idempotent.onResponse },
    webhooksController.addWebhook.bind(webhooksController)
  );
  app.get(
    '/webhooks',
    { preHandler: [adminScope] },
    webhooksController.getWebhooks.bind(webhooksController)
  );
  app.delete(
    '/webhooks/:id',
    { preValidation: idempotent.preValidation, preHandler: [adminScope], onSend: idempotent.onSend, onResponse: idempotent.onResponse },
    webhooksController.deleteWebhook.bind(webhooksController)
  );
  // Deliberately excluded: this route triggers an outbound delivery. It is a
  // diagnostic probe whose whole purpose is to send, so replaying a stored
  // response would make the second press look like it worked when nothing ran.
  app.post(
    '/webhooks/:id/test',
    { preHandler: [adminScope] },
    webhooksController.testWebhook.bind(webhooksController)
  );
  // Same reasoning as /test: an outbound probe must actually run every time.
  app.post(
    '/webhooks/sandbox/replay',
    { preHandler: [adminScope] },
    webhookSandboxReplayController.replay.bind(webhookSandboxReplayController)
  );
  app.get(
    '/webhooks/:id/logs',
    { preHandler: [adminScope] },
    webhooksController.getWebhookLogs.bind(webhooksController)
  );
}
