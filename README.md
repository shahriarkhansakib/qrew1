# Qrew

Customizable, multi-tenant B2B office-management SaaS built as a **modular monolith** in a **pnpm + Turborepo** monorepo.

## Workspace Layout

- `apps/web` — Next.js 16 presentation frontend + same-origin `/api/[...path]` proxy
- `apps/api` — Hono + Node.js backend (`authn`, `authz`, `tenancy`, `platform-admin`) with PostgreSQL 18 + Drizzle ORM
- `packages/contracts` — Pure Zod request/response schemas and transport DTOs ([README](packages/contracts/README.md))
- `packages/config` — Shared TypeScript presets and ESLint architectural boundary rules ([README](packages/config/README.md))

## Quickstart

```bash
cp .env.example .env
docker compose up -d --wait
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

## Common Commands

- `pnpm format:check` / `pnpm format` — Biome formatting check / write
- `pnpm lint` (`pnpm lint:biome` + `pnpm lint:arch`) — Biome linting & ESLint architectural boundaries
- `pnpm typecheck` — TypeScript check across all workspace packages
- `pnpm test:unit` / `pnpm test:integration` / `pnpm test` — Vitest unit & PostgreSQL 18 integration suites
- `pnpm build` — Dependency-ordered production builds
- `pnpm db:migrate` / `pnpm db:reset` — Apply Drizzle SQL migrations or reset local DB, re-run migrations, and seed system roles
- `pnpm test:e2e` — Playwright vertical slice E2E suite against real PostgreSQL & Mailpit

## Documentation

- [Developer Onboarding Guide](docs/developer-onboarding.md)
- [Developer Ownership & Collaboration (Authn / Authz)](docs/developer-ownership.md)
- [Domain Glossary](docs/domain-glossary.md)
- [Architecture Decision Records (ADRs)](docs/adr/README.md)
