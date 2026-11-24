---
name: security-review
description: >-
  Qrew authentication, authorization, session/cookie, and multi-tenant isolation security review checklist. Use when implementing or reviewing authn, authz, tenancy, or platform-admin endpoints.
---

# Qrew Security Review Checklist

1. **Authentication vs. Authorization Separation**
   - Better Auth (`modules/authn`) owns ONLY identity, credentials (`scrypt` default), OAuth, sessions, email verification, and MFA.
   - `AuthenticatedIdentity` contains ONLY `{ userId, sessionId, email, emailVerified, mfaEnabled }`—zero roles, zero tenant IDs, zero network headers.
   - Better Auth's `organization` and `admin` plugins must NEVER be enabled.

2. **Session, Cookie, and CSRF Integrity**
   - Cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production, host-only via same-origin `/api/*` proxy.
   - `session.cookieCache` stays disabled initially so password resets and account suspensions take effect immediately.
   - `trustedOrigins` is locked explicitly to `WEB_PUBLIC_ORIGIN` and `API_INTERNAL_URL` (no wildcard `*`).
   - Membership revocation removes access to that tenant/office on the next `AuthorizationEngine.authorize()` call without revoking the user's global Better Auth login session.

3. **Authorization & Isolation**
   - Every protected endpoint resolves identity via `SessionResolverPort` (`401` on missing/expired) and calls `AuthorizationEnginePort.authorize()` (`403` on missing permission/unverified/cross-tenant/cross-office).
   - Platform scope requires `emailVerified === true`, active `platform_role_assignments`, and `mfaEnabled === true` (`PLATFORM_MFA_REQUIRED`).
   - Initial Super Admin promotion runs strictly via transactional, advisory-locked CLI (`bootstrap:super-admin`), refuses if any other Super Admin exists, and records an immutable `audit_logs` entry.

4. **Anti-Enumeration & Secret Protection**
   - Password reset and duplicate verified-required sign-up flows must not leak account existence.
   - No `passwordHash`, `accessToken`, `refreshToken`, `twoFactorSecret`, `backupCodes`, or SQL stack traces in logs or HTTP responses.
