import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { AccessContextDtoSchema, ApiErrorSchema } from '@qrew/contracts';
import { openApiDefaultHook } from '../../../shared/openapi.js';
import {
  type AuthnEnvVariables,
  createRequireAuthMiddleware,
  type SessionResolverPort,
} from '../../authn/index.js';
import type { AuthorizationEnginePort } from '../domain/policy.js';

const getAccessContextRoute = createRoute({
  method: 'get',
  path: '/api/v1/access-context',
  tags: ['Authorization'],
  summary: 'Resolve top-level principal type (admin vs user) and platform role context',
  responses: {
    200: {
      content: { 'application/json': { schema: AccessContextDtoSchema } },
      description: 'Resolved access context for current session',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Authentication required',
    },
  },
});

export function createAccessContextRouter(
  sessionResolver: SessionResolverPort,
  authorizationEngine: AuthorizationEnginePort,
): OpenAPIHono<{ Variables: AuthnEnvVariables }> {
  const router = new OpenAPIHono<{ Variables: AuthnEnvVariables }>({
    defaultHook: openApiDefaultHook,
  });

  router.use('/api/v1/access-context', createRequireAuthMiddleware(sessionResolver));

  router.openapi(getAccessContextRoute, async (c) => {
    const identity = c.get('identity');
    const context = await authorizationEngine.resolveAccessContext(identity);
    return c.json(
      {
        principalType: context.principalType,
        platformRoleKey: context.platformRoleKey,
        requirePlatformMfa: context.requirePlatformMfa,
        mfaRequired: context.mfaRequired,
        user: {
          id: identity.userId,
          email: identity.email,
          name: identity.name,
          emailVerified: identity.emailVerified,
          mfaEnabled: identity.mfaEnabled,
        },
      },
      200,
    );
  });

  return router;
}
