# `@qrew/contracts`

Shared API boundary contracts between `apps/api` and `apps/web`.

## What Belongs Here

- Zod request and response schemas (`auth.ts`, `tenancy.ts`, `platform.ts`, `common.ts`)
- Inferred transport DTO types
- Shared API enums and status literals
- Canonical pagination contracts (`PaginationQuerySchema`, `PaginationMetaSchema`, `createPaginatedResponseSchema`)
- Canonical error envelope (`ApiErrorSchema`, `ApiErrorDetailSchema`, `ApiErrorResponse`)

## Strictly Forbidden

Enforced automatically by `pnpm lint:arch` (`no-restricted-imports`):

- Drizzle schemas or `drizzle-orm` / `pg` imports
- Database entities or database queries
- Domain business rules or authorization evaluation logic
- Hono handlers or middleware
- Better Auth server SDK internals
- Next.js or React components
