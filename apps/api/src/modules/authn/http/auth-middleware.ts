import { createMiddleware } from 'hono/factory';
import type { AuthenticatedIdentity, SessionResolverPort } from '../domain/identity.js';

export interface AuthnEnvVariables {
  identity: AuthenticatedIdentity;
  requestId: string;
}

export function createRequireAuthMiddleware(
  sessionResolver: SessionResolverPort,
  options?: { readonly requireVerifiedEmail?: boolean },
) {
  return createMiddleware<{ Variables: AuthnEnvVariables }>(async (c, next) => {
    const identity = await sessionResolver.requireIdentity(c.req.raw.headers, options);
    c.set('identity', identity);
    await next();
  });
}
