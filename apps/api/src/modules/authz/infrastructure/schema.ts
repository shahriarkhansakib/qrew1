import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateId } from '../../../shared/id.js';
import { authUsers } from '../../authn/infrastructure/schema.js';

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    tenantId: uuid('tenant_id'),
    scopeType: text('scope_type', { enum: ['platform', 'tenant', 'office'] }).notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('roles_system_scope_key_uq')
      .on(t.scopeType, t.key)
      .where(sql`${t.tenantId} IS NULL`),
    uniqueIndex('roles_tenant_scope_key_uq')
      .on(t.tenantId, t.scopeType, t.key)
      .where(sql`${t.tenantId} IS NOT NULL`),
    index('roles_tenant_id_idx').on(t.tenantId),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('role_permissions_role_permission_uq').on(t.roleId, t.permission),
    index('role_permissions_role_id_idx').on(t.roleId),
  ],
);

export const platformRoleAssignments = pgTable(
  'platform_role_assignments',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    roleKey: text('role_key', { enum: ['super_admin', 'platform_admin'] }).notNull(),
    status: text('status', { enum: ['active', 'revoked'] })
      .notNull()
      .default('active'),
    grantedByUserId: uuid('granted_by_user_id').references(() => authUsers.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('platform_role_assignments_user_uq').on(t.userId),
    uniqueIndex('platform_single_super_admin_uq')
      .on(t.roleKey)
      .where(sql`${t.roleKey} = 'super_admin' AND ${t.status} = 'active'`),
    index('platform_role_assignments_granted_by_idx').on(t.grantedByUserId),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    actorUserId: uuid('actor_user_id'),
    tenantId: uuid('tenant_id'),
    officeId: uuid('office_id'),
    scopeType: text('scope_type', { enum: ['authn', 'platform', 'tenant', 'office'] }).notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_actor_user_idx').on(t.actorUserId),
    index('audit_logs_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('audit_logs_action_idx').on(t.action),
  ],
);

export const platformSecuritySettings = pgTable('platform_security_settings', {
  id: text('id').primaryKey(),
  requirePlatformMfa: boolean('require_platform_mfa').notNull(),
  updatedByUserId: uuid('updated_by_user_id').references(() => authUsers.id, {
    onDelete: 'set null',
  }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
