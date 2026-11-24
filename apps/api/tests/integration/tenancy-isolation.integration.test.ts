import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLogs } from '../../src/modules/authz/infrastructure/schema.js';
import {
  officeAssignments,
  tenantMemberships,
} from '../../src/modules/tenancy/infrastructure/schema.js';
import { generateId } from '../../src/shared/id.js';
import {
  createTestHarness,
  extractFirstUrl,
  TestCookieJar,
  type TestHarness,
} from '../helpers/test-harness.js';

async function signUpAndLogin(
  harness: TestHarness,
  params: { name: string; email: string; password: string },
): Promise<{ jar: TestCookieJar; userId: string }> {
  harness.emailSpy.clear();
  const res = await harness.app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: harness.env.WEB_PUBLIC_ORIGIN,
    },
    body: JSON.stringify(params),
  });
  expect(res.status).toBe(200);
  const data = (await res.json()) as { user: { id: string } };
  const verifyUrl = new URL(extractFirstUrl(harness.emailSpy.sent[0]!.text));
  const jar = new TestCookieJar();
  const verifyRes = await harness.app.request(`${verifyUrl.pathname}${verifyUrl.search}`, {
    method: 'GET',
    headers: { origin: harness.env.WEB_PUBLIC_ORIGIN },
  });
  jar.ingest(verifyRes);
  return { jar, userId: data.user.id };
}

describe('Tenancy, Offices, Cross-Tenant Isolation & Composite Foreign Keys', () => {
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

  it('creates tenant + Tenant Owner + audit log atomically, isolates tenants on office operations, and enforces composite FKs at PostgreSQL level', async () => {
    // Unauthenticated call returns 401
    const unauthRes = await harness.app.request('/api/v1/tenants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'No Auth Corp', slug: 'no-auth' }),
    });
    expect(unauthRes.status).toBe(401);

    // User A creates Tenant A and Office A1
    const userA = await signUpAndLogin(harness, {
      name: 'Alice Owner',
      email: 'alice@tenant-a.test',
      password: 'Password#2026!',
    });

    const createTenantARes = await harness.app.request('/api/v1/tenants', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: userA.jar.toHeader(),
      },
      body: JSON.stringify({ name: 'Alpha Corp', slug: 'alpha-corp' }),
    });
    expect(createTenantARes.status).toBe(201);
    const tenantA = (await createTenantARes.json()) as { id: string; roleKey: string };
    expect(tenantA.roleKey).toBe('tenant_owner');

    const createOfficeA1Res = await harness.app.request(`/api/v1/tenants/${tenantA.id}/offices`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: userA.jar.toHeader(),
      },
      body: JSON.stringify({ name: 'Dhaka HQ', slug: 'dhaka-hq' }),
    });
    expect(createOfficeA1Res.status).toBe(201);
    const officeA1 = (await createOfficeA1Res.json()) as { id: string; tenantId: string };
    expect(officeA1.tenantId).toBe(tenantA.id);

    // User B creates Tenant B and Office B1
    const userB = await signUpAndLogin(harness, {
      name: 'Bob Owner',
      email: 'bob@tenant-b.test',
      password: 'Password#2026!',
    });
    const createTenantBRes = await harness.app.request('/api/v1/tenants', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: userB.jar.toHeader(),
      },
      body: JSON.stringify({ name: 'Beta Corp', slug: 'beta-corp' }),
    });
    expect(createTenantBRes.status).toBe(201);
    const tenantB = (await createTenantBRes.json()) as { id: string };

    const createOfficeB1Res = await harness.app.request(`/api/v1/tenants/${tenantB.id}/offices`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: userB.jar.toHeader(),
      },
      body: JSON.stringify({ name: 'London Hub', slug: 'london-hub' }),
    });
    expect(createOfficeB1Res.status).toBe(201);
    const officeB1 = (await createOfficeB1Res.json()) as { id: string };

    // Cross-tenant isolation: User B cannot list or create offices in Tenant A
    const crossListRes = await harness.app.request(`/api/v1/tenants/${tenantA.id}/offices`, {
      method: 'GET',
      headers: { cookie: userB.jar.toHeader() },
    });
    expect(crossListRes.status).toBe(403);

    const crossCreateRes = await harness.app.request(`/api/v1/tenants/${tenantA.id}/offices`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: userB.jar.toHeader(),
      },
      body: JSON.stringify({ name: 'Intruder Office', slug: 'intruder-office' }),
    });
    expect(crossCreateRes.status).toBe(403);

    // Database-level composite FK defense in depth:
    // Attempting to insert office_assignments linking Tenant A's membership to Tenant B's office MUST fail with SQLSTATE 23503
    const [membershipA] = await harness.container.db
      .select()
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.tenantId, tenantA.id), eq(tenantMemberships.userId, userA.userId)),
      );
    expect(membershipA).toBeDefined();

    let caughtFkCode: string | undefined;
    try {
      await harness.container.db.insert(officeAssignments).values({
        id: generateId(),
        tenantId: tenantA.id,
        officeId: officeB1.id, // Belongs to Tenant B!
        membershipId: membershipA!.id,
        roleId: membershipA!.roleId,
        status: 'active',
      });
    } catch (err) {
      const pgCause = err as { cause?: { code?: string }; code?: string };
      caughtFkCode = pgCause.cause?.code ?? pgCause.code;
    }
    expect(caughtFkCode).toBe('23503');

    // Audit trail recorded both tenant and office creation
    const logs = await harness.container.db.select().from(auditLogs);
    expect(logs.filter((l) => l.action === 'tenant.created')).toHaveLength(2);
    expect(logs.filter((l) => l.action === 'office.created')).toHaveLength(2);
  });
});
