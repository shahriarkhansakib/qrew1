import type { TransactionContext } from '../../../shared/unit-of-work.js';
import type { UserId } from '../../authn/index.js';
import type { OfficeId, TenantId } from '../../authz/index.js';

export interface TenantEntity {
  readonly id: TenantId;
  readonly name: string;
  readonly slug: string;
  readonly status: 'active' | 'suspended';
  readonly createdAt: Date;
}

export interface TenantMembershipRow {
  readonly id: TenantId;
  readonly name: string;
  readonly slug: string;
  readonly status: 'active' | 'suspended';
  readonly createdAt: Date;
  readonly roleId: string;
  readonly membershipStatus: 'active' | 'suspended' | 'revoked';
}

export interface TenantWithRole {
  readonly id: TenantId;
  readonly name: string;
  readonly slug: string;
  readonly status: 'active' | 'suspended';
  readonly createdAt: Date;
  readonly roleKey: string;
  readonly membershipStatus: 'active' | 'suspended' | 'revoked';
}

export interface OfficeEntity {
  readonly id: OfficeId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly slug: string;
  readonly status: 'active' | 'archived';
  readonly createdAt: Date;
}

export interface TenancyRepositoryPort {
  findTenantBySlug(slug: string, tx?: TransactionContext): Promise<TenantEntity | null>;
  findTenantById(tenantId: TenantId, tx?: TransactionContext): Promise<TenantEntity | null>;
  insertTenant(
    input: { readonly name: string; readonly slug: string },
    tx?: TransactionContext,
  ): Promise<TenantEntity>;
  insertMembership(
    input: {
      readonly tenantId: TenantId;
      readonly userId: UserId;
      readonly roleId: string;
      readonly status?: 'active' | 'suspended' | 'revoked';
    },
    tx?: TransactionContext,
  ): Promise<{ readonly id: string }>;
  listTenantMembershipsForUser(userId: UserId): Promise<readonly TenantMembershipRow[]>;
  findOfficeBySlug(
    tenantId: TenantId,
    slug: string,
    tx?: TransactionContext,
  ): Promise<OfficeEntity | null>;
  insertOffice(
    input: {
      readonly tenantId: TenantId;
      readonly name: string;
      readonly slug: string;
    },
    tx?: TransactionContext,
  ): Promise<OfficeEntity>;
  listOfficesByTenant(tenantId: TenantId): Promise<readonly OfficeEntity[]>;
  countAllTenants(): Promise<number>;
}
