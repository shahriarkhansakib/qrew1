# ADR-0001: pnpm Workspace Monorepo & Modular Monolith Boundaries

- **Date:** 2026-11-17
- **Status:** accepted
- **Deciders:** Project Owner

## Context

Qrew is a multi-tenant B2B SaaS with strict backend ownership of business logic, authentication, authorization, and data access, paired with a separate Next.js presentation frontend (`apps/web`) and Hono backend (`apps/api`).

## Decision

We organize Qrew as a `pnpm` workspace monorepo containing `apps/web`, `apps/api`, `packages/contracts`, and `packages/config`, without introducing Turborepo, Redis, BullMQ, or an empty `apps/worker` prematurely.

Inside `apps/api`, each domain module (`authn`, `authz`, `tenancy`, `platform-admin`) uses explicit `domain/`, `application/`, `infrastructure/`, and `http/` layers with a single public `index.ts` barrel. Cross-layer and cross-package violations are rejected mechanically via ESLint boundary rules.

## Alternatives Considered

### NestJS Backend + Turborepo + Separate Worker App
- **Pros:** Out-of-the-box DI/modules and cached task pipelines for large teams.
- **Cons:** Decorator/reflection friction with Zod v4 and Drizzle, slower test startup, and premature build/queue orchestration overhead before the first vertical slice exists.
- **Why rejected:** Violates Qrew's modular-monolith simplicity invariant and adds speculative infrastructure.

## Consequences

- **Positive:** Fast Vitest integration startup, single shared Zod contract package (`@qrew/contracts`) without build-step lag, clear inward dependency direction (`http -> application -> domain <- infrastructure`).
- **Negative / Trade-offs:** Hono does not enforce module boundaries natively; discipline relies on explicit composition roots and ESLint checks in CI.
- **Verification:** `pnpm lint` runs boundary rules on every PR; `pnpm typecheck` verifies contract compatibility across `apps/web` and `apps/api`.
