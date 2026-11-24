import tseslint from 'typescript-eslint';

const DOMAIN_APPLICATION_PATHS = [
  {
    name: 'hono',
    message: 'Domain and application layers must remain independent of Hono and HTTP.',
  },
  {
    name: 'drizzle-orm',
    message: 'Domain and application layers must depend on repository ports, not Drizzle ORM.',
  },
  {
    name: 'pg',
    message: 'Domain and application layers must not import pg directly.',
  },
  {
    name: 'better-auth',
    message: 'Domain and application layers must depend on ports, not the Better Auth SDK.',
  },
];

const FRAMEWORK_SUBPATH_PATTERNS = [
  {
    group: ['hono/*', '@hono/*', 'drizzle-orm/*', 'better-auth/*'],
    message: 'Framework/ORM/Auth SDK imports belong exclusively in http/ or infrastructure/.',
  },
];

const CROSS_MODULE_INTERNAL_PATTERNS = [
  {
    group: [
      '../../*/domain/*',
      '../../*/application/*',
      '../../*/infrastructure/*',
      '../../*/http/*',
      '../../../*/domain/*',
      '../../../*/application/*',
      '../../../*/infrastructure/*',
      '../../../*/http/*',
      '**/modules/*/domain/*',
      '**/modules/*/application/*',
      '**/modules/*/infrastructure/*',
      '**/modules/*/http/*',
    ],
    message: 'Cross-module imports must target the module public index.ts barrel.',
  },
];

const AUTHN_ISOLATION_PATTERNS = [
  {
    group: [
      '../../authz',
      '../../authz/*',
      '../../../modules/authz',
      '../../../modules/authz/*',
      '**/modules/authz',
      '**/modules/authz/*',
      '../../tenancy',
      '../../tenancy/*',
      '../../../modules/tenancy',
      '../../../modules/tenancy/*',
      '**/modules/tenancy',
      '**/modules/tenancy/*',
      '../../platform-admin',
      '../../platform-admin/*',
      '../../../modules/platform-admin',
      '../../../modules/platform-admin/*',
      '**/modules/platform-admin',
      '**/modules/platform-admin/*',
    ],
    message:
      'modules/authn owns authentication only and must never import authz, tenancy, or platform-admin.',
  },
];

// ESLint is retained solely for architectural import boundaries that Biome cannot express.
// General linting, formatting, and import organization live in root biome.json.
export const baseEslintConfig = [
  {
    ignores: [
      '**/.tmp/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/dist/**',
      '**/out/**',
      '**/drizzle/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.d.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
  },
  // Boundary Rule 1: Frontend (apps/web) must never import backend, ORM, DB drivers, or server auth
  {
    files: ['apps/web/**/*.{ts,tsx,js,jsx,mjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@qrew/api',
              message:
                'apps/web cannot import backend code directly; use HTTP via @qrew/contracts.',
            },
            {
              name: 'drizzle-orm',
              message: 'apps/web cannot access the database directly.',
            },
            {
              name: 'pg',
              message: 'apps/web cannot access PostgreSQL directly.',
            },
            {
              name: 'better-auth',
              message:
                'apps/web may only import client helpers from better-auth/react or better-auth/client/plugins.',
            },
          ],
          patterns: [
            {
              group: [
                '../../api/*',
                '../../../apps/api/*',
                'drizzle-orm/*',
                'better-auth/adapters/*',
              ],
              message: 'apps/web cannot import backend, ORM, or server auth internals.',
            },
          ],
        },
      ],
    },
  },
  // Boundary Rule 2: Shared contracts (packages/contracts) must remain pure Zod transport schemas
  {
    files: ['packages/contracts/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'hono',
                'hono/*',
                '@hono/*',
                'drizzle-orm',
                'drizzle-orm/*',
                'pg',
                'better-auth',
                'better-auth/*',
                'next',
                'next/*',
                'react',
                'react-dom',
              ],
              message:
                'packages/contracts must remain framework- and database-agnostic (Zod only).',
            },
          ],
        },
      ],
    },
  },
  // Boundary Rule 3a: Non-authn domain and application layers
  {
    files: ['apps/api/src/modules/*/domain/**/*.ts', 'apps/api/src/modules/*/application/**/*.ts'],
    ignores: ['apps/api/src/modules/authn/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: DOMAIN_APPLICATION_PATHS,
          patterns: [...FRAMEWORK_SUBPATH_PATTERNS, ...CROSS_MODULE_INTERNAL_PATTERNS],
        },
      ],
    },
  },
  // Boundary Rule 3b + 5: Authn domain and application layers (also isolated from authz/tenancy/platform-admin)
  {
    files: [
      'apps/api/src/modules/authn/domain/**/*.ts',
      'apps/api/src/modules/authn/application/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: DOMAIN_APPLICATION_PATHS,
          patterns: [
            ...FRAMEWORK_SUBPATH_PATTERNS,
            ...CROSS_MODULE_INTERNAL_PATTERNS,
            ...AUTHN_ISOLATION_PATTERNS,
          ],
        },
      ],
    },
  },
  // Boundary Rule 4a: Non-authn http and infrastructure must import other modules via index.ts barrel
  // (Exception: Drizzle schema.ts may reference another schema.ts solely for SQL foreign-key DDL)
  {
    files: ['apps/api/src/modules/*/http/**/*.ts', 'apps/api/src/modules/*/infrastructure/**/*.ts'],
    ignores: ['apps/api/src/modules/authn/**', 'apps/api/src/modules/*/infrastructure/schema.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: CROSS_MODULE_INTERNAL_PATTERNS,
        },
      ],
    },
  },
  // Boundary Rule 4b + 5: Authn http and infrastructure must use barrels and never depend on authz/tenancy/platform-admin
  {
    files: [
      'apps/api/src/modules/authn/http/**/*.ts',
      'apps/api/src/modules/authn/infrastructure/**/*.ts',
    ],
    ignores: ['apps/api/src/modules/authn/infrastructure/schema.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [...CROSS_MODULE_INTERNAL_PATTERNS, ...AUTHN_ISOLATION_PATTERNS],
        },
      ],
    },
  },
  // Boundary Rule 5: Authn barrel and schema remain independent of authz/tenancy/platform-admin
  {
    files: [
      'apps/api/src/modules/authn/index.ts',
      'apps/api/src/modules/authn/infrastructure/schema.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: AUTHN_ISOLATION_PATTERNS,
        },
      ],
    },
  },
];
