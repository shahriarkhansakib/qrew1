# ADR-0003: Native PostgreSQL UUIDv7 Identifiers & Composite Foreign Keys

- **Date:** 2026-11-17
- **Status:** accepted
- **Deciders:** Project Owner

## Context

Qrew requires globally non-enumerable primary keys that maintain B-tree index locality under append-heavy multi-tenant workloads (`audit_logs`, `auth_sessions`, operational records) and database-level enforcement preventing cross-tenant foreign-key references.

## Decision

1. **UUIDv7 Everywhere:** All primary keys across Better Auth tables (`user`, `session`, `account`, `verification`, `two_factor`) and Qrew domain tables use native 16-byte PostgreSQL `uuid` columns populated with RFC 9562 monotonic UUIDv7 via a shared server-side generator (`generateId()` wired into both Better Auth `advanced.database.generateId` and Drizzle `$defaultFn`), targeting PostgreSQL 18.
2. **Composite Tenant Foreign Keys:** Tenant-owned parent tables (`offices`, `tenant_memberships`) declare `UNIQUE (tenant_id, id)`. Child office-scoped tables (`office_assignments` and future domain tables) enforce `FOREIGN KEY (tenant_id, office_id) REFERENCES offices(tenant_id, id) ON DELETE CASCADE` so cross-tenant links are impossible even at the SQL constraint layer.

## Alternatives Considered

### UUIDv4 or Default Text IDs
- **Pros:** Built into Better Auth without a custom `generateId` function.
- **Cons:** Random UUIDv4 causes B-tree index page splits on large tables; Better Auth's default 32-char text IDs consume twice the index footprint of `uuid`.
- **Why rejected:** UUIDv7 gives both non-enumerability and sequential index locality with identical 16-byte storage.

## Consequences

- **Positive:** Consistent `uuid` types across all joins and contracts; database-enforced tenant/office integrity.
- **Negative / Trade-offs:** Requires compatibility verification between Better Auth's Drizzle adapter and Drizzle `uuid()` primary keys (covered by automated integration tests).
- **Verification:** `id-compatibility.test.ts` and `tenancy-isolation.integration.test.ts` verify RFC 9562 v7 generation and SQL `23503` FK violation when linking Tenant A with an Office from Tenant B.
