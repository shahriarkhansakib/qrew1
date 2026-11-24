import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { HealthResponseSchema } from '@qrew/contracts';
import { Scalar } from '@scalar/hono-api-reference';
import { sql } from 'drizzle-orm';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { ZodError } from 'zod';
import type { AppContainer } from './composition/container.js';
import { createAuthRouter } from './modules/authn/index.js';
import { type AuthzEnvVariables, createAccessContextRouter } from './modules/authz/index.js';
import { createPlatformAdminRouter } from './modules/platform-admin/index.js';
import { createTenancyRouter } from './modules/tenancy/index.js';
import { AppError } from './shared/errors.js';
import { openApiDefaultHook } from './shared/openapi.js';

const healthRoute = createRoute({
  method: 'get',
  path: '/api/health',
  tags: ['System'],
  summary: 'Check API and PostgreSQL readiness',
  responses: {
    200: {
      content: { 'application/json': { schema: HealthResponseSchema } },
      description: 'Service healthy',
    },
    503: {
      content: { 'application/json': { schema: HealthResponseSchema } },
      description: 'Service degraded',
    },
  },
});

export function createApp(container: AppContainer): OpenAPIHono<{ Variables: AuthzEnvVariables }> {
  const app = new OpenAPIHono<{ Variables: AuthzEnvVariables }>({
    defaultHook: openApiDefaultHook,
  });

  app.use('*', requestId());
  app.use(
    '*',
    secureHeaders(
      container.env.NODE_ENV === 'production'
        ? {
            contentSecurityPolicy: {
              defaultSrc: ["'self'"],
              baseUri: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
            },
          }
        : undefined,
    ),
  );

  app.use(
    '/api/*',
    cors({
      origin: [container.env.WEB_PUBLIC_ORIGIN],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Qrew-RSC-Prefetch'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    }),
  );

  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const durationMs = Date.now() - start;
    container.logger.info(
      {
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs,
      },
      'http_request',
    );
  });

  app.onError((err, c) => {
    const reqId = c.get('requestId') ?? 'unknown';

    if (err instanceof AppError) {
      if (err.statusCode >= 500) {
        container.logger.error({ requestId: reqId, err }, err.message);
      } else {
        container.logger.warn(
          { requestId: reqId, code: err.code, statusCode: err.statusCode },
          err.message,
        );
      }

      return c.json(
        {
          error: {
            code: err.code,
            message: err.exposeMessage ? err.message : 'An internal error occurred',
            ...(err.details ? { details: [...err.details] } : {}),
            requestId: reqId,
          },
        },
        err.statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
      );
    }

    if (err instanceof ZodError) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: err.issues.map((issue) => ({
              field: issue.path.join('.'),
              message: issue.message,
              code: issue.code,
            })),
            requestId: reqId,
          },
        },
        422,
      );
    }

    container.logger.error({ requestId: reqId, err }, 'unhandled_api_error');
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected internal error occurred',
          requestId: reqId,
        },
      },
      500,
    );
  });

  app.notFound((c) => {
    const reqId = c.get('requestId') ?? 'unknown';
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Route not found: ${c.req.method} ${c.req.path}`,
          requestId: reqId,
        },
      },
      404,
    );
  });

  app.openapi(healthRoute, async (c) => {
    let dbConnected = false;
    try {
      await container.db.execute(sql`SELECT 1`);
      dbConnected = true;
    } catch (error) {
      container.logger.error({ err: error }, 'health_check_db_failed');
    }

    return c.json(
      {
        status: dbConnected ? ('ok' as const) : ('degraded' as const),
        timestamp: new Date().toISOString(),
        database: dbConnected ? ('connected' as const) : ('disconnected' as const),
      },
      dbConnected ? 200 : 503,
    );
  });

  // Mount module routers
  app.route('/', createAuthRouter(container.auth, container.sessionResolver));
  app.route(
    '/',
    createAccessContextRouter(container.sessionResolver, container.authorizationEngine),
  );
  app.route(
    '/',
    createTenancyRouter({
      sessionResolver: container.sessionResolver,
      authorizationEngine: container.authorizationEngine,
      createTenant: container.createTenant,
      listUserTenants: container.listUserTenants,
      createOffice: container.createOffice,
      listOffices: container.listOffices,
    }),
  );
  app.route(
    '/',
    createPlatformAdminRouter({
      sessionResolver: container.sessionResolver,
      authorizationEngine: container.authorizationEngine,
      provisionAdmin: container.provisionPlatformAdmin,
      listAdmins: container.listPlatformAdmins,
      updateSecuritySettings: container.updatePlatformSecuritySettings,
      tenantStats: container.tenancyRepo,
    }),
  );

  app.doc('/api/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Qrew API',
      version: '0.1.0',
    },
  });

  if (container.env.NODE_ENV !== 'production') {
    app.get(
      '/api/docs',
      Scalar({
        url: '/api/openapi.json',
      }),
    );
  }

  return app;
}
