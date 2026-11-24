import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { type AppDatabase, resolveDbExecutor } from '../../../db/client.js';
import { generateId } from '../../../shared/id.js';
import type { TransactionContext } from '../../../shared/unit-of-work.js';
import { asUserId, type UserId } from '../../authn/index.js';
import {
  type AuthzRepositoryPort,
  type PlatformAssignmentRecord,
  type PlatformRoleKey,
  type PlatformSecuritySettingsRecord,
  SYSTEM_ROLE_DEFINITIONS,
  type SystemTenantRoleKey,
} from '../domain/policy.js';
import {
  platformRoleAssignments,
  platformSecuritySettings,
  rolePermissions,
  roles,
} from './schema.js';

export class DrizzleAuthzRepository implements AuthzRepositoryPort {
  constructor(private readonly db: AppDatabase) {}

  async findRoleWithPermissions(
    roleId: string,
  ): Promise<{ readonly key: string; readonly permissions: readonly string[] } | null> {
    const roleRows = await this.db
      .select({ id: roles.id, key: roles.key })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1);

    const role = roleRows[0];
    if (!role) return null;

    const perms = await this.db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, role.id));

    return {
      key: role.key,
      permissions: perms.map((p) => p.permission),
    };
  }

  async findRoleKeysByIds(roleIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (roleIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({ id: roles.id, key: roles.key })
      .from(roles)
      .where(inArray(roles.id, [...roleIds]));

    return new Map(rows.map((r) => [r.id, r.key]));
  }

  async ensureSystemRolesSeeded(
    tx?: TransactionContext,
  ): Promise<Readonly<Record<SystemTenantRoleKey, string>>> {
    const executor = resolveDbExecutor(this.db, tx);
    const roleIds = {} as Record<SystemTenantRoleKey, string>;

    for (const [key, def] of Object.entries(SYSTEM_ROLE_DEFINITIONS) as Array<
      [SystemTenantRoleKey, (typeof SYSTEM_ROLE_DEFINITIONS)[SystemTenantRoleKey]]
    >) {
      const existing = await executor
        .select({ id: roles.id })
        .from(roles)
        .where(and(isNull(roles.tenantId), eq(roles.scopeType, def.scopeType), eq(roles.key, key)))
        .limit(1);

      let roleId = existing[0]?.id;
      if (!roleId) {
        const inserted = await executor
          .insert(roles)
          .values({
            id: generateId(),
            tenantId: null,
            scopeType: def.scopeType,
            key,
            name: def.name,
            isSystem: true,
          })
          .onConflictDoNothing()
          .returning({ id: roles.id });

        if (inserted[0]?.id) {
          roleId = inserted[0].id;
        } else {
          const refetched = await executor
            .select({ id: roles.id })
            .from(roles)
            .where(
              and(isNull(roles.tenantId), eq(roles.scopeType, def.scopeType), eq(roles.key, key)),
            )
            .limit(1);
          roleId = refetched[0]?.id;
        }
      }

      if (!roleId) {
        throw new Error(`Failed to seed system role: ${key}`);
      }

      roleIds[key] = roleId;

      for (const permission of def.permissions) {
        await executor
          .insert(rolePermissions)
          .values({
            id: generateId(),
            roleId,
            permission,
          })
          .onConflictDoNothing();
      }
    }

    return roleIds;
  }

  async findActivePlatformAssignment(
    userId: UserId,
    tx?: TransactionContext,
  ): Promise<PlatformAssignmentRecord | null> {
    const executor = resolveDbExecutor(this.db, tx);
    const rows = await executor
      .select()
      .from(platformRoleAssignments)
      .where(
        and(
          eq(platformRoleAssignments.userId, userId),
          eq(platformRoleAssignments.status, 'active'),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row ? this.toPlatformRecord(row) : null;
  }

  async findPlatformAssignmentByUserId(
    userId: UserId,
    tx?: TransactionContext,
  ): Promise<PlatformAssignmentRecord | null> {
    const executor = resolveDbExecutor(this.db, tx);
    const rows = await executor
      .select()
      .from(platformRoleAssignments)
      .where(eq(platformRoleAssignments.userId, userId))
      .limit(1);

    const row = rows[0];
    return row ? this.toPlatformRecord(row) : null;
  }

  async findActiveSuperAdmin(tx?: TransactionContext): Promise<PlatformAssignmentRecord | null> {
    const executor = resolveDbExecutor(this.db, tx);
    const rows = await executor
      .select()
      .from(platformRoleAssignments)
      .where(
        and(
          eq(platformRoleAssignments.roleKey, 'super_admin'),
          eq(platformRoleAssignments.status, 'active'),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row ? this.toPlatformRecord(row) : null;
  }

  async listPlatformAssignments(): Promise<readonly PlatformAssignmentRecord[]> {
    const rows = await this.db
      .select()
      .from(platformRoleAssignments)
      .orderBy(asc(platformRoleAssignments.createdAt));

    return rows.map((row) => this.toPlatformRecord(row));
  }

  async insertPlatformAssignment(
    input: {
      readonly userId: UserId;
      readonly roleKey: PlatformRoleKey;
      readonly grantedByUserId: UserId | null;
    },
    tx?: TransactionContext,
  ): Promise<PlatformAssignmentRecord> {
    const executor = resolveDbExecutor(this.db, tx);
    const rows = await executor
      .insert(platformRoleAssignments)
      .values({
        id: generateId(),
        userId: input.userId,
        roleKey: input.roleKey,
        status: 'active',
        grantedByUserId: input.grantedByUserId,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error('Failed to insert platform role assignment');
    }
    return this.toPlatformRecord(row);
  }

  async findPlatformSecuritySettings(
    tx?: TransactionContext,
  ): Promise<PlatformSecuritySettingsRecord | null> {
    const executor = resolveDbExecutor(this.db, tx);
    const rows = await executor
      .select()
      .from(platformSecuritySettings)
      .where(eq(platformSecuritySettings.id, 'default'))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      requirePlatformMfa: row.requirePlatformMfa,
      updatedAt: row.updatedAt,
    };
  }

  async upsertPlatformSecuritySettings(
    input: {
      readonly requirePlatformMfa: boolean;
      readonly updatedByUserId: UserId;
    },
    tx?: TransactionContext,
  ): Promise<PlatformSecuritySettingsRecord> {
    const executor = resolveDbExecutor(this.db, tx);
    const now = new Date();
    const rows = await executor
      .insert(platformSecuritySettings)
      .values({
        id: 'default',
        requirePlatformMfa: input.requirePlatformMfa,
        updatedByUserId: input.updatedByUserId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: platformSecuritySettings.id,
        set: {
          requirePlatformMfa: input.requirePlatformMfa,
          updatedByUserId: input.updatedByUserId,
          updatedAt: now,
        },
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error('Failed to update platform security settings');
    }

    return {
      requirePlatformMfa: row.requirePlatformMfa,
      updatedAt: row.updatedAt,
    };
  }

  private toPlatformRecord(
    row: typeof platformRoleAssignments.$inferSelect,
  ): PlatformAssignmentRecord {
    return {
      id: row.id,
      userId: asUserId(row.userId),
      roleKey: row.roleKey,
      status: row.status,
      createdAt: row.createdAt,
    };
  }
}
