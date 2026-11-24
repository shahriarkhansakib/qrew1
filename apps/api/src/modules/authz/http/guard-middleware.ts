import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AuthnEnvVariables } from '../../authn/index.js';
import type {
  AuthorizationDecision,
  AuthorizationEnginePort,
  Permission,
  ResourceScope,
} from '../domain/policy.js';

export interface AuthzEnvVariables extends AuthnEnvVariables {
  authzDecision: AuthorizationDecision;
}

export function createAuthorizeMiddleware<TScope extends ResourceScope>(
  authorizationEngine: AuthorizationEnginePort,
  resolveScope: (c: Context<{ Variables: AuthzEnvVariables }>) => TScope,
  permission: Permission,
) {
  return createMiddleware<{ Variables: AuthzEnvVariables }>(async (c, next) => {
    const identity = c.get('identity');
    const scope = resolveScope(c);
    const decision = await authorizationEngine.authorize({
      identity,
      scope,
      permission,
    });
    c.set('authzDecision', decision);
    await next();
  });
}

export function createRequireCustomerUserMiddleware(authorizationEngine: AuthorizationEnginePort) {
  return createMiddleware<{ Variables: AuthnEnvVariables }>(async (c, next) => {
    const identity = c.get('identity');
    await authorizationEngine.assertCustomerPrincipal(identity);
    await next();
  });
}
