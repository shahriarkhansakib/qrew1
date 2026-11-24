import type { TransactionContext } from './unit-of-work.js';

export interface AuditLogEntry {
  readonly actorUserId: string | null;
  readonly tenantId?: string | null;
  readonly officeId?: string | null;
  readonly scopeType: 'authn' | 'platform' | 'tenant' | 'office';
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AuditLogPort {
  record(entry: AuditLogEntry, tx?: TransactionContext): Promise<void>;
}
