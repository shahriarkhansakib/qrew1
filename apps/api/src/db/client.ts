import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { AuditLogEntry, AuditLogPort } from '../shared/audit.js';
import { generateId } from '../shared/id.js';
import type { TransactionContext, UnitOfWorkPort } from '../shared/unit-of-work.js';
import * as schema from './schema.js';

export type AppDatabase = NodePgDatabase<typeof schema>;
export type DbExecutor = AppDatabase | Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

export function createDatabase(databaseUrl: string): { pool: Pool; db: AppDatabase } {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  const db = drizzle(pool, { schema });
  return { pool, db };
}

export function resolveDbExecutor(db: AppDatabase, tx?: TransactionContext): DbExecutor {
  if (!tx) {
    return db;
  }
  return tx as unknown as DbExecutor;
}

export class DrizzleUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly db: AppDatabase) {}

  async execute<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => fn(tx as unknown as TransactionContext));
  }

  async executeWithAdvisoryLock<T>(
    lockKey: number,
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
      return fn(tx as unknown as TransactionContext);
    });
  }
}

export class DrizzleAuditRepository implements AuditLogPort {
  constructor(private readonly db: AppDatabase) {}

  async record(entry: AuditLogEntry, tx?: TransactionContext): Promise<void> {
    const executor = resolveDbExecutor(this.db, tx);
    await executor.insert(schema.auditLogs).values({
      id: generateId(),
      actorUserId: entry.actorUserId,
      tenantId: entry.tenantId ?? null,
      officeId: entry.officeId ?? null,
      scopeType: entry.scopeType,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata ?? {},
    });
  }
}
