import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authUsers } from '../../src/modules/authn/infrastructure/schema.js';
import { isUuidV7 } from '../../src/shared/id.js';
import { createTestHarness, extractFirstUrl, type TestHarness } from '../helpers/test-harness.js';

describe('PostgreSQL 18 + Drizzle + Better Auth UUIDv7 compatibility', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  beforeEach(async () => {
    await harness.resetDatabase();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('stores Better Auth user, account, verification, and session PKs as native PostgreSQL uuid v7', async () => {
    const signUpRes = await harness.app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
      },
      body: JSON.stringify({
        name: 'UUID Test User',
        email: 'uuid7@qrew.test',
        password: 'StrongPassword#2026!',
      }),
    });
    expect(signUpRes.status).toBe(200);

    const verificationEmail = harness.emailSpy.sent[0];
    expect(verificationEmail).toBeDefined();
    const verifyUrl = new URL(extractFirstUrl(verificationEmail!.text));
    const verifyRes = await harness.app.request(`${verifyUrl.pathname}${verifyUrl.search}`, {
      method: 'GET',
      headers: { origin: harness.env.WEB_PUBLIC_ORIGIN },
    });
    expect([200, 302]).toContain(verifyRes.status);

    const columnTypeRows = await harness.container.db.execute(sql`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'id'
        AND table_name IN ('user', 'account', 'session', 'verification', 'tenants', 'offices')
      ORDER BY table_name;
    `);
    for (const row of columnTypeRows.rows as Array<{ table_name: string; data_type: string }>) {
      expect(row.data_type).toBe('uuid');
    }

    const versionRows = await harness.container.db.execute(sql`
      SELECT
        u.id::text AS user_id,
        uuid_extract_version(u.id) AS user_ver,
        a.id::text AS account_id,
        uuid_extract_version(a.id) AS account_ver,
        s.id::text AS session_id,
        uuid_extract_version(s.id) AS session_ver
      FROM "user" u
      JOIN "account" a ON a.user_id = u.id
      JOIN "session" s ON s.user_id = u.id
      LIMIT 1;
    `);
    const record = versionRows.rows[0] as
      | {
          user_id: string;
          user_ver: number;
          account_id: string;
          account_ver: number;
          session_id: string;
          session_ver: number;
        }
      | undefined;

    expect(record).toBeDefined();
    expect(isUuidV7(record!.user_id)).toBe(true);
    expect(isUuidV7(record!.account_id)).toBe(true);
    expect(isUuidV7(record!.session_id)).toBe(true);
    expect(Number(record!.user_ver)).toBe(7);
    expect(Number(record!.account_ver)).toBe(7);
    expect(Number(record!.session_ver)).toBe(7);

    const users = await harness.container.db.select().from(authUsers);
    expect(users).toHaveLength(1);
  });
});
