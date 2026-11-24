# ADR-0006: Strict `admin` vs. `user` Principal Separation & Dedicated `/admin` Panel

- **Date:** 2026-11-20
- **Status:** accepted
- **Deciders:** Project Owner

## Context

As Qrew adds a dedicated Platform Admin UI (`/admin`), platform governance must remain cleanly separated from B2B customer Tenant/Office workspaces (`/dashboard`). Mixing platform operator accounts with customer Tenant memberships introduces confused-deputy risks, ambiguous post-login routing, and potential tenant-ownership lockouts.

## Decision

1. **Two Top-Level Principal Types (`admin` vs. `user`):**
   - `admin` identifies an internal Qrew platform operator holding an active assignment in `platform_role_assignments`.
   - `user` identifies a B2B customer who participates in Tenants, Offices, and tenant/office roles (including customer-side `office_manager` / `office_admin` roles).
2. **Authn/Authz Boundary Preserved:** `modules/authn` remains role-agnostic; `AuthorizationEngine.resolveAccessContext(identity)` (`GET /api/v1/access-context`) derives `principalType` from `modules/authz`.
3. **Strict Promotion Guard & Mutual Access Exclusion:**
   - Users with existing `tenant_memberships` cannot be promoted to `admin` via CLI (`pnpm bootstrap:admin`) or `POST /api/v1/platform/admins` (`409 USER_HAS_TENANT_MEMBERSHIPS`, audited).
   - Active `admin` principals are blocked server-side (`403 PLATFORM_ADMIN_CUSTOMER_ACCESS_DENIED`) from `/api/v1/tenants*` and tenant/office scopes, and redirected from `/dashboard` to `/admin`. Customer `user` principals are redirected from `/admin` to `/dashboard` and denied `/api/v1/platform/*` (`403`).
4. **Platform Hierarchy Inside `admin`:** `AuthorizationEngine` manages platform-level role hierarchy (`super_admin` root, `platform_admin`, extensible for future roles such as `support_admin`) independently from customer Tenant/Office roles.
5. **Environment-Aware MFA Policy & Super Admin Toggle:**
   - Platform MFA enforcement defaults to **`true`** in `production` (and `test`) and **`false`** in `development`, stored/overridden in `platform_security_settings`.
   - In production, the initial `super_admin` must enroll & verify TOTP 2FA on first access before entering `/admin` or toggling `requirePlatformMfa` (`PATCH /api/v1/platform/security-settings`, audited).
   - Turning `requirePlatformMfa` ON requires the calling `super_admin` to already have personal TOTP enabled (`409 MFA_SETUP_REQUIRED_BEFORE_ENFORCEMENT`) to prevent self-lockout. `/login` handles Better Auth's `twoFactorRedirect` challenge whenever personal 2FA is active.

## Consequences

- **Positive:** Clean operator/customer isolation enforced across both PostgreSQL/Hono APIs and Next.js SSR routing without coupling Better Auth to authorization roles.
- **Negative / Trade-offs:** Platform staff must register dedicated operator accounts separate from any customer Tenant accounts.
- **Verification:** Verified via `AuthorizationEngine` unit tests, PostgreSQL integration tests covering `409 USER_HAS_TENANT_MEMBERSHIPS` and `403 PLATFORM_ADMIN_CUSTOMER_ACCESS_DENIED`, and Playwright E2E tests in `apps/web/e2e/admin-panel.spec.ts` and `apps/web/e2e/vertical-slice.spec.ts`.
