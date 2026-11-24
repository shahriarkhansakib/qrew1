---
trigger: always_on
description: "Qrew modular monolith, Authn/Authz separation, and database migration boundaries"
---

# Qrew Architectural Boundaries

1. **Workspace & Package Boundaries**
   - `apps/web` is strictly the frontend presentation layer. Never import `@qrew/api`, `drizzle-orm`, `pg`, or server `better-auth` inside `apps/web`. Only `better-auth/react` and `better-auth/client/plugins` are permitted client auth imports.
   - `packages/contracts` depends exclusively on `zod` (and OpenAPI metadata helpers if needed). Never import Drizzle tables or backend internals into `packages/contracts`.
   - Keep `.tmp/` strictly out of all workspace configurations, ESLint runs, TypeScript builds, and test suites.

2. **Backend Module Layering (`apps/api/src/modules/<module>/`)**
   - `domain/`: Pure TypeScript types, policies, entities, and port interfaces. Zero imports from `hono`, `drizzle-orm`, `pg`, `better-auth`, or other modules' internals.
   - `application/`: Use cases and orchestration depending only on `domain/`, `shared/` ports, and explicit public interfaces (`modules/*/index.ts`). Zero HTTP or ORM driver imports.
   - `infrastructure/`: Drizzle schemas, repositories, and external adapters (Better Auth, SMTP).
   - `http/`: Thin Hono OpenAPI routes and HTTP middlewares translating HTTP requests/headers into application inputs and `AppError` into canonical HTTP responses.
   - Cross-module imports must target `src/modules/<other>/index.ts` exclusively.

3. **Authentication vs. Authorization Separation**
   - `modules/authn` owns Better Auth tables (`user`, `session`, `account`, `verification`, `two_factor`) and identity resolution (`SessionResolverPort`). It must never store or inspect tenant/office roles or permissions, and must never import `modules/authz`, `modules/tenancy`, or `modules/platform-admin`.
   - `modules/authz` owns `platform`, `tenant`, and `office` policy evaluation (`AuthorizationEnginePort`).
   - Membership revocation removes scope access immediately on the next authorization check without revoking the user's global Better Auth login session.

4. **Tooling & Boundary Enforcement**
   - Biome (`pnpm format:check`, `pnpm lint:biome`) is the primary formatter, import organizer, and general linter.
   - ESLint (`pnpm lint:arch`) is retained strictly for `no-restricted-imports` architectural boundary enforcement across workspaces, backend layers, and module barrels.

5. **Database Safety**
   - All schema changes must go through reviewed, version-controlled SQL migrations (`pnpm db:generate` + `pnpm db:migrate`). Never use `drizzle-kit push`.
   - Every tenant- and office-scoped repository method must accept an explicit tenant/office scope parameter.
   - Multi-step mutations and their `audit_logs` writes must share a single `UnitOfWork` transaction.
