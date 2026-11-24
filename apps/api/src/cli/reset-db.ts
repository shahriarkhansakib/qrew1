import path from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../db/client.js';
import { DrizzleAuthzRepository } from '../modules/authz/infrastructure/authz-repository.js';
import { loadEnv } from '../shared/env.js';

const ALLOWED_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

async function main(): Promise<void> {
  const env = loadEnv();

  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing pnpm db:reset when NODE_ENV=production');
  }

  const parsedUrl = new URL(env.DATABASE_URL);
  if (!ALLOWED_LOCAL_HOSTS.has(parsedUrl.hostname)) {
    throw new Error(
      `Refusing pnpm db:reset against non-local database host: ${parsedUrl.hostname}`,
    );
  }

  const { pool, db } = createDatabase(env.DATABASE_URL);

  try {
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
    await db.execute(sql`CREATE SCHEMA public`);

    const migrationsFolder = path.resolve(import.meta.dirname, '../../drizzle');
    await migrate(db, { migrationsFolder });

    const authzRepo = new DrizzleAuthzRepository(db);
    await authzRepo.ensureSystemRolesSeeded();

    console.log(
      JSON.stringify({
        ok: true,
        host: parsedUrl.hostname,
        database: parsedUrl.pathname.replace(/^\//, ''),
        migrationsApplied: true,
        systemRolesSeeded: true,
      }),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Database reset failed';
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
});
