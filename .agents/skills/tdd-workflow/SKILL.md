---
name: tdd-workflow
description: >-
  Evidence-driven TDD workflow for Qrew using Vitest (unit + real-PostgreSQL integration) and Playwright (E2E). Use when implementing features, security boundaries, tenant isolation, or bug fixes.
---

# Qrew TDD Workflow

Develop features and security invariants test-first with real verification evidence. Never mock PostgreSQL in authentication, authorization, or tenant-isolation integration tests.

## Workflow Steps

1. **Define Guarantees:** List positive, negative, and cross-tenant/cross-office isolation scenarios before editing production code.
2. **Write Failing Test (RED):**
   - Unit tests (`*.test.ts`): Pure domain/policy logic with in-memory ports.
   - Integration tests (`apps/api/tests/integration/*.test.ts`): Real PostgreSQL + real Better Auth / Drizzle migrations.
   - E2E tests (`apps/web/e2e/*.spec.ts`): Full Playwright browser tests against Next.js + Hono + Mailpit.
3. **Verify RED State:** Run `pnpm test:unit` / `pnpm test:integration` (or `pnpm test:e2e`) and confirm the new test compiles and fails for the expected missing behavior.
4. **Implement Minimal Passing Code (GREEN):** Implement inside the proper module layer (`domain/`, `application/`, `infrastructure/`, `http/`).
5. **Verify GREEN State, Boundaries & Type Safety:** Run:
   - `pnpm test`
   - `pnpm typecheck`
   - `pnpm format:check`
   - `pnpm lint` (runs Biome lint + ESLint `lint:arch`)
6. **Refactor & Document Evidence:** Remove duplication while keeping tests green, and report exact commands run and observed pass/fail counts.

## Mandatory Security Scenarios

Every auth/authz or multi-tenant change must test:
- Unauthenticated request -> `401`
- Missing/invalid permission or unverified email -> `403`
- Cross-tenant ID manipulation -> `403` (and composite FK rejection at DB level where applicable)
- Cross-office ID manipulation within the same tenant -> `403`
- Audit log creation inside the same transaction for sensitive mutations
