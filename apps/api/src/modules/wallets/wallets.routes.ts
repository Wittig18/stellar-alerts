import { FastifyInstance } from 'fastify';
import { authenticate, requireScopes } from '../../middleware/rbac.middleware';
import { registerIdempotency } from '../../middleware/idempotency.middleware';
import { walletsController } from './wallets.controller';
import { exportController } from './export.controller';

export async function walletsRoutes(app: FastifyInstance) {
  // Unified auth: accepts a developer API key (x-api-key header) OR a session
  // JWT (Authorization: Bearer). Scope checks below apply to API keys only;
  // session users keep their existing access. (#730)
  app.addHook('preHandler', authenticate);
  await registerIdempotency(app);

  app.post(
    '/wallets',
    { preHandler: [requireScopes('wallets:write')] },
    walletsController.addWallet.bind(walletsController),
  );
  app.get(
    '/wallets',
    { preHandler: [requireScopes('wallets:read')] },
    walletsController.getWallets.bind(walletsController),
  );
  app.get(
    '/wallets/:id/ingestion-status',
    { preHandler: [requireScopes('wallets:read')] },
    walletsController.getIngestionStatus.bind(walletsController),
  );
  app.patch(
    '/wallets/:id/metadata',
    { preHandler: [requireScopes('wallets:write')] },
    walletsController.updateWalletMetadata.bind(walletsController),
  );
  app.delete(
    '/wallets/:id',
    { preHandler: [requireScopes('wallets:write')] },
    walletsController.deleteWallet.bind(walletsController),
  );
}
