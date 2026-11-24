import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  ApiErrorSchema,
  CreateOfficeRequestSchema,
  CreateTenantRequestSchema,
  OfficeDtoSchema,
  TenantWithRoleDtoSchema,
  UuidV7Schema,
} from '@qrew/contracts';
import { openApiDefaultHook } from '../../../shared/openapi.js';
import { createRequireAuthMiddleware, type SessionResolverPort } from '../../authn/index.js';
import {
  type AuthorizationDecision,
  type AuthorizationEnginePort,
  type AuthzEnvVariables,
  asTenantId,
  createAuthorizeMiddleware,
  createRequireCustomerUserMiddleware,
  PERMISSIONS,
  type TenantId,
} from '../../authz/index.js';
import type { CreateOfficeUseCase } from '../application/create-office.js';
import type { CreateTenantUseCase } from '../application/create-tenant.js';
import type { ListOfficesUseCase } from '../application/list-offices.js';
import type { ListUserTenantsUseCase } from '../application/list-user-tenants.js';

const TenantParamsSchema = z.object({
  tenantId: UuidV7Schema,
});

const createTenantRoute = createRoute({
  method: 'post',
  path: '/api/v1/tenants',
  tags: ['Tenancy'],
  summary: 'Create a new tenant and assign caller as Tenant Owner',
  request: {
    body: {
      content: { 'application/json': { schema: CreateTenantRequestSchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: TenantWithRoleDtoSchema } },
      description: 'Tenant created',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    403: { content: { 'application/json': { schema: ApiErrorSchema } }, description: 'Forbidden' },
    409: { content: { 'application/json': { schema: ApiErrorSchema } }, description: 'Slug taken' },
    422: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Validation error',
    },
  },
});

const listTenantsRoute = createRoute({
  method: 'get',
  path: '/api/v1/tenants',
  tags: ['Tenancy'],
  summary: 'List tenants where caller holds an active membership',
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(TenantWithRoleDtoSchema) } },
      description: 'Accessible tenants',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
  },
});

const createOfficeRoute = createRoute({
  method: 'post',
  path: '/api/v1/tenants/{tenantId}/offices',
  tags: ['Offices'],
  summary: 'Create an office within a tenant',
  request: {
    params: TenantParamsSchema,
    body: {
      content: { 'application/json': { schema: CreateOfficeRequestSchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: OfficeDtoSchema } },
      description: 'Office created',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    403: { content: { 'application/json': { schema: ApiErrorSchema } }, description: 'Forbidden' },
    409: { content: { 'application/json': { schema: ApiErrorSchema } }, description: 'Slug taken' },
    422: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Validation error',
    },
  },
});

const listOfficesRoute = createRoute({
  method: 'get',
  path: '/api/v1/tenants/{tenantId}/offices',
  tags: ['Offices'],
  summary: 'List active offices within a tenant',
  request: {
    params: TenantParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(OfficeDtoSchema) } },
      description: 'Tenant offices',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    403: { content: { 'application/json': { schema: ApiErrorSchema } }, description: 'Forbidden' },
    422: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Validation error',
    },
  },
});

export function createTenancyRouter(deps: {
  readonly sessionResolver: SessionResolverPort;
  readonly authorizationEngine: AuthorizationEnginePort;
  readonly createTenant: CreateTenantUseCase;
  readonly listUserTenants: ListUserTenantsUseCase;
  readonly createOffice: CreateOfficeUseCase;
  readonly listOffices: ListOfficesUseCase;
}): OpenAPIHono<{ Variables: AuthzEnvVariables }> {
  const router = new OpenAPIHono<{ Variables: AuthzEnvVariables }>({
    defaultHook: openApiDefaultHook,
  });

  router.use('/api/v1/tenants', createRequireAuthMiddleware(deps.sessionResolver));
  router.use('/api/v1/tenants/*', createRequireAuthMiddleware(deps.sessionResolver));
  router.use('/api/v1/tenants', createRequireCustomerUserMiddleware(deps.authorizationEngine));
  router.use('/api/v1/tenants/*', createRequireCustomerUserMiddleware(deps.authorizationEngine));

  router.openapi(createTenantRoute, async (c) => {
    const identity = c.get('identity');
    const body = c.req.valid('json');
    const created = await deps.createTenant.execute({
      identity,
      name: body.name,
      slug: body.slug,
    });
    return c.json(
      {
        id: created.id,
        name: created.name,
        slug: created.slug,
        status: created.status,
        createdAt: created.createdAt.toISOString(),
        roleKey: created.roleKey,
        membershipStatus: created.membershipStatus,
      },
      201,
    );
  });

  router.openapi(listTenantsRoute, async (c) => {
    const identity = c.get('identity');
    const items = await deps.listUserTenants.execute(identity);
    return c.json(
      items.map((item) => ({
        id: item.id,
        name: item.name,
        slug: item.slug,
        status: item.status,
        createdAt: item.createdAt.toISOString(),
        roleKey: item.roleKey,
        membershipStatus: item.membershipStatus,
      })),
      200,
    );
  });

  router.use('/api/v1/tenants/:tenantId/offices', async (c, next) => {
    const rawTenantId = c.req.param('tenantId');
    const parsed = TenantParamsSchema.safeParse({ tenantId: rawTenantId });
    if (!parsed.success) {
      return next();
    }
    const middleware = createAuthorizeMiddleware(
      deps.authorizationEngine,
      () => ({ kind: 'tenant', tenantId: asTenantId(parsed.data.tenantId) }) as const,
      c.req.method === 'POST' ? PERMISSIONS.OFFICE_CREATE : PERMISSIONS.OFFICE_LIST,
    );
    return middleware(c, next);
  });

  router.openapi(createOfficeRoute, async (c) => {
    const decision = c.get('authzDecision') as AuthorizationDecision<{
      readonly kind: 'tenant';
      readonly tenantId: TenantId;
    }>;
    const body = c.req.valid('json');
    const created = await deps.createOffice.execute({
      decision,
      name: body.name,
      slug: body.slug,
    });
    return c.json(
      {
        id: created.id,
        tenantId: created.tenantId,
        name: created.name,
        slug: created.slug,
        status: created.status,
        createdAt: created.createdAt.toISOString(),
      },
      201,
    );
  });

  router.openapi(listOfficesRoute, async (c) => {
    const decision = c.get('authzDecision') as AuthorizationDecision<{
      readonly kind: 'tenant';
      readonly tenantId: TenantId;
    }>;
    const offices = await deps.listOffices.execute(decision);
    return c.json(
      offices.map((office) => ({
        id: office.id,
        tenantId: office.tenantId,
        name: office.name,
        slug: office.slug,
        status: office.status,
        createdAt: office.createdAt.toISOString(),
      })),
      200,
    );
  });

  return router;
}
