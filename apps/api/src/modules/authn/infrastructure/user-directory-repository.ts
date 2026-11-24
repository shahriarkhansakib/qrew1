import { eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../../../db/client.js';
import {
  type AuthUserLookupPort,
  type AuthUserSummary,
  asUserId,
  type UserId,
} from '../domain/identity.js';
import { authSessions, authUsers } from './schema.js';

export class DrizzleAuthUserDirectory implements AuthUserLookupPort {
  constructor(private readonly db: AppDatabase) {}

  async findByEmail(email: string): Promise<AuthUserSummary | null> {
    const normalized = email.trim().toLowerCase();
    const rows = await this.db
      .select({
        id: authUsers.id,
        email: authUsers.email,
        name: authUsers.name,
        emailVerified: authUsers.emailVerified,
        twoFactorEnabled: authUsers.twoFactorEnabled,
      })
      .from(authUsers)
      .where(eq(authUsers.email, normalized))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: asUserId(row.id),
      email: row.email,
      name: row.name,
      emailVerified: row.emailVerified,
      mfaEnabled: row.twoFactorEnabled,
    };
  }

  async findById(userId: UserId): Promise<AuthUserSummary | null> {
    const rows = await this.db
      .select({
        id: authUsers.id,
        email: authUsers.email,
        name: authUsers.name,
        emailVerified: authUsers.emailVerified,
        twoFactorEnabled: authUsers.twoFactorEnabled,
      })
      .from(authUsers)
      .where(eq(authUsers.id, userId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: asUserId(row.id),
      email: row.email,
      name: row.name,
      emailVerified: row.emailVerified,
      mfaEnabled: row.twoFactorEnabled,
    };
  }

  async findByIds(userIds: readonly UserId[]): Promise<ReadonlyMap<UserId, AuthUserSummary>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .select({
        id: authUsers.id,
        email: authUsers.email,
        name: authUsers.name,
        emailVerified: authUsers.emailVerified,
        twoFactorEnabled: authUsers.twoFactorEnabled,
      })
      .from(authUsers)
      .where(inArray(authUsers.id, [...userIds]));

    const map = new Map<UserId, AuthUserSummary>();
    for (const row of rows) {
      const id = asUserId(row.id);
      map.set(id, {
        id,
        email: row.email,
        name: row.name,
        emailVerified: row.emailVerified,
        mfaEnabled: row.twoFactorEnabled,
      });
    }
    return map;
  }

  async revokeAllSessionsForUser(userId: UserId): Promise<void> {
    await this.db.delete(authSessions).where(eq(authSessions.userId, userId));
  }
}
