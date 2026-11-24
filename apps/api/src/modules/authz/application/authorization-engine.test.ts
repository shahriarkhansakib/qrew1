import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../shared/errors.js';
import { type AuthenticatedIdentity, asSessionId, asUserId } from '../../authn/index.js';
import {
  type AuthzRepositoryPort,
  asOfficeId,
  asTenantId,
  PERMISSIONS,
  type PlatformAssignmentRecord,
  type PlatformSecuritySettingsRecord,
  type TenantScopeMembershipLookupPort,
} from '../domain/policy.js';
import { AuthorizationEngine } from './authorization-engine.js';

function makeIdentity(overrides: Partial<AuthenticatedIdentity> = {}): AuthenticatedIdentity {
  return {
    userId: asUserId('019535d9-3df7-79fb-b466-fa907fa17f9e'),
    sessionId: asSessionId('019535d9-3df7-79fb-b466-fa907fa17f9f'),
    email: 'actor@qrew.test',
    name: 'Actor',
    emailVerified: true,
    mfaEnabled: false,
    ...overrides,
  };
}

function createFakeAuthzRepo(
  platformAssignment: PlatformAssignmentRecord | null = null,
  securitySettings: PlatformSecuritySettingsRecord | null = null,
): AuthzRepositoryPort {
  return {
    async findRoleWithPermissions(roleId) {
      if (roleId === 'role-owner') {
        return {
          key: 'tenant_owner',
          permissions: [
            PERMISSIONS.TENANT_READ,
            PERMISSIONS.OFFICE_CREATE,
            PERMISSIONS.OFFICE_READ,
          ],
        };
      }
      if (roleId === 'role-office-manager') {
        return {
          key: 'office_manager',
          permissions: [PERMISSIONS.OFFICE_READ, PERMISSIONS.OFFICE_MANAGE],
        };
      }
      return null;
    },
    async findRoleKeysByIds() {
      return new Map();
    },
    async ensureSystemRolesSeeded() {
      return {
        tenant_owner: 'role-owner',
        tenant_admin: 'role-admin',
        office_manager: 'role-office-manager',
        office_member: 'role-office-member',
      };
    },
    async findActivePlatformAssignment() {
      return platformAssignment;
    },
    async findPlatformAssignmentByUserId() {
      return platformAssignment;
    },
    async findActiveSuperAdmin() {
      return platformAssignment;
    },
    async listPlatformAssignments() {
      return platformAssignment ? [platformAssignment] : [];
    },
    async insertPlatformAssignment() {
      throw new Error('Not used in unit test');
    },
    async findPlatformSecuritySettings() {
      return securitySettings;
    },
    async upsertPlatformSecuritySettings() {
      throw new Error('Not used in unit test');
    },
  };
}

describe('AuthorizationEngine', () => {
  const tenantId = asTenantId('019535d9-3df7-79fb-b466-fa907fa17001');
  const officeId = asOfficeId('019535d9-3df7-79fb-b466-fa907fa17002');

  it('rejects unverified email identities across all scopes', async () => {
    const engine = new AuthorizationEngine(createFakeAuthzRepo(), {
      async hasAnyTenantMembership() {
        return true;
      },
      async findActiveTenantMembership() {
        return { membershipId: 'm1', roleId: 'role-owner' };
      },
      async findActiveOfficeAccess() {
        return null;
      },
    });

    await expect(
      engine.authorize({
        identity: makeIdentity({ emailVerified: false }),
        scope: { kind: 'tenant', tenantId },
        permission: PERMISSIONS.TENANT_READ,
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED', statusCode: 403 });
  });

  it('enforces MFA for platform-scope operations even when user holds super_admin assignment', async () => {
    const engine = new AuthorizationEngine(
      createFakeAuthzRepo({
        id: 'pa-1',
        userId: asUserId('019535d9-3df7-79fb-b466-fa907fa17f9e'),
        roleKey: 'super_admin',
        status: 'active',
        createdAt: new Date(),
      }),
      {
        async hasAnyTenantMembership() {
          return false;
        },
        async findActiveTenantMembership() {
          return null;
        },
        async findActiveOfficeAccess() {
          return null;
        },
      },
    );

    await expect(
      engine.authorize({
        identity: makeIdentity({ mfaEnabled: false }),
        scope: { kind: 'platform' },
        permission: PERMISSIONS.PLATFORM_STATUS_READ,
      }),
    ).rejects.toMatchObject({ code: 'PLATFORM_MFA_REQUIRED', statusCode: 403 });

    const decision = await engine.authorize({
      identity: makeIdentity({ mfaEnabled: true }),
      scope: { kind: 'platform' },
      permission: PERMISSIONS.PLATFORM_ADMINS_MANAGE,
    });

    expect(decision.roleKey).toBe('super_admin');
    expect(decision.scope.kind).toBe('platform');
  });

  it('resolves admin vs user access context and blocks active admins from tenant/office scopes', async () => {
    const adminEngine = new AuthorizationEngine(
      createFakeAuthzRepo({
        id: 'pa-1',
        userId: asUserId('019535d9-3df7-79fb-b466-fa907fa17f9e'),
        roleKey: 'super_admin',
        status: 'active',
        createdAt: new Date(),
      }),
      {
        async hasAnyTenantMembership() {
          return false;
        },
        async findActiveTenantMembership() {
          return { membershipId: 'm1', roleId: 'role-owner' };
        },
        async findActiveOfficeAccess() {
          return null;
        },
      },
    );

    const adminCtx = await adminEngine.resolveAccessContext(makeIdentity({ mfaEnabled: false }));
    expect(adminCtx).toEqual({
      principalType: 'admin',
      platformRoleKey: 'super_admin',
      requirePlatformMfa: true,
      mfaRequired: true,
    });

    await expect(adminEngine.assertCustomerPrincipal(makeIdentity())).rejects.toMatchObject({
      code: 'PLATFORM_ADMIN_CUSTOMER_ACCESS_DENIED',
      statusCode: 403,
    });

    await expect(
      adminEngine.authorize({
        identity: makeIdentity({ mfaEnabled: true }),
        scope: { kind: 'tenant', tenantId },
        permission: PERMISSIONS.TENANT_READ,
      }),
    ).rejects.toMatchObject({
      code: 'PLATFORM_ADMIN_CUSTOMER_ACCESS_DENIED',
      statusCode: 403,
    });

    const userEngine = new AuthorizationEngine(createFakeAuthzRepo(null), {
      async hasAnyTenantMembership() {
        return false;
      },
      async findActiveTenantMembership() {
        return null;
      },
      async findActiveOfficeAccess() {
        return null;
      },
    });
    expect(await userEngine.resolveAccessContext(makeIdentity())).toEqual({
      principalType: 'user',
      platformRoleKey: null,
      requirePlatformMfa: false,
      mfaRequired: false,
    });

    // Dev default (defaultRequirePlatformMfa: false) skips MFA gate until explicitly enabled
    const devEngine = new AuthorizationEngine(
      createFakeAuthzRepo({
        id: 'pa-1',
        userId: asUserId('019535d9-3df7-79fb-b466-fa907fa17f9e'),
        roleKey: 'super_admin',
        status: 'active',
        createdAt: new Date(),
      }),
      {
        async hasAnyTenantMembership() {
          return false;
        },
        async findActiveTenantMembership() {
          return null;
        },
        async findActiveOfficeAccess() {
          return null;
        },
      },
      { defaultRequirePlatformMfa: false },
    );

    const devCtx = await devEngine.resolveAccessContext(makeIdentity({ mfaEnabled: false }));
    expect(devCtx).toEqual({
      principalType: 'admin',
      platformRoleKey: 'super_admin',
      requirePlatformMfa: false,
      mfaRequired: false,
    });
    const devDecision = await devEngine.authorize({
      identity: makeIdentity({ mfaEnabled: false }),
      scope: { kind: 'platform' },
      permission: PERMISSIONS.PLATFORM_STATUS_READ,
    });
    expect(devDecision.roleKey).toBe('super_admin');
  });

  it('grants office scope when office assignment grants permission even if tenant role lacks it', async () => {
    const membershipLookup: TenantScopeMembershipLookupPort = {
      async hasAnyTenantMembership() {
        return true;
      },
      async findActiveTenantMembership() {
        return { membershipId: 'm1', roleId: 'role-none' };
      },
      async findActiveOfficeAccess() {
        return {
          membershipId: 'm1',
          tenantRoleId: 'role-none',
          officeRoleId: 'role-office-manager',
        };
      },
    };

    const engine = new AuthorizationEngine(createFakeAuthzRepo(), membershipLookup);

    const decision = await engine.authorize({
      identity: makeIdentity(),
      scope: { kind: 'office', tenantId, officeId },
      permission: PERMISSIONS.OFFICE_MANAGE,
    });

    expect(decision.roleKey).toBe('office_manager');
    expect(decision.membershipId).toBe('m1');
  });

  it('denies cross-tenant or missing membership with ForbiddenError', async () => {
    const engine = new AuthorizationEngine(createFakeAuthzRepo(), {
      async hasAnyTenantMembership() {
        return false;
      },
      async findActiveTenantMembership() {
        return null;
      },
      async findActiveOfficeAccess() {
        return null;
      },
    });

    await expect(
      engine.authorize({
        identity: makeIdentity(),
        scope: { kind: 'tenant', tenantId },
        permission: PERMISSIONS.TENANT_READ,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
