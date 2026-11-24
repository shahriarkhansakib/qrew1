---
name: database-migrations
description: >-
  PostgreSQL 18 and Drizzle ORM schema & migration discipline for Qrew: forward-only SQL migrations, UUIDv7 primary keys, composite tenant/office foreign keys, indexed FKs, and transaction safety. Use when creating or modifying database schemas or migrations.
---

# Qrew Database & Migration Discipline

## Non-Negotiable Rules

1. **Reviewed SQL Migrations Only:** Always generate SQL migrations with `pnpm db:generate` and apply with `pnpm db:migrate`. **Never** run `drizzle-kit push`.
2. **Immutable Once Applied:** Never modify a migration file that has already been committed or run outside local generation. Create a new forward migration instead.
3. **UUIDv7 Primary Keys:** Use PostgreSQL native `uuid` columns populated via `generateId()` (`$defaultFn`) across all Better Auth and Qrew domain tables.
4. **Composite Tenant Foreign Keys:**
   - Parent tenant-owned tables (`offices`, `tenant_memberships`) must declare `UNIQUE (tenant_id, id)`.
   - Office-scoped child tables must reference `FOREIGN KEY (tenant_id, office_id) REFERENCES offices(tenant_id, id) ON DELETE CASCADE`.
5. **Indexes & Types:**
   - Use `timestamptz` (`timestamp(..., { withTimezone: true })`) for all timestamps.
   - Index every foreign key and tenant/office scope column.
   - Use partial unique indexes where conditional uniqueness is required (e.g., single active `super_admin`).
6. **Transactions & Locking:**
   - Pass explicit `DbExecutor` (`tx`) across repository boundaries using `UnitOfWork`.
   - Keep external I/O (HTTP, SMTP) outside database transactions where possible, or write transactional `audit_logs` in the same `tx` as the state change.
