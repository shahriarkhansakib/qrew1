# ADR-0002: Separation of Better Auth (Authn) and Qrew Authorization Engine (Authz)

- **Date:** 2026-11-17
- **Status:** accepted
- **Deciders:** Project Owner

## Context

A single User in Qrew may belong to multiple Tenants and Offices simultaneously, or hold Platform Administrator privileges (requiring MFA). Coupling tenant/office membership and RBAC into the authentication provider causes rigid permission models and dangerous session/tenant conflation.

## Decision

1. **`modules/authn` (Better Auth):** Owns ONLY identity authentication (`user`, `session`, `account`, `verification`, `two_factor`), password hashing (default `scrypt`), Google OAuth, email verification, password reset, MFA enrollment/verification, and global session revocation for account-wide security events.
2. **Better Auth's `organization` and `admin` plugins are explicitly prohibited** so Better Auth never creates competing tenant, membership, or role tables.
3. **`modules/authz` & `modules/tenancy` (Qrew-Owned):** Own `tenants`, `offices`, `tenant_memberships`, `office_assignments`, `roles`, `role_permissions`, `platform_role_assignments`, and `audit_logs`.
4. **`SessionResolverPort` -> `AuthorizationEnginePort`:** Authentication emits a minimal `AuthenticatedIdentity` (`userId`, `sessionId`, `email`, `emailVerified`, `mfaEnabled`) containing zero role claims. `AuthorizationEngine.authorize()` evaluates live DB state for `platform`, `tenant`, or `office` scopes on protected operations.
5. **Scoped Revocation:** Revoking a User's Tenant/Office membership blocks access to that scope immediately without destroying their global login session for other Tenants.
6. **Platform Bootstrap:** Initial Super Admin promotion runs strictly via a transactional, advisory-locked, audited server-side CLI command on an existing verified user and refuses if a Super Admin already exists. Platform operations enforce `mfaEnabled === true`.

## Consequences

- **Positive:** Clean domain ownership across parallel developers; zero stale permission caches; live multi-tenant revocation without logging users out of unrelated workspaces.
- **Negative / Trade-offs:** Authorization checks query PostgreSQL per protected request until profiling justifies an explicitly invalidated cache.
- **Verification:** Real-PostgreSQL integration tests covering duplicate-email anti-enumeration, MFA enforcement on platform scope, membership revocation without global logout, and Super Admin bootstrap idempotency/refusal.
