---
name: monorepo-tooling
description: >-
  Qrew pnpm workspace, Turborepo task orchestration, Biome formatting/linting, ESLint architecture boundaries, and Husky/lint-staged Git hooks guide. Use when running monorepo checks, modifying package scripts, or configuring CI workflows.
---

# Qrew Monorepo Tooling & Orchestration

Qrew uses **pnpm workspaces** for dependency management, **Turborepo** for cached task orchestration, **Biome** as the primary formatter and linter, **ESLint** exclusively for architectural boundary enforcement, and **Husky + lint-staged** for fast local Git hooks.

## Tool Roles

1. **pnpm Workspaces (`pnpm-workspace.yaml`):**
   - Owns workspace linking (`apps/*`, `packages/*`), dependency installation (`pnpm install --frozen-lockfile`), and Drizzle migrations.
2. **Turborepo (`turbo.json`):**
   - Orchestrates `build`, `dev`, `typecheck`, `lint`, `format:check`, `test`, `test:unit`, `test:integration`, and `test:e2e`.
   - **Cached tasks:** Pure deterministic tasks (`build`, `typecheck`, `lint`, `//#lint:arch`, `//#lint:root`, `format:check`, `//#format:check:root`, `test:unit`).
   - **Never cached:** Stateful, interactive, or side-effecting tasks (`dev`, `format`, `test`, `test:integration`, `test:e2e`).
3. **Biome (`biome.json`):**
   - Primary formatter (2 spaces, 100-char line width, single quotes, trailing commas, LF line endings), import organizer, and TS/JS/React/Next linter.
   - Replaces Prettier and general ESLint rules completely.
4. **ESLint (`eslint.config.mjs` + `packages/config/eslint/index.mjs`):**
   - Retained **solely** for custom `no-restricted-imports` architecture boundaries that Biome cannot express (`pnpm lint:arch`).
5. **Husky + lint-staged (`.husky/`):**
   - `pre-commit`: runs `pnpm exec lint-staged` (`biome check --write` on staged files).
   - `pre-push`: runs `pnpm typecheck`, `pnpm lint:arch`, and `pnpm test:unit`.
   - GitHub Actions (`.github/workflows/ci.yml`) remains the authoritative enforcement gate.

## Standard Root Commands

- `pnpm dev` — start API + Web dev servers via Turborepo
- `pnpm format:check` / `pnpm format` — check or fix formatting via Biome
- `pnpm lint:biome` / `pnpm lint:arch` / `pnpm lint` — Biome lint, ESLint architecture boundaries, or full orchestrated lint
- `pnpm typecheck` — workspace-wide `tsc --noEmit`
- `pnpm test:unit` / `pnpm test:integration` / `pnpm test` — unit (cached), PostgreSQL integration (uncached), or full backend tests
- `pnpm build` — dependency-ordered production builds (`@qrew/api` and `@qrew/web`)
- `pnpm test:e2e` — Playwright full vertical slice tests (uncached)
