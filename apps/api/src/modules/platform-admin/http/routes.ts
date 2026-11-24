import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  ApiErrorSchema,
  PlatformAdminAssignmentDtoSchema,
  PlatformAdminListItemDtoSchema,
  PlatformSecuritySettingsDtoSchema,
  PlatformStatusDtoSchema,
  ProvisionPlatformAdminRequestSchema,
  UpdatePlatformSecuritySettingsRequestSchema,
} from '@qrew/contracts';
import { openApiDefaultHook } from '../../../shared/openapi.js';
import { createRequireAuthMiddleware } from '../../authn/index.js';
import {
  type AuthorizationDecision,
  type AuthorizationEnginePort,
  type AuthzEnvVariables,
  createAuthorizeMiddleware,
  PERMISSIONS,
} from '../../authz/index.js';
import type { ListPlatformAdminsUseCase } from '../application/list-platform-admins.js';
import type { ProvisionPlatformAdminUseCase } from '../application/provision-platform-admin.js';
import type { UpdatePlatformSecuritySettingsUseCase } from '../application/update-platform-security-settings.js';

export interface PlatformTenantStatsPort {
  countAllTenants(): Promise<number>;
}

const getPlatformStatusRoute = createRoute({
  method: 'get',
  path: '/api/v1/platform/status',
  tags: ['Platform Admin'],
  summary: 'Read platform administration status',
  responses: {
    200: {
      content: { 'application/json': { schema: PlatformStatusDtoSchema } },
      description: 'Platform administration status',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthenticated',
    },
    403: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Forbidden or MFA required',
    },
  },
});

const listPlatformAdminsRoute = createRoute({
  method: 'get',
  path: '/api/v1/platform/admins',
  tags: ['Platform Admin'],
  summary: 'List platform administrator assignments',
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(PlatformAdminListItemDtoSchema) } },
      description: 'Platform administrators',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthenticated',
    },
    403: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Forbidden or MFA required',
    },
  },
});

const provisionPlatformAdminRoute = createRoute({
  method: 'post',
  path: '/api/v1/platform/admins',
  tags: ['Platform Admin'],
  summary: 'Provision a subsequent platform administrator (requires Super Admin)',
  request: {
    body: {
      content: { 'application/json': { schema: ProvisionPlatformAdminRequestSchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: PlatformAdminAssignmentDtoSchema } },
      description: 'Platform administrator provisioned',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthenticated',
    },
    403: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Forbidden or MFA required',
    },
    404: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Target user not found',
    },
    409: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Assignment already exists or user has tenant memberships',
    },
  },
});

const updatePlatformSecuritySettingsRoute = createRoute({
  method: 'patch',
  path: '/api/v1/platform/security-settings',
  tags: ['Platform Admin'],
  summary: 'Update platform-wide MFA enforcement policy (requires Super Admin)',
  request: {
    body: {
      content: { 'application/json': { schema: UpdatePlatformSecuritySettingsRequestSchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PlatformSecuritySettingsDtoSchema } },
      description: 'Platform security settings updated',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthenticated',
    },
    403: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Forbidden or MFA required',
    },
    409: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Super Admin must enroll personal MFA before enabling platform MFA requirement',
    },
  },
});

export function createPlatformAdminRouter(deps: {
  readonly sessionResolver: Parameters<typeof createRequireAuthMiddleware>[0];
  readonly authorizationEngine: AuthorizationEnginePort;
  readonly provisionAdmin: ProvisionPlatformAdminUseCase;
  readonly listAdmins: ListPlatformAdminsUseCase;
  readonly updateSecuritySettings: UpdatePlatformSecuritySettingsUseCase;
  readonly tenantStats: PlatformTenantStatsPort;
}): OpenAPIHono<{ Variables: AuthzEnvVariables }> {
  const router = new OpenAPIHono<{ Variables: AuthzEnvVariables }>({
    defaultHook: openApiDefaultHook,
  });

  router.use('/api/v1/platform/*', createRequireAuthMiddleware(deps.sessionResolver));

  router.use(
    '/api/v1/platform/status',
    createAuthorizeMiddleware(
      deps.authorizationEngine,
      () => ({ kind: 'platform' }) as const,
      PERMISSIONS.PLATFORM_STATUS_READ,
    ),
  );

  router.openapi(getPlatformStatusRoute, async (c) => {
    const decision = c.get('authzDecision') as AuthorizationDecision<{
      readonly kind: 'platform';
    }>;
    const [totalTenants, requirePlatformMfa] = await Promise.all([
      deps.tenantStats.countAllTenants(),
      deps.authorizationEngine.isPlatformMfaRequired(),
    ]);
    return c.json(
      {
        status: 'ok' as const,
        actorUserId: decision.actorUserId,
        roleKey: decision.roleKey as 'super_admin' | 'platform_admin',
        totalTenants,
        requirePlatformMfa,
      },
      200,
    );
  });

  router.use('/api/v1/platform/admins', async (c, next) => {
    const permission =
      c.req.method === 'GET'
        ? PERMISSIONS.PLATFORM_STATUS_READ
        : PERMISSIONS.PLATFORM_ADMINS_MANAGE;
    const middleware = createAuthorizeMiddleware(
      deps.authorizationEngine,
      () => ({ kind: 'platform' }) as const,
      permission,
    );
    return middleware(c, next);
  });

  router.openapi(listPlatformAdminsRoute, async (c) => {
    const admins = await deps.listAdmins.execute();
    return c.json(
      admins.map((admin) => ({
        id: admin.id,
        userId: admin.userId,
        email: admin.email,
        name: admin.name,
        emailVerified: admin.emailVerified,
        mfaEnabled: admin.mfaEnabled,
        roleKey: admin.roleKey,
        status: admin.status,
        createdAt: admin.createdAt.toISOString(),
      })),
      200,
    );
  });

  router.openapi(provisionPlatformAdminRoute, async (c) => {
    const decision = c.get('authzDecision') as AuthorizationDecision<{
      readonly kind: 'platform';
    }>;
    const body = c.req.valid('json');
    const created = await deps.provisionAdmin.execute({
      decision,
      email: body.email,
      roleKey: body.roleKey,
    });
    return c.json(
      {
        id: created.id,
        userId: created.userId,
        roleKey: created.roleKey,
        status: created.status,
        createdAt: created.createdAt.toISOString(),
      },
      201,
    );
  });

  router.use(
    '/api/v1/platform/security-settings',
    createAuthorizeMiddleware(
      deps.authorizationEngine,
      () => ({ kind: 'platform' }) as const,
      PERMISSIONS.PLATFORM_ADMINS_MANAGE,
    ),
  );

  router.openapi(updatePlatformSecuritySettingsRoute, async (c) => {
    const identity = c.get('identity');
    const decision = c.get('authzDecision') as AuthorizationDecision<{
      readonly kind: 'platform';
    }>;
    const body = c.req.valid('json');
    const updated = await deps.updateSecuritySettings.execute({
      identity,
      decision,
      requirePlatformMfa: body.requirePlatformMfa,
    });
    return c.json(
      {
        requirePlatformMfa: updated.requirePlatformMfa,
        updatedAt: updated.updatedAt.toISOString(),
      },
      200,
    );
  });

  return router;
}
