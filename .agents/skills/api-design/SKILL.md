---
name: api-design
description: >-
  Qrew REST + OpenAPI design standards with @hono/zod-openapi and @qrew/contracts. Use when creating or modifying HTTP endpoints, request/response schemas, or error handling in apps/api.
---

# Qrew API Design & OpenAPI Standards

1. **Contract-First (`@qrew/contracts`):**
   - Request and response DTO schemas live in `packages/contracts` using pure Zod v4.
   - Never expose raw Drizzle table rows or internal fields (`password`, `twoFactorSecret`, etc.).
2. **Thin Hono Inbound Adapters (`modules/*/http/`):**
   - Use `createOpenApiRouter()` so Zod validation failures automatically throw `ValidationError` (`422`) and map through the centralized `app.onError()` handler.
   - Apply `createRequireAuthMiddleware` and `createAuthorizeMiddleware` before any protected route handler runs.
3. **Canonical HTTP Status Codes & Error Envelope:**
   - `200 OK` (reads), `201 Created` (resource creation), `401 Unauthorized` (unauthenticated), `403 Forbidden` (unauthorized / unverified / MFA required / cross-tenant), `404 Not Found`, `409 Conflict`, `422 Unprocessable Entity` (validation), `429 Too Many Requests`, `500 Internal Server Error` (generic message, zero leaked details).
   - Every error response matches `ApiErrorSchema`: `{ error: { code, message, details?, requestId } }`.
