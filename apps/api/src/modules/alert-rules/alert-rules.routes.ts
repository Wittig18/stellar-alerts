import { FastifyInstance } from 'fastify';
import { alertRulesController } from './alert-rules.controller';
import { authenticate, requireScopes } from '../../middleware/rbac.middleware';

export async function alertRulesRoutes(app: FastifyInstance) {
  app.post(
    '/alert-rules',
    { preHandler: [authenticate, requireScopes('alerts:write')] },
    alertRulesController.createRule.bind(alertRulesController)
  );

  app.get(
    '/alert-rules',
    { preHandler: [authenticate, requireScopes('alerts:write')] },
    alertRulesController.getRules.bind(alertRulesController)
  );

  app.get(
    '/alert-rules/:id',
    { preHandler: [authenticate, requireScopes('alerts:write')] },
    alertRulesController.getRule.bind(alertRulesController)
  );

  app.put(
    '/alert-rules/:id',
    { preHandler: [authenticate, requireScopes('alerts:write')] },
    alertRulesController.updateRule.bind(alertRulesController)
  );

  app.delete(
    '/alert-rules/:id',
    { preHandler: [authenticate, requireScopes('alerts:write')] },
    alertRulesController.deleteRule.bind(alertRulesController)
  );

  app.post(
    '/alert-rules/:id/toggle',
    { preHandler: [authenticate, requireScopes('alerts:write')] },
    alertRulesController.toggleRuleActive.bind(alertRulesController)
  );

  app.post(
    '/alert-rules/migrate-legacy',
    { preHandler: [authenticate, requireScopes('alerts:write')] },
    alertRulesController.migrateLegacy.bind(alertRulesController)
  );
}
