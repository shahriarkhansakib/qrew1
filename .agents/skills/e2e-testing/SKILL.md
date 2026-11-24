---
name: e2e-testing
description: >-
  Playwright end-to-end testing patterns for Qrew against Next.js, Hono API, real PostgreSQL 18, and Mailpit. Use when writing or running browser E2E suites covering auth, email verification, tenancy, and cross-tenant isolation.
---

# Qrew E2E Testing Standards

End-to-end tests verify complete vertical slices across the live system (`Next.js :3000 -> same-origin /api/* proxy -> Hono API :8787 -> PostgreSQL 18 + Mailpit`), never mocked UI stubs.

## Required Test Environment

- Real PostgreSQL 18 database with version-controlled migrations already applied (`pnpm db:migrate`).
- Real Mailpit SMTP + HTTP API (`MAILPIT_API_URL`, default `http://localhost:8029`) to inspect verification and password-reset emails.
- Both `apps/api` (`:8787`) and `apps/web` (`:3000`) running with `webServer` configuration in `apps/web/playwright.config.ts`.

## Core Patterns

1. **Unique Per-Run Test Identities:** Generate unique emails/slugs per test run (using `Date.now()` / UUID suffix) so retries or consecutive runs against persistent local databases never collide.
2. **Real Email Verification via Mailpit:**
   - Trigger registration or password reset in the browser UI.
   - Poll `${MAILPIT_API_URL}/api/v1/messages` until a message addressed to the test user arrives.
   - Fetch `/api/v1/message/${id}` and extract the signed URL targeting `http://localhost:3000/api/auth/...`.
   - Navigate to the extracted link in the same Playwright `Page` so HttpOnly session cookies are set in that browser context.
3. **Cross-Tenant Isolation Verification:**
   - Open a separate isolated `browser.newContext()` for User B.
   - Register/verify User B cleanly.
   - Attempt to read and mutate Tenant A's protected resources (`/api/v1/tenants/${tenantAId}/offices`) using User B's browser context (`page.request` / `context.request`) and assert HTTP `403` with `error.code === 'FORBIDDEN'`.
4. **Resilient Selectors & Timeouts:** Prefer accessible role/label/button/heading selectors (`getByRole`, `getByLabel`, `getByText`) or explicit `data-testid` attributes over brittle CSS classes, and never use hardcoded `waitForTimeout` sleeps where `expect(...).toBeVisible()` or Mailpit polling works.
