# ADR-0004: Same-Origin `/api/*` Proxy and Read-Only RSC Session Forwarding

- **Date:** 2026-11-17
- **Status:** accepted
- **Deciders:** Project Owner

## Context

`apps/web` (Next.js) and `apps/api` (Hono) run as separate applications on separate ports/origins (`localhost:3000` and `localhost:8787` in local development). Using a naive `next.config.ts` rewrite or direct cross-origin requests introduces multiple failure modes for Better Auth: dropped/folded `Set-Cookie` headers during OAuth callbacks, `SameSite` third-party cookie rejection (especially Safari ITP), `Origin`/CSRF mismatches, and lost cookie propagation during Next.js Server Component (RSC) fetches.

## Decision

1. **Explicit Next.js Route Handler Proxy (`/api/[...path]/route.ts`):** All browser traffic to `/api/*` hits Next.js on the public origin and is forwarded server-side to `API_INTERNAL_URL` (`apps/api`). The proxy preserves `Cookie`, `Origin`, `Referer`, `User-Agent`, and forwarding headers, and forwards every `Set-Cookie` header individually using `response.headers.getSetCookie()`.
2. **Public Origin `baseURL`:** Better Auth configures `baseURL` to `${WEB_PUBLIC_ORIGIN}/api/auth` and `trustedOrigins` to include `WEB_PUBLIC_ORIGIN`, ensuring Google OAuth redirects and CSRF origin validation align with the browser's URL bar.
3. **Read-Only RSC Session Fetching:** Next.js Server Components forward the browser `Cookie` header to `API_INTERNAL_URL` with `x-qrew-rsc-prefetch: 1`. Session-mutating endpoints (login, registration, logout, OAuth) are always browser-initiated through `/api/auth/*`.

## Consequences

- **Positive:** First-party host-only `HttpOnly` `SameSite=Lax` cookies; zero CORS preflight overhead for browser clients; deterministic Google OAuth callbacks; zero dropped `Set-Cookie` headers.
- **Negative / Trade-offs:** Adds one intra-host hop in local/proxied environments (negligible latency, easily replaced by an ingress/CDN path router in production without changing `apps/web` or `apps/api` code).
- **Verification:** Playwright browser E2E test verifies cookie delivery, session persistence across SSR navigation, and protected API rejection after sign-out.
