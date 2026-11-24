# Qrew Developer Ownership & Collaboration Guide

This guide defines subsystem boundaries, shared contracts, and coordination rules for parallel development across Authentication (**Asif**) and Authorization (**Abdullah**).

---

## 1. Core Rule: Separation of Authentication and Authorization

- **Authentication** establishes *who the caller is* and maintains login sessions, credentials, OAuth links, verification, and MFA.
- **Authorization** consumes the verified `AuthenticatedIdentity` and evaluates *what that caller is allowed to do* against live **platform**, **tenant**, or **office** state.
- **One-way dependency:** `modules/authn` must **never** import `modules/authz`, `modules/tenancy`, or `modules/platform-admin` (mechanically enforced by `pnpm lint:arch`).

---

## 2. Subsystem Ownership Matrix

### Asif — Authentication Engineer
| Area | Paths |
| --- | --- |
| Primary backend module | `apps/api/src/modules/authn/**` (`domain/`, `infrastructure/`, `http/`, `index.ts`) |
| Related frontend client | `apps/web/src/lib/auth-client.ts` (plus login/register/verification UI coordination) |
| Authentication tests | `apps/api/tests/integration/authn.integration.test.ts` and `modules/authn/**/*.test.ts` |

**Responsibilities (build on existing Better Auth integration, do not replace it):**
- Better Auth server/client lifecycle (`better-auth` + `@better-auth/drizzle-adapter`).
- Email/password (`scrypt`) registration, sign-in, and anti-enumeration behavior.
- Google OAuth sign-in and account linking.
- Email verification (`Mailpit`/SMTP locally) and password reset flows.
- Session lifecycle (`SessionResolverPort`), `HttpOnly`/`SameSite=Lax` cookie settings, and global session revocation on password reset or account-wide security events.
- TOTP MFA enrollment, verification, and recovery (`twoFactor` plugin).
- Database-backed rate limiting and CSRF/`trustedOrigins` origin verification.
- Authentication documentation and security tests.

**Off-limits for `authn`:**
- Must **not** enable Better Auth `organization` or `admin` plugins.
- Must **not** store or evaluate tenant roles, office permissions, or platform roles inside `authn` or `AuthenticatedIdentity`.
- Must **not** revoke global Better Auth sessions when a user loses membership in a single tenant.

### Abdullah — Authorization Engineer
| Area | Paths |
| --- | --- |
| Primary backend module | `apps/api/src/modules/authz/**` (`domain/`, `application/`, `infrastructure/`, `http/`, `index.ts`) |
| Related authorization consumers | `apps/api/src/modules/tenancy/**`, `apps/api/src/modules/platform-admin/**` |
| Authorization & isolation tests | `apps/api/src/modules/authz/**/*.test.ts`, `apps/api/tests/integration/authz-and-bootstrap.integration.test.ts`, `apps/api/tests/integration/tenancy-isolation.integration.test.ts` |

**Responsibilities:**
- Canonical `PERMISSIONS`, `SYSTEM_ROLE_DEFINITIONS`, and `PLATFORM_ROLE_PERMISSIONS` registries.
- `AuthorizationEngine` (`AuthorizationEnginePort`) and `createAuthorizeMiddleware` HTTP guard.
- Platform-scope checks (including verified email + `mfaEnabled` enforcement), Super Admin bootstrap guards, and platform-admin provisioning.
- Tenant-scope and office-scope authorization checks (`ResourceScope`: `platform | tenant | office`).
- Custom role creation, role-permission assignment, and membership-based authorization.
- Immediate scoped access revocation (`tenant_memberships.status`, `office_assignments.status`) evaluated live on every protected operation without touching `auth_sessions`.
- Tenant and office isolation enforcement across queries, mutations, and composite database FKs.
- Security audit trail (`audit_logs`) for sensitive operations.

**Off-limits for `authz` / `tenancy` / `platform-admin`:**
- Must **not** modify Better Auth internals, password hashing, cookie behavior, or reimplement session parsing.
- Must **not** reach into `modules/authn/infrastructure/*` (except `schema.ts` foreign keys in Drizzle schemas); consume `modules/authn/index.ts` only.

---

## 3. File Access & Coordination Matrix

| File / Path | Independent Owner | Coordination Rule |
| --- | --- | --- |
| `apps/api/src/modules/authn/**` (except `index.ts`, `domain/identity.ts`) | Asif | Asif owns independently; must stay isolated from `authz`/`tenancy`/`platform-admin`. |
| `apps/web/src/lib/auth-client.ts` | Asif | Asif owns client auth plugin wiring (`better-auth/react` only). |
| `apps/api/src/modules/authz/**` (except `index.ts`, `domain/policy.ts`) | Abdullah | Abdullah owns independently; must respect `domain`/`application` purity. |
| `apps/api/src/modules/tenancy/**`, `platform-admin/**` | Abdullah | Abdullah integrates `AuthorizationEngine` & composite FKs here. |
| `apps/api/src/modules/authn/domain/identity.ts` & `authn/index.ts` | **Shared Contract** | Both Asif & Abdullah must agree before changing `AuthenticatedIdentity` or port signatures. |
| `apps/api/src/modules/authz/domain/policy.ts` & `authz/index.ts` | **Shared Contract** | Abdullah leads; changes to `TenantScopeMembershipLookupPort` or middleware require review. |
| `packages/contracts/src/auth.ts` | **Shared Contract** | Asif proposes identity DTO changes; coordinate before breaking `apps/web` or backend consumers. |
| `packages/contracts/src/{tenancy,platform,common}.ts` | **Shared Contract** | Abdullah proposes tenancy/platform DTOs; coordinate with `apps/web` changes. |
| `apps/api/src/composition/container.ts`, `apps/api/src/app.ts` | **Shared Composition Root** | Coordinate PRs modifying dependency wiring, middlewares, or route mounting. |
| `apps/api/src/db/schema.ts` & `apps/api/drizzle/**` | **Shared Migrations** | Sequential forward-only SQL migrations only (see Section 5). |
| `apps/web/src/app/api/[...path]/route.ts` | **Shared Infra** | Coordinate cookie/header forwarding changes between Authn and API consumers. |

---

## 4. Authn ↔ Authz Integration Contract

1. **Identity Emission (`modules/authn` -> HTTP/Application boundary):**
   - `SessionResolverPort.resolveIdentity(headers)` / `requireIdentity(headers, { requireVerifiedEmail })` returns `AuthenticatedIdentity`:
     `{ userId, sessionId, email, name, emailVerified, mfaEnabled }`.
   - `AuthenticatedIdentity` must stay minimal—never add tenant lists, permissions, IP addresses, or User-Agent telemetry.
2. **Authorization Evaluation & Principal Separation (`modules/authz`):**
   - Route middleware or use cases pass `{ identity, scope, permission }` into `AuthorizationEnginePort.authorize(...)`.
   - Top-level principal separation (`admin` vs. `user`) is resolved via `AuthorizationEngine.resolveAccessContext()` (`GET /api/v1/access-context`) and enforced on `/api/v1/tenants*` via `createRequireCustomerUserMiddleware`.
   - For `tenant` and `office` scopes, `AuthorizationEngine` asserts customer principal type and queries live membership and role permissions via `TenantScopeMembershipLookupPort` and `AuthzRepositoryPort`.
   - Platform endpoints (`/api/v1/platform/status`, `GET/POST /api/v1/platform/admins`, and `/admin` panel UI) remain isolated from customer `/dashboard` access.
   - Protected routes use the returned `AuthorizationDecision` (`actorUserId`, `scope`, `verifiedPermission`, `roleKey`, `membershipId`).
3. **Account-Wide Session Revocation (`AuthUserLookupPort.revokeAllSessionsForUser`):**
   - Owned by `modules/authn` (`user-directory-repository.ts`) for **account-level** security events (password reset, suspension of the global user). Never call it for normal tenant or office membership removal.

---

## 5. Database Schema & Migration Coordination

- **Schema ownership:**
  - Asif (`apps/api/src/modules/authn/infrastructure/schema.ts`): `user`, `session`, `account`, `verification`, `two_factor`, `rate_limit`.
  - Abdullah (`apps/api/src/modules/authz/infrastructure/schema.ts` & `tenancy/infrastructure/schema.ts`): `roles`, `role_permissions`, `platform_role_assignments`, `platform_security_settings`, `audit_logs`, `tenants`, `offices`, `tenant_memberships`, `office_assignments`.
- **Exception for Drizzle FKs:** Cross-module imports between `infrastructure/` files are forbidden **except** `schema.ts` importing another module's `schema.ts` strictly for SQL foreign-key definitions (`references(() => authUsers.id)`).
- **Migration sequence rules:**
  1. Never run `drizzle-kit push`.
  2. Always generate reviewed SQL files via `pnpm db:generate` and apply via `pnpm db:migrate`.
  3. Never edit or rewrite an already-merged migration file in `apps/api/drizzle/`. If two branches generate migrations at the same sequence number (e.g. both create `0002_*.sql`), regenerate the second PR's migration cleanly (`0003_*.sql`) after rebasing onto `develop`.
  4. Composite tenant foreign keys must target explicit `unique(...)` constraints (not standalone `uniqueIndex`) so PostgreSQL applies `ADD CONSTRAINT ... FOREIGN KEY` cleanly.

---

## 6. Testing & Integration Responsibilities

| Test Suite | Command | Owner | Requirement |
| --- | --- | --- | --- |
| Authn integration tests | `pnpm test:integration` | Asif | Better Auth flows, scrypt, verification, password reset session revocation, CSRF origin checks, MFA against real PostgreSQL 18. |
| Authz unit & integration tests | `pnpm test:unit`, `pnpm test:integration` | Abdullah | `AuthorizationEngine` unit specs, Super Admin bootstrap lock/idempotency, MFA platform gate, scoped revocation without global logout, cross-tenant `403`, composite FK constraints. |
| Full E2E vertical slice | `pnpm test:e2e` | Coordinated | Changes touching `/api/[...path]`, login/register UX, or protected dashboard flows must keep Playwright E2E green against real Postgres + Mailpit. |
| Architecture boundaries | `pnpm lint:arch` | All developers | Must pass with zero cross-layer or cross-module violations before merging. |
