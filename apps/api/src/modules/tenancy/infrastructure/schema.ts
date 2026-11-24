import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateId } from '../../../shared/id.js';
import { authUsers } from '../../authn/infrastructure/schema.js';
import { roles } from '../../authz/infrastructure/schema.js';

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: text('status', { enum: ['active', 'suspended'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tenants_slug_uq').on(t.slug)],
);

export const offices = pgTable(
  'offices',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('offices_tenant_id_id_uq').on(t.tenantId, t.id),
    uniqueIndex('offices_tenant_id_slug_uq').on(t.tenantId, t.slug),
    index('offices_tenant_id_idx').on(t.tenantId),
  ],
);

export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    status: text('status', { enum: ['active', 'suspended', 'revoked'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tenant_memberships_tenant_user_uq').on(t.tenantId, t.userId),
    unique('tenant_memberships_tenant_id_uq').on(t.tenantId, t.id),
    index('tenant_memberships_user_id_idx').on(t.userId),
    index('tenant_memberships_role_id_idx').on(t.roleId),
  ],
);

export const officeAssignments = pgTable(
  'office_assignments',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    officeId: uuid('office_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    status: text('status', { enum: ['active', 'revoked'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'office_assignments_tenant_office_fk',
      columns: [t.tenantId, t.officeId],
      foreignColumns: [offices.tenantId, offices.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'office_assignments_tenant_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.id],
    }).onDelete('cascade'),
    uniqueIndex('office_assignments_unique_uq').on(t.tenantId, t.officeId, t.membershipId),
    index('office_assignments_role_id_idx').on(t.roleId),
  ],
);
