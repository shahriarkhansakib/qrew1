# Qrew Developer Onboarding Guide

Welcome to Qrew. Follow these exact steps to get the full modular monolith (PostgreSQL 18, Mailpit, Hono API, and Next.js frontend) running and verified locally.

> New team members should also read [Developer Ownership & Collaboration](developer-ownership.md), [Domain Glossary](domain-glossary.md), and the [ADRs](adr/README.md).

---

## 1. Required Local Software

- **Node.js:** `>= 22.14.0` (verified on `22.23.3`; see `.npmrc`)
- **pnpm:** `12.6.0` (pinned in root `package.json` via `"packageManager": "pnpm@12.6.0"`, recommended via Corepack or standalone installer)
- **Docker & Docker Compose:** Docker Engine / Docker Desktop capable of running PostgreSQL 18 and Mailpit
- **Git:** `2.x+` (on Windows, ensure **Git Bash** `sh.exe` is installed so Husky hooks execute cleanly)

Verify local prerequisites:

```bash
node -v
pnpm -v
docker --version
git --version
```

---

## 2. Repository Setup

Clone the repository and move into the root workspace:

```bash
git clone <repository-url> qrew
cd qrew
```

---

## 3. Environment Configuration

Copy the tracked environment template to `.env` (`.env` is gitignored):

```bash
cp .env.example .env
```

Review `.env` carefully:
- `DATABASE_URL=postgresql://qrew:qrew_dev_password@localhost:54329/qrew`
- `BETTER_AUTH_SECRET` **must be at least 32 characters** in all environments (replace the example value with a random 32+ character string before running tests or servers)
- `BETTER_AUTH_URL=http://localhost:3000/api/auth`
- `WEB_PUBLIC_ORIGIN=http://localhost:3000`
- `API_INTERNAL_URL=http://localhost:8787`
- `PORT=8787`
- `SMTP_HOST=localhost`, `SMTP_PORT=10259`, `MAILPIT_API_URL=http://localhost:8029`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: placeholder values work for local email/password development; provide real Google OAuth credentials when testing live Google login.

---

## 4. Start PostgreSQL 18 and Mailpit

Start the Docker Compose infrastructure containers and wait for health checks:

```bash
docker compose up -d --wait
docker compose ps
```

Configured host ports (`docker-compose.yml`):
- **PostgreSQL 18 (`qrew-postgres`):** `localhost:54329` (user `qrew`, password `qrew_dev_password`, db `qrew`)
- **Mailpit SMTP (`qrew-mailpit`):** `localhost:10259`
- **Mailpit Web UI & HTTP API:** `http://localhost:8029`

---

## 5. Install Dependencies

Install workspace dependencies strictly from `pnpm-lock.yaml`:

```bash
pnpm install --frozen-lockfile
```

This also runs `"prepare": "husky"`, configuring Git hooks in `.husky/`.

---

## 6. Apply Database Migrations

Apply version-controlled Drizzle SQL migrations in `apps/api/drizzle/` to PostgreSQL:

```bash
pnpm db:migrate
```

When adding or modifying schemas later, generate a reviewed forward-only SQL migration instead of pushing schema directly:

```bash
pnpm db:generate
pnpm db:migrate
```

*(Never use `drizzle-kit push`.)*

To wipe your **local** database (`localhost` / `127.0.0.1`, never production), re-apply all migrations, and re-seed system roles cleanly:

```bash
pnpm db:reset
```

---

## 7. Run Frontend and Backend

Start both `apps/api` (`http://localhost:8787`) and `apps/web` (`http://localhost:3000`) concurrently via Turborepo:

```bash
pnpm dev
```

Or launch them individually:

```bash
pnpm --filter @qrew/api dev
pnpm --filter @qrew/web dev
```

Key local URLs:
- Web app: `http://localhost:3000` (`/register`, `/login`, `/dashboard` for customers, `/admin` for platform admins)
- API health check: `http://localhost:8787/api/health`
- OpenAPI spec & Scalar docs: `http://localhost:8787/api/openapi.json` and `http://localhost:8787/api/docs`
- Mailpit inbox (to inspect verification/reset emails): `http://localhost:8029`

### Bootstrap an Initial Platform Admin (CLI)

Register a **dedicated** user account (with zero tenant memberships) and verify its email via Mailpit, then promote it to root platform admin (`super_admin` inside the `admin` principal hierarchy):

```bash
pnpm bootstrap:admin -- --email admin@example.com
```

Then visit `/admin` (or sign in on `/login`, which routes `admin` accounts directly to `/admin`). In `development` (`NODE_ENV=development`), platform-wide 2FA enforcement defaults to **OFF** for convenient local iteration; you can toggle **Platform 2FA Requirement** ON/OFF anytime from the **Platform Security & 2FA** card inside `/admin` (after setting up personal TOTP 2FA). In `production`, platform 2FA enforcement defaults to **ON**.

---

## 8. Running Tests

- **Unit tests (Turborepo-cached):**
  ```bash
  pnpm test:unit
  ```
- **PostgreSQL integration tests (uncached, requires healthy Docker Postgres + migrated schema):**
  ```bash
  pnpm test:integration
  ```
- **All backend unit + integration tests (uncached):**
  ```bash
  pnpm test
  ```
  > Note: integration tests truncate database tables between test cases via `apps/api/tests/helpers/test-harness.ts`. Do not run integration tests concurrently against the same local database.
- **Playwright E2E tests (uncached):**
  First install Chromium once per machine:
  ```bash
  pnpm --filter @qrew/web exec playwright install chromium
  ```
  Then execute the vertical slice suite:
  ```bash
  pnpm test:e2e
  ```

---

## 9. Formatting, Linting, Boundaries & Type Checking

- **Check formatting (Biome via Turborepo):**
  ```bash
  pnpm format:check
  ```
- **Apply formatting & safe fixes:**
  ```bash
  pnpm format
  pnpm check:fix
  ```
- **Run Biome linter:**
  ```bash
  pnpm lint:biome
  ```
- **Run ESLint architectural boundary rules (`no-restricted-imports`):**
  ```bash
  pnpm lint:arch
  ```
- **Run combined lint (`lint:biome` + `lint:arch` + root checks via Turborepo):**
  ```bash
  pnpm lint
  ```
- **Run TypeScript type checking across all packages:**
  ```bash
  pnpm typecheck
  ```
- **Build production bundles (`@qrew/contracts` -> `@qrew/api` -> `@qrew/web`):**
  ```bash
  pnpm build
  ```

---

## 10. Turborepo Commands & Caching Behavior

`turbo.json` orchestrates workspace tasks on top of `pnpm`:
- **Cached deterministic tasks:** `build`, `typecheck`, `lint`, `//#lint:arch`, `//#lint:root`, `format:check`, `//#format:check:root`, `test:unit`. Unchanged packages report `cache hit, replaying logs`.
- **Uncached stateful/interactive tasks (`"cache": false`):** `dev`, `format`, `test`, `test:integration`, `test:e2e`. These always run live so PostgreSQL state, Mailpit emails, and browser behavior are never masked by stale cache hits.
- Inspect the planned task graph without executing anything:
  ```bash
  pnpm exec turbo run build lint typecheck test:unit --dry
  ```

---

## 11. Branching, Git Hooks & Contribution Workflow

Qrew uses a two-branch integration workflow:
- **`develop` (Integration branch):** Checkout `develop` first (`git checkout develop && git pull`), create short-lived topic branches (`feat/authn-...`, `feat/authz-...`, `fix/...`), and open all feature/fix pull requests **into `develop`**.
- **`main` (Release branch):** Updated exclusively via pull requests from `develop` -> `main` by the project owner. Never open feature PRs directly against `main` or push directly to `develop` or `main`.

Husky Git hooks in `.husky/` provide fast local checks:
- **`.husky/pre-commit`:** Runs `pnpm exec lint-staged` (`biome check --write` on staged `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.json`, `.jsonc`, `.css` files).
- **`.husky/pre-push`:** Runs `pnpm typecheck`, `pnpm lint:arch`, and `pnpm test:unit` before pushing.

> **Important:** Git hooks improve local feedback speed, **not** authoritative security/quality assurance—developers can bypass hooks with `--no-verify`. [GitHub Actions CI](../.github/workflows/ci.yml) is the authoritative gate running formatting, Biome lint, ESLint architecture boundaries, typecheck, unit tests, DB migrations, PostgreSQL integration tests, builds, and Playwright E2E on every push/PR.

---

## 12. Troubleshooting

- **Windows Husky hooks do not execute or complain about `sh`:** Ensure Git for Windows is installed (`C:\Program Files\Git\bin\sh.exe` is on `PATH` inside Git Bash / VS Code terminal / Windows Terminal) and verify `git config --get core.hooksPath` outputs `.husky/_`.
- **`Invalid backend environment configuration: BETTER_AUTH_SECRET ...`:** Ensure `.env` exists at the repository root and `BETTER_AUTH_SECRET` is at least 32 characters long.
- **PostgreSQL or Mailpit port conflicts:** Docker Compose binds PostgreSQL to host `54329`, Mailpit SMTP to `10259`, and Mailpit UI to `8029`. Check `docker compose ps` if connections to `54329` or `8029` fail.
- **Windows Hyper-V / WSL2 TCP port exclusion (`listen EACCES 0.0.0.0:8787`):** Windows sometimes dynamically reserves port ranges (check with `netsh int ipv4 show excludedportrange protocol=tcp`). If `8787` falls inside an excluded range, set an unexcluded port in root `.env` (or your shell), for example `PORT=4000` and `API_INTERNAL_URL=http://localhost:4000` — both `apps/api` and `apps/web` load root `.env` automatically.
- **Playwright fails with missing Chromium executable:** Run `pnpm --filter @qrew/web exec playwright install chromium` (on Linux/CI include `--with-deps`). Ensure ports `3000` and `8787` are either free or running healthy Qrew servers (`reuseExistingServer` reuses local dev servers when not in CI).
- **ESLint `lint:arch` fails with `Cross-module imports must target the module public index.ts barrel`:** Import cross-module symbols from `../../modules/<name>/index.js` rather than reaching into another module's `domain/`, `application/`, `infrastructure/`, or `http/` subdirectories.
- **Turborepo stale build output suspicion:** Re-run with `--force` (for example `pnpm exec turbo run build --force`) to bypass local cache cleanly.
