---
name: error-handling
description: >-
  Typed AppError hierarchy, centralized Hono error mapping, and Pino log redaction rules for Qrew. Use when implementing domain/application errors, HTTP error handlers, or structured logging.
---

# Qrew Error Handling & Logging

1. **Domain / Application Errors (`AppError`):**
   - Throw typed subclasses (`ValidationError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `RateLimitError`) from `application/` and `domain/` layers—never `HTTPException` from `hono`.
2. **Centralized HTTP Error Mapping:**
   - Hono's global `app.onError()` translates `AppError`, Zod validation failures, and unexpected exceptions into the canonical `@qrew/contracts` `ApiErrorSchema` envelope:
     `{ error: { code, message, details?, requestId } }`.
   - Never expose PostgreSQL error details, constraint names, or stack traces in `500` HTTP responses.
3. **Zero Silent Swallowing:**
   - Every `catch` block must translate, re-throw, or log with structured context (`requestId`, operation, error).
4. **Secret & PII Redaction:**
   - Pino must redact `cookie`, `authorization`, `password`, `token`, `secret`, `accessToken`, `refreshToken`, and `twoFactorSecret`. Never log raw credentials or session tokens.
