# ADR-0005: Biome, Turborepo, Lean Architecture-Only ESLint, and Husky Hooks

- **Date:** 2026-11-19
- **Status:** accepted
- **Deciders:** Project Owner / Engineering Lead

## Context

With Qrew's initial modular monolith foundation and first vertical slice complete, two incoming engineers (Authentication and Authorization) are starting parallel development. Earlier ADR-0001 deferred Turborepo before the vertical slice existed, and initial setup combined Prettier and full ESLint (`@eslint/js`, `typescript-eslint` recommended rules, `eslint-config-next`) alongside architectural boundary rules.

## Decision

1. **Adopt Biome (`biome.json`) as the single primary formatter, import organizer, and linter** across TypeScript, JavaScript, React, Next.js, JSON, and CSS. Remove Prettier (`.prettierrc`) and redundant ESLint style/lint rules.
2. **Retain ESLint strictly for architecture boundaries (`pnpm lint:arch`)** via `packages/config/eslint/index.mjs`, keeping `no-restricted-imports` enforcement for:
   - `apps/web` vs backend/ORM/server-auth separation
   - `packages/contracts` pure-Zod purity
   - `domain/` and `application/` purity
   - cross-module barrel-only imports (`index.ts`)
   - `modules/authn` isolation from `authz`, `tenancy`, and `platform-admin`
3. **Adopt Turborepo (`turbo.json`) on top of pnpm workspaces** to orchestrate dependency-ordered builds and safely cache deterministic tasks (`build`, `typecheck`, `lint`, `format:check`, `test:unit`) while explicitly keeping `dev`, `format`, `test`, `test:integration`, and `test:e2e` uncached (`"cache": false`) so stateful PostgreSQL and Playwright checks never return stale results. No remote caching infrastructure is added.
4. **Add Husky + lint-staged (`.husky/pre-commit`, `.husky/pre-push`)** for fast local feedback across Windows/Git Bash and Unix, while keeping GitHub Actions (`.github/workflows/ci.yml`) as the authoritative CI enforcement gate.

## Consequences

- **Positive:** Single fast formatting/linting pass via Biome (~100ms), zero overlapping Prettier/ESLint diagnostics, preserved mechanical module boundaries, cached unit/typecheck/build pipelines without compromising stateful DB integration/E2E tests.
- **Negative / Trade-offs:** Developers run `pnpm lint` (or both `pnpm lint:biome` and `pnpm lint:arch`) to ensure both Biome diagnostics and ESLint boundary checks are satisfied; CI enforces both explicitly.
- **Verification:** Validated via `pnpm format:check`, `pnpm lint:biome`, `pnpm lint:arch`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e`, and Husky hook execution in Git Bash.
