# `@qrew/config`

Shared workspace development and architectural-governance presets.

## What Belongs Here

- TypeScript configuration presets (`typescript/base.json`, `typescript/node.json`, `typescript/nextjs.json`)
- Specialized ESLint flat configuration (`eslint/index.mjs`) enforcing architectural import boundaries across apps, packages, and backend module layers (`pnpm lint:arch`)

## What Does NOT Belong Here

- Duplicate Prettier or general-purpose Biome configurations — formatting, import sorting, and general linting live in the single root [biome.json](../../biome.json).
- Application runtime dependencies, business logic, or shared DTOs (those live in `@qrew/contracts`).
