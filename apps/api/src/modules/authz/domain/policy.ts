import type { TransactionContext } from '../../../shared/unit-of-work.js';
import type { AuthenticatedIdentity, UserId } from '../../authn/index.js';

export type TenantId = string & { readonly __brand: 'TenantId' };
export type OfficeId = string & { readonly __brand: 'OfficeId' };

export function asTenantId(value: string): TenantId {
  return value as TenantId;
}

export function asOfficeId(value: string): OfficeId {
  return value as OfficeId;
}

export const PERMISSIONS = {
  PLATFORM_STATUS_READ: 'platform:status:read',
  PLATFORM_ADMINS_MANAGE: 'platform:admins:manage',
  TENANT_READ: 'tenant:read',
  TENANT_MANAGE: 'tenant:manage',
  OFFICE_CREATE: 'office:create',
  OFFICE_LIST: 'office:list',
  OFFICE_READ: 'office:read',
  OFFICE_MANAGE: 'office:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export type PrincipalType = 'admin' | 'user';
export type PlatformRoleKey = 'super_admin' | 'platform_admin';

export interface AccessContext {
  readonly principalType: PrincipalType;
  readonly platformRoleKey: PlatformRoleKey | null;
  readonly requirePlatformMfa: boolean;
  readonly mfaRequired: boolean;
}
export type SystemTenantRoleKey =
  | 'tenant_owner'
  | 'tenant_admin'
  | 'office_manager'
  | 'office_member';

export const PLATFORM_ROLE_PERMISSIONS: Readonly<Record<PlatformRoleKey, readonly Permission[]>> = {
  super_admin: [PERMISSIONS.PLATFORM_STATUS_READ, PERMISSIONS.PLATFORM_ADMINS_MANAGE],
  platform_admin: [PERMISSIONS.PLATFORM_STATUS_READ],
};

export const SYSTEM_ROLE_DEFINITIONS: Readonly<
  Record<
    SystemTenantRoleKey,
    {
      readonly scopeType: 'tenant' | 'office';
      readonly name: string;
      readonly permissions: readonly Permission[];
    }
  >
> = {
  tenant_owner: {
    scopeType: 'tenant',
    name: 'Tenant Owner',
    permissions: [
      PERMISSIONS.TENANT_READ,
      PERMISSIONS.TENANT_MANAGE,
      PERMISSIONS.OFFICE_CREATE,
      PERMISSIONS.OFFICE_LIST,
      PERMISSIONS.OFFICE_READ,
      PERMISSIONS.OFFICE_MANAGE,
    ],
  },
  tenant_admin: {
    scopeType: 'tenant',
    name: 'Tenant Administrator',
    permissions: [
      PERMISSIONS.TENANT_READ,
      PERMISSIONS.OFFICE_CREATE,
      PERMISSIONS.OFFICE_LIST,
      PERMISSIONS.OFFICE_READ,
      PERMISSIONS.OFFICE_MANAGE,
    ],
  },
  office_manager: {
    scopeType: 'office',
    name: 'Office Manager',
    permissions: [PERMISSIONS.OFFICE_READ, PERMISSIONS.OFFICE_MANAGE],
  },
  office_member: {
    scopeType: 'office',
    name: 'Office Member',
    permissions: [PERMISSIONS.OFFICE_READ],
  },
};

export type ResourceScope =
  | { readonly kind: 'platform' }
  | { readonly kind: 'tenant'; readonly tenantId: TenantId }
  | { readonly kind: 'office'; readonly tenantId: TenantId; readonly officeId: OfficeId };

/**
 * Proof token returned ONLY after AuthorizationEngine evaluates live DB state
 * for the target scope and operation. Never carries a cached permission set.
 */
export interface AuthorizationDecision<TScope extends ResourceScope = ResourceScope> {
  readonly actorUserId: UserId;
  readonly scope: TScope;
  readonly verifiedPermission: Permission;
  readonly roleKey: string;
  readonly membershipId: string | null;
}

export interface AuthorizationEnginePort {
  authorize<TScope extends ResourceScope>(input: {
    readonly identity: AuthenticatedIdentity;
    readonly scope: TScope;
    readonly permission: Permission;
  }): Promise<AuthorizationDecision<TScope>>;
  resolveAccessContext(identity: AuthenticatedIdentity): Promise<AccessContext>;
  isPlatformMfaRequired(): Promise<boolean>;
  assertCustomerPrincipal(identity: AuthenticatedIdentity): Promise<void>;
}

export interface ActiveTenantMembershipRecord {
  readonly membershipId: string;
  readonly roleId: string;
}

export interface ActiveOfficeAccessRecord {
  readonly membershipId: string;
  readonly tenantRoleId: string;
  readonly officeRoleId: string | null;
}

/**
 * Outbound port implemented by modules/tenancy to query live active tenant/office scope membership.
 */
export interface TenantScopeMembershipLookupPort {
  hasAnyTenantMembership(userId: UserId, tx?: TransactionContext): Promise<boolean>;
  findActiveTenantMembership(
    userId: UserId,
    tenantId: TenantId,
  ): Promise<ActiveTenantMembershipRecord | null>;
  findActiveOfficeAccess(
    userId: UserId,
    tenantId: TenantId,
    officeId: OfficeId,
  ): Promise<ActiveOfficeAccessRecord | null>;
}

export interface PlatformAssignmentRecord {
  readonly id: string;
  readonly userId: UserId;
  readonly roleKey: PlatformRoleKey;
  readonly status: 'active' | 'revoked';
  readonly createdAt: Date;
}

export interface PlatformSecuritySettingsRecord {
  readonly requirePlatformMfa: boolean;
  readonly updatedAt: Date;
}

export interface AuthzRepositoryPort {
  findRoleWithPermissions(
    roleId: string,
  ): Promise<{ readonly key: string; readonly permissions: readonly string[] } | null>;
  findRoleKeysByIds(roleIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  ensureSystemRolesSeeded(
    tx?: TransactionContext,
  ): Promise<Readonly<Record<SystemTenantRoleKey, string>>>;
  findActivePlatformAssignment(
    userId: UserId,
    tx?: TransactionContext,
  ): Promise<PlatformAssignmentRecord | null>;
  findPlatformAssignmentByUserId(
    userId: UserId,
    tx?: TransactionContext,
  ): Promise<PlatformAssignmentRecord | null>;
  findActiveSuperAdmin(tx?: TransactionContext): Promise<PlatformAssignmentRecord | null>;
  listPlatformAssignments(): Promise<readonly PlatformAssignmentRecord[]>;
  insertPlatformAssignment(
    input: {
      readonly userId: UserId;
      readonly roleKey: PlatformRoleKey;
      readonly grantedByUserId: UserId | null;
    },
    tx?: TransactionContext,
  ): Promise<PlatformAssignmentRecord>;
  findPlatformSecuritySettings(
    tx?: TransactionContext,
  ): Promise<PlatformSecuritySettingsRecord | null>;
  upsertPlatformSecuritySettings(
    input: {
      readonly requirePlatformMfa: boolean;
      readonly updatedByUserId: UserId;
    },
    tx?: TransactionContext,
  ): Promise<PlatformSecuritySettingsRecord>;
}
