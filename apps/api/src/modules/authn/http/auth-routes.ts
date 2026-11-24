import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { ApiErrorSchema, SessionResponseDtoSchema } from '@qrew/contracts';
import { openApiDefaultHook } from '../../../shared/openapi.js';
import type { SessionResolverPort } from '../domain/identity.js';
import type { BetterAuthInstance } from '../infrastructure/better-auth.js';
import { type AuthnEnvVariables, createRequireAuthMiddleware } from './auth-middleware.js';

const getMeRoute = createRoute({
  method: 'get',
  path: '/api/v1/me',
  tags: ['Auth'],
  summary: 'Get current authenticated identity',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: SessionResponseDtoSchema,
        },
      },
      description: 'Authenticated identity returned',
    },
    401: {
      content: {
        'application/json': {
          schema: ApiErrorSchema,
        },
      },
      description: 'Authentication required',
    },
  },
});

export function createAuthRouter(
  auth: BetterAuthInstance,
  sessionResolver: SessionResolverPort,
): OpenAPIHono<{ Variables: AuthnEnvVariables }> {
  const router = new OpenAPIHono<{ Variables: AuthnEnvVariables }>({
    defaultHook: openApiDefaultHook,
  });

  // Mount Better Auth handler natively on Hono (supports GET & POST across /api/auth/*)
  router.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  router.use('/api/v1/me', createRequireAuthMiddleware(sessionResolver));
  router.openapi(getMeRoute, (c) => {
    const identity = c.get('identity');
    return c.json(
      {
        authenticated: true as const,
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
