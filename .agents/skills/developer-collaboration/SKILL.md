---
name: developer-collaboration
description: >-
  Qrew subsystem ownership, Authn/Authz integration contracts, and migration coordination rules for parallel development across Authentication (Asif) and Authorization (Abdullah). Use when planning, reviewing, or coordinating changes touching identity, permissions, shared contracts, or schema migrations.
---

# Qrew Developer Ownership & Collaboration Guide

See [docs/developer-ownership.md](../../../docs/developer-ownership.md) for the authoritative subsystem map.

## Subsystem Split

- **Asif (Authentication Engineer):**
  - Owns `apps/api/src/modules/authn/` and frontend auth client `apps/web/src/lib/auth-client.ts` (plus login/register/verification UX coordination).
  - Owns Better Auth integration (`scrypt`, Google OAuth, email verification, password reset, MFA `twoFactor`, rate limiting, CSRF/origin rules, session resolution, and `authn` tests).
  - Must **never** implement tenant roles, office permissions, platform authorization policies, or enable Better Auth's `organization` or `admin` plugins.
- **Abdullah (Authorization Engineer):**
  - Owns `apps/api/src/modules/authz/` and authorization integration in `apps/api/src/modules/platform-admin/` and `apps/api/src/modules/tenancy/`.
  - Owns `PERMISSIONS`, `AuthorizationEngine`, `roles`, `role_permissions`, `platform_role_assignments`, tenant/office scope membership guards, immediate scoped revocation, and `authz`/`tenancy`/`platform-admin` tests.
  - Must **never** modify Better Auth configuration or reimplement credential/session verification.

## Integration Boundary (`authn` -> `authz`)

1. `modules/authn` exposes ONLY `AuthenticatedIdentity`, `SessionResolverPort`, `AuthUserLookupPort`, `createRequireAuthMiddleware`, and `createAuthRouter` via `apps/api/src/modules/authn/index.ts`.
2. `modules/authn` must never import `modules/authz`, `modules/tenancy`, or `modules/platform-admin` (enforced by `pnpm lint:arch`).
3. `modules/authz` consumes `AuthenticatedIdentity` (`{ userId, sessionId, email, name, emailVerified, mfaEnabled }`) and evaluates live database state via `AuthorizationEnginePort.authorize(...)`.

## Coordination Checkpoints

Coordinate before editing any shared boundary:
- `apps/api/src/modules/authn/index.ts` or `domain/identity.ts`
- `apps/api/src/modules/authz/index.ts` or `domain/policy.ts`
- `packages/contracts/` DTOs shared across Authn/Authz/Tenancy
- `apps/api/src/composition/container.ts`, `apps/api/src/app.ts`, or `apps/api/src/db/schema.ts`
- Any SQL migration generated into `apps/api/drizzle/` (sequentially numbered; never edit already-applied migrations).
