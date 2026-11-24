import { and, count, eq } from 'drizzle-orm';
import { type AppDatabase, resolveDbExecutor } from '../../../db/client.js';
import { generateId } from '../../../shared/id.js';
import type { TransactionContext } from '../../../shared/unit-of-work.js';
import type { UserId } from '../../authn/index.js';
import {
  type ActiveOfficeAccessRecord,
  type ActiveTenantMembershipRecord,
  asOfficeId,
  asTenantId,
  type OfficeId,
  type TenantId,
  type TenantScopeMembershipLookupPort,
} from '../../authz/index.js';
import type {
  OfficeEntity,
  TenancyRepositoryPort,
  TenantEntity,
  TenantMembershipRow,
} from '../domain/tenancy.js';
import { officeAssignments, offices, tenantMemberships, tenants } from './schema.js';

export class DrizzleTenancyRepository
  implements TenancyRepositoryPort, TenantScopeMembershipLookupPort
{
  constructor(private readonly db: AppDatabase) {}

  async hasAnyTenantMembership(userId: UserId, tx?: TransactionContext): Promise<boolean> {
    const executor = resolveDbExecutor(this.db, tx);
    const rows = await executor
      .select({ id: tenantMemberships.id })
      .from(tenantMemberships)
      .where(eq(tenantMemberships.userId, userId))
      .limit(1);

    return rows.length > 0;
  }

  async findActiveTenantMembership(
    userId: UserId,
    tenantId: TenantId,
  ): Promise<ActiveTenantMembershipRecord | null> {
    const rows = await this.db
      .select({
        membershipId: tenantMemberships.id,
        roleId: tenantMemberships.roleId,
      })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
      .where(
        and(
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.status, 'active'),
          eq(tenants.status, 'active'),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async findActiveOfficeAccess(
    userId: UserId,
    tenantId: TenantId,
    officeId: OfficeId,
  ): Promise<ActiveOfficeAccessRecord | null> {
    const rows = await this.db
      .select({
        membershipId: tenantMemberships.id,
        tenantRoleId: tenantMemberships.roleId,
        officeRoleId: officeAssignments.roleId,
        officeStatus: officeAssignments.status,
      })
      .from(offices)
      .innerJoin(tenants, eq(offices.tenantId, tenants.id))
      .innerJoin(
        tenantMemberships,
        and(
          eq(tenantMemberships.tenantId, offices.tenantId),
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.status, 'active'),
        ),
      )
      .leftJoin(
        officeAssignments,
        and(
          eq(officeAssignments.tenantId, offices.tenantId),
          eq(officeAssignments.officeId, offices.id),
          eq(officeAssignments.membershipId, tenantMemberships.id),
          eq(officeAssignments.status, 'active'),
        ),
      )
      .where(
        and(
          eq(offices.id, officeId),
          eq(offices.tenantId, tenantId),
          eq(offices.status, 'active'),
          eq(tenants.status, 'active'),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      membershipId: row.membershipId,
      tenantRoleId: row.tenantRoleId,
      officeRoleId: row.officeStatus === 'active' ? row.officeRoleId : null,
    };
  }

  async findTenantBySlug(slug: string, tx?: TransactionContext): Promise<TenantEntity | null> {
    const executor = resolveDbExecutor(this.db, tx);
    const rows = await executor.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    const row = rows[0];
    return row ? this.toTenantEntity(row) : null;
  }

  async findTenantById(tenantId: TenantId, tx?: TransactionContext): Promise<TenantEntity | null> {
    const executor = resolveDbExecutor(this.db, tx);
    const rows = await executor.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const row = rows[0];
    return row ? this.toTenantEntity(row) : null;
  }

  async insertTenant(
    input: { readonly name: string; readonly slug: string },
    tx?: TransactionContext,
  ): Promise<TenantEntity> {
    const executor = resolveDbExecutor(this.db, tx);
    const rows = await executor
      .insert(tenants)
      .values({
        id: generateId(),
        name: input.name,
        slug: input.slug,
        status: 'active',
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error('Failed to insert tenant');
    return this.toTenantEntity(row);
  }

  async insertMembership(
    input: {
      readonly tenantId: TenantId;
      readonly userId: UserId;
      readonly roleId: string;
      readonly status?: 'active' | 'suspended' | 'revoked';
    },
    tx?: TransactionContext,
  ): Promise<{ readonly id: string }> {
    const executor = resolveDbExecutor(this.db, tx);
    const rows = await executor
      .insert(tenantMemberships)
      .values({
        id: generateId(),
        tenantId: input.tenantId,
        userId: input.userId,
        roleId: input.roleId,
        status: input.status ?? 'active',
      })
      .returning({ id: tenantMemberships.id });

    const row = rows[0];
    if (!row) throw new Error('Failed to insert tenant membership');
    return row;
  }

  async listTenantMembershipsForUser(userId: UserId): Promise<readonly TenantMembershipRow[]> {
    const rows = await this.db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        status: tenants.status,
        createdAt: tenants.createdAt,
        roleId: tenantMemberships.roleId,
        membershipStatus: tenantMemberships.status,
      })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
      .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.status, 'active')));

    return rows.map((row) => ({
      id: asTenantId(row.id),
      name: row.name,
      slug: row.slug,
      status: row.status,
      createdAt: row.createdAt,
      roleId: row.roleId,
      membershipStatus: row.membershipStatus,
    }));
  }

  async findOfficeBySlug(
    tenantId: TenantId,
    slug: string,
    tx?: TransactionContext,
  ): Promise<OfficeEntity | null> {
    const executor = resolveDbExecutor(this.db, tx);
    const rows = await executor
      .select()
      .from(offices)
      .where(and(eq(offices.tenantId, tenantId), eq(offices.slug, slug)))
      .limit(1);

    const row = rows[0];
    return row ? this.toOfficeEntity(row) : null;
  }

  async insertOffice(
    input: {
      readonly tenantId: TenantId;
      readonly name: string;
      readonly slug: string;
    },
    tx?: TransactionContext,
  ): Promise<OfficeEntity> {
    const executor = resolveDbExecutor(this.db, tx);
    const rows = await executor
      .insert(offices)
      .values({
        id: generateId(),
        tenantId: input.tenantId,
        name: input.name,
        slug: input.slug,
        status: 'active',
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error('Failed to insert office');
    return this.toOfficeEntity(row);
  }

  async listOfficesByTenant(tenantId: TenantId): Promise<readonly OfficeEntity[]> {
    const rows = await this.db
      .select()
      .from(offices)
      .where(and(eq(offices.tenantId, tenantId), eq(offices.status, 'active')));

    return rows.map((row) => this.toOfficeEntity(row));
  }

  async countAllTenants(): Promise<number> {
    const rows = await this.db.select({ value: count() }).from(tenants);
    return Number(rows[0]?.value ?? 0);
  }

  private toTenantEntity(row: typeof tenants.$inferSelect): TenantEntity {
    return {
      id: asTenantId(row.id),
      name: row.name,
      slug: row.slug,
      status: row.status,
      createdAt: row.createdAt,
    };
  }

  private toOfficeEntity(row: typeof offices.$inferSelect): OfficeEntity {
    return {
      id: asOfficeId(row.id),
      tenantId: asTenantId(row.tenantId),
      name: row.name,
      slug: row.slug,
      status: row.status,
      createdAt: row.createdAt,
    };
  }
}
