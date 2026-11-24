import { ForbiddenError } from '../../../shared/errors.js';
import type { AuthenticatedIdentity } from '../../authn/index.js';
import {
  type AccessContext,
  type AuthorizationDecision,
  type AuthorizationEnginePort,
  type AuthzRepositoryPort,
  type Permission,
  PLATFORM_ROLE_PERMISSIONS,
  type ResourceScope,
  type TenantScopeMembershipLookupPort,
} from '../domain/policy.js';

export interface AuthorizationEngineOptions {
  readonly defaultRequirePlatformMfa?: boolean;
}

export class AuthorizationEngine implements AuthorizationEnginePort {
  private readonly defaultRequirePlatformMfa: boolean;

  constructor(
    private readonly authzRepo: AuthzRepositoryPort,
    private readonly membershipLookup: TenantScopeMembershipLookupPort,
    options: AuthorizationEngineOptions = {},
  ) {
    this.defaultRequirePlatformMfa = options.defaultRequirePlatformMfa ?? true;
  }

  async isPlatformMfaRequired(): Promise<boolean> {
    const settings = await this.authzRepo.findPlatformSecuritySettings();
    return settings?.requirePlatformMfa ?? this.defaultRequirePlatformMfa;
  }

  async resolveAccessContext(identity: AuthenticatedIdentity): Promise<AccessContext> {
    const assignment = await this.authzRepo.findActivePlatformAssignment(identity.userId);
    if (assignment) {
      const requirePlatformMfa = await this.isPlatformMfaRequired();
      return {
        principalType: 'admin',
        platformRoleKey: assignment.roleKey,
        requirePlatformMfa,
        mfaRequired: requirePlatformMfa && !identity.mfaEnabled,
      };
    }

    return {
      principalType: 'user',
      platformRoleKey: null,
      requirePlatformMfa: false,
      mfaRequired: false,
    };
  }

  async assertCustomerPrincipal(identity: AuthenticatedIdentity): Promise<void> {
    const assignment = await this.authzRepo.findActivePlatformAssignment(identity.userId);
    if (assignment) {
      throw new ForbiddenError(
        'PLATFORM_ADMIN_CUSTOMER_ACCESS_DENIED',
        'Platform administrators cannot access customer tenant workspaces',
      );
    }
  }

  async authorize<TScope extends ResourceScope>(input: {
    readonly identity: AuthenticatedIdentity;
    readonly scope: TScope;
    readonly permission: Permission;
  }): Promise<AuthorizationDecision<TScope>> {
    const { identity, scope, permission } = input;

    if (!identity.emailVerified) {
      throw new ForbiddenError(
        'EMAIL_NOT_VERIFIED',
        'Verified email address is required for protected operations',
      );
    }

    if (scope.kind === 'platform') {
      const assignment = await this.authzRepo.findActivePlatformAssignment(identity.userId);
      if (!assignment) {
        throw new ForbiddenError('FORBIDDEN', 'Platform administrator access is required');
      }

      const granted = PLATFORM_ROLE_PERMISSIONS[assignment.roleKey];
      if (!granted.includes(permission)) {
        throw new ForbiddenError('FORBIDDEN', 'Insufficient platform permissions');
      }

      if ((await this.isPlatformMfaRequired()) && !identity.mfaEnabled) {
        throw new ForbiddenError(
          'PLATFORM_MFA_REQUIRED',
          'Multi-factor authentication must be enabled for platform administration',
        );
      }

      return {
        actorUserId: identity.userId,
        scope,
        verifiedPermission: permission,
        roleKey: assignment.roleKey,
        membershipId: null,
      };
    }

    await this.assertCustomerPrincipal(identity);

    if (scope.kind === 'tenant') {
      const membership = await this.membershipLookup.findActiveTenantMembership(
        identity.userId,
        scope.tenantId,
      );
      if (!membership) {
        throw new ForbiddenError('FORBIDDEN', 'You do not have active access to this tenant');
      }

      const role = await this.authzRepo.findRoleWithPermissions(membership.roleId);
      if (!role?.permissions.includes(permission)) {
        throw new ForbiddenError('FORBIDDEN', 'Insufficient tenant permissions');
      }

      return {
        actorUserId: identity.userId,
        scope,
        verifiedPermission: permission,
        roleKey: role.key,
        membershipId: membership.membershipId,
      };
    }

    // Office scope: tenant membership AND office ownership (tenantId -> officeId) are verified live
    const officeAccess = await this.membershipLookup.findActiveOfficeAccess(
      identity.userId,
      scope.tenantId,
      scope.officeId,
    );
    if (!officeAccess) {
      throw new ForbiddenError('FORBIDDEN', 'You do not have access to this office');
    }

    const tenantRole = await this.authzRepo.findRoleWithPermissions(officeAccess.tenantRoleId);
    if (tenantRole?.permissions.includes(permission)) {
      return {
        actorUserId: identity.userId,
        scope,
        verifiedPermission: permission,
        roleKey: tenantRole.key,
        membershipId: officeAccess.membershipId,
      };
    }

    if (officeAccess.officeRoleId) {
      const officeRole = await this.authzRepo.findRoleWithPermissions(officeAccess.officeRoleId);
      if (officeRole?.permissions.includes(permission)) {
        return {
          actorUserId: identity.userId,
          scope,
          verifiedPermission: permission,
          roleKey: officeRole.key,
          membershipId: officeAccess.membershipId,
        };
      }
    }

    throw new ForbiddenError('FORBIDDEN', 'Insufficient office permissions');
  }
}
