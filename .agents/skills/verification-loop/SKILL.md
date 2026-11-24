---
name: verification-loop
description: >-
  Run Qrew's multi-stage verification checklist (Biome formatting and linting, ESLint architecture boundaries, typecheck, unit tests, PostgreSQL migrations & integration tests, Turborepo builds, E2E tests, and git status check) before reporting work complete.
---

# Qrew Verification Loop

Run all applicable gates in order and report only directly observed command results.

## Verification Phases

1. **Formatting Check (Biome):**
   `pnpm format:check`
2. **Lint & Architecture Boundaries (Biome + ESLint via Turborepo):**
   - `pnpm lint:biome` (Biome linting)
   - `pnpm lint:arch` (ESLint architectural boundaries only)
   - Or combined via Turborepo: `pnpm lint`
3. **Type Check (Turborepo):**
   `pnpm typecheck`
4. **Unit Tests (Cached via Turborepo):**
   `pnpm test:unit`
5. **Database Migrations & PostgreSQL Integration Tests (Uncached):**
   - Ensure containers are running: `docker compose ps`
   - Apply migrations: `pnpm db:migrate`
   - Run suite: `pnpm test:integration` (or `pnpm test` for unit + integration)
6. **Production Build Verification (Turborepo):**
   `pnpm build`
7. **E2E Verification (Uncached Playwright):**
   `pnpm test:e2e`
8. **Hygiene & Repository Check:**
   - Verify no secrets, `.env` files, or `.tmp/` files are staged or modified unexpectedly.
   - Run `git status --short` and verify `AGENTS.md` was not overwritten unexpectedly.

## Reporting Standard

Never claim `PASS` for a gate that was not executed after the final edit. Record exact commands, exit codes, and test counts.
