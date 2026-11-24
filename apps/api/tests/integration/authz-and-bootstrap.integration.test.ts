import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditLogs,
  platformRoleAssignments,
  platformSecuritySettings,
} from '../../src/modules/authz/infrastructure/schema.js';
import { tenantMemberships } from '../../src/modules/tenancy/infrastructure/schema.js';
import {
  createTestHarness,
  extractFirstUrl,
  TestCookieJar,
  type TestHarness,
} from '../helpers/test-harness.js';

function generateTotpCodeFromUri(totpUri: string): string {
  const url = new URL(totpUri);
  const secretBase32 = url.searchParams.get('secret');
  if (!secretBase32) {
    throw new Error(`Missing secret in TOTP URI: ${totpUri}`);
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secretBase32.toUpperCase().replace(/=+$/, '')) {
    const val = alphabet.indexOf(char);
    if (val >= 0) bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  const key = Buffer.from(bytes);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(msg).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const code =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

async function registerAndVerifyUser(
  harness: TestHarness,
  params: { name: string; email: string; password: string; verify?: boolean },
): Promise<{ jar: TestCookieJar; userId: string }> {
  harness.emailSpy.clear();
  const signUp = await harness.app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: harness.env.WEB_PUBLIC_ORIGIN,
    },
    body: JSON.stringify({
      name: params.name,
      email: params.email,
      password: params.password,
    }),
  });
  expect(signUp.status).toBe(200);
  const signUpJson = (await signUp.json()) as { user: { id: string } };

  const jar = new TestCookieJar();
  if (params.verify !== false) {
    const verifyUrl = new URL(extractFirstUrl(harness.emailSpy.sent[0]!.text));
    const verifyRes = await harness.app.request(`${verifyUrl.pathname}${verifyUrl.search}`, {
      method: 'GET',
      headers: { origin: harness.env.WEB_PUBLIC_ORIGIN },
    });
    jar.ingest(verifyRes);
  }

  return { jar, userId: signUpJson.user.id };
}

describe('Authorization Engine, Platform Bootstrap, MFA & Scoped Revocation', () => {
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

  it('enforces controlled Super Admin bootstrap, idempotency, refusal of second Super Admin, MFA gate, and subsequent provisioning', async () => {
    // 1. Unknown user rejected
    await expect(
      harness.container.bootstrapSuperAdmin.execute({ email: 'missing@qrew.test' }),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND', statusCode: 404 });

    // 2. Unverified user rejected + audited
    await registerAndVerifyUser(harness, {
      name: 'Unverified User',
      email: 'unverified-admin@qrew.test',
      password: 'Password#2026!',
      verify: false,
    });
    await expect(
      harness.container.bootstrapSuperAdmin.execute({ email: 'unverified-admin@qrew.test' }),
    ).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED', statusCode: 403 });

    // 3. Verified user promoted + audited
    const adminPassword = 'SuperAdmin#2026!';
    const superAdmin = await registerAndVerifyUser(harness, {
      name: 'Initial Super Admin',
      email: 'founder@qrew.test',
      password: adminPassword,
    });

    const bootstrapRes = await harness.container.bootstrapSuperAdmin.execute({
      email: 'founder@qrew.test',
    });
    expect(bootstrapRes.status).toBe('bootstrapped');
    expect(bootstrapRes.userId).toBe(superAdmin.userId);

    // 4. Repeated execution for the SAME user is idempotent
    const repeatRes = await harness.container.bootstrapSuperAdmin.execute({
      email: 'founder@qrew.test',
    });
    expect(repeatRes.status).toBe('already_bootstrapped');

    // 5. Second distinct verified user CANNOT hijack bootstrap
    const secondAdmin = await registerAndVerifyUser(harness, {
      name: 'Second Admin Candidate',
      email: 'second@qrew.test',
      password: 'Password#2026!',
    });
    await expect(
      harness.container.bootstrapSuperAdmin.execute({ email: 'second@qrew.test' }),
    ).rejects.toMatchObject({ code: 'SUPER_ADMIN_ALREADY_EXISTS', statusCode: 409 });

    const assignments = await harness.container.db.select().from(platformRoleAssignments);
    expect(assignments).toHaveLength(1);

    // 6. Platform endpoint blocks Super Admin UNTIL MFA is enabled
    const statusWithoutMfa = await harness.app.request('/api/v1/platform/status', {
      method: 'GET',
      headers: { cookie: superAdmin.jar.toHeader() },
    });
    expect(statusWithoutMfa.status).toBe(403);
    const noMfaBody = (await statusWithoutMfa.json()) as { error: { code: string } };
    expect(noMfaBody.error.code).toBe('PLATFORM_MFA_REQUIRED');

    // Enable Better Auth TOTP 2FA and verify TOTP code
    const enable2faRes = await harness.app.request('/api/auth/two-factor/enable', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: superAdmin.jar.toHeader(),
      },
      body: JSON.stringify({ password: adminPassword }),
    });
    expect(enable2faRes.status).toBe(200);
    const { totpURI } = (await enable2faRes.json()) as { totpURI: string };
    const totpCode = generateTotpCodeFromUri(totpURI);

    const verifyTotpRes = await harness.app.request('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: superAdmin.jar.toHeader(),
      },
      body: JSON.stringify({ code: totpCode }),
    });
    expect(verifyTotpRes.status).toBe(200);
    superAdmin.jar.ingest(verifyTotpRes);

    // 7. With MFA enabled, platform status & provisioning subsequent admin succeed
    const statusWithMfa = await harness.app.request('/api/v1/platform/status', {
      method: 'GET',
      headers: { cookie: superAdmin.jar.toHeader() },
    });
    expect(statusWithMfa.status).toBe(200);
    const statusJson = (await statusWithMfa.json()) as { roleKey: string };
    expect(statusJson.roleKey).toBe('super_admin');

    const provisionRes = await harness.app.request('/api/v1/platform/admins', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: superAdmin.jar.toHeader(),
      },
      body: JSON.stringify({
        email: 'second@qrew.test',
        roleKey: 'platform_admin',
      }),
    });
    expect(provisionRes.status).toBe(201);
    const provisionedJson = (await provisionRes.json()) as { userId: string; roleKey: string };
    expect(provisionedJson.userId).toBe(secondAdmin.userId);
    expect(provisionedJson.roleKey).toBe('platform_admin');

    // Ordinary non-admin user still gets 403 on platform status
    const ordinaryUser = await registerAndVerifyUser(harness, {
      name: 'Ordinary User',
      email: 'ordinary@qrew.test',
      password: 'Password#2026!',
    });
    const ordinaryStatusRes = await harness.app.request('/api/v1/platform/status', {
      method: 'GET',
      headers: { cookie: ordinaryUser.jar.toHeader() },
    });
    expect(ordinaryStatusRes.status).toBe(403);

    const logs = await harness.container.db.select().from(auditLogs);
    expect(logs.some((l) => l.action === 'platform.super_admin.bootstrapped')).toBe(true);
    expect(logs.some((l) => l.action === 'platform.super_admin.bootstrap_rejected')).toBe(true);
    expect(logs.some((l) => l.action === 'platform.admin.provisioned')).toBe(true);
  });

  it('revokes tenant membership access immediately without terminating the user global Better Auth session for other tenants', async () => {
    const user = await registerAndVerifyUser(harness, {
      name: 'Multi-Tenant User',
      email: 'multi@qrew.test',
      password: 'Password#2026!',
    });

    const tenant1Res = await harness.app.request('/api/v1/tenants', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: user.jar.toHeader(),
      },
      body: JSON.stringify({ name: 'Tenant One', slug: 'tenant-one' }),
    });
    expect(tenant1Res.status).toBe(201);
    const tenant1 = (await tenant1Res.json()) as { id: string };

    const tenant2Res = await harness.app.request('/api/v1/tenants', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: user.jar.toHeader(),
      },
      body: JSON.stringify({ name: 'Tenant Two', slug: 'tenant-two' }),
    });
    expect(tenant2Res.status).toBe(201);
    const tenant2 = (await tenant2Res.json()) as { id: string };

    // Both tenants accessible initially
    const t1OfficesBefore = await harness.app.request(`/api/v1/tenants/${tenant1.id}/offices`, {
      headers: { cookie: user.jar.toHeader() },
    });
    expect(t1OfficesBefore.status).toBe(200);

    // Revoke membership ONLY in Tenant 1
    await harness.container.db
      .update(tenantMemberships)
      .set({ status: 'revoked' })
      .where(
        and(eq(tenantMemberships.tenantId, tenant1.id), eq(tenantMemberships.userId, user.userId)),
      );

    // Tenant 1 access is immediately blocked (403)
    const t1OfficesAfter = await harness.app.request(`/api/v1/tenants/${tenant1.id}/offices`, {
      headers: { cookie: user.jar.toHeader() },
    });
    expect(t1OfficesAfter.status).toBe(403);

    // Global session and Tenant 2 access remain completely intact (200)
    const meRes = await harness.app.request('/api/v1/me', {
      headers: { cookie: user.jar.toHeader() },
    });
    expect(meRes.status).toBe(200);

    const t2OfficesAfter = await harness.app.request(`/api/v1/tenants/${tenant2.id}/offices`, {
      headers: { cookie: user.jar.toHeader() },
    });
    expect(t2OfficesAfter.status).toBe(200);
  });

  it('enforces strict admin vs user principal separation, promotion blocks on tenant members, and admin listing', async () => {
    // 1. Customer user with an existing tenant membership cannot be bootstrapped OR provisioned as admin
    const tenantOwner = await registerAndVerifyUser(harness, {
      name: 'Existing Tenant Owner',
      email: 'tenant-owner@qrew.test',
      password: 'Password#2026!',
    });

    const tenantRes = await harness.app.request('/api/v1/tenants', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: tenantOwner.jar.toHeader(),
      },
      body: JSON.stringify({ name: 'Existing Org', slug: 'existing-org' }),
    });
    expect(tenantRes.status).toBe(201);

    const ownerCtxRes = await harness.app.request('/api/v1/access-context', {
      headers: { cookie: tenantOwner.jar.toHeader() },
    });
    expect(ownerCtxRes.status).toBe(200);
    expect(await ownerCtxRes.json()).toMatchObject({
      principalType: 'user',
      platformRoleKey: null,
      mfaRequired: false,
    });

    await expect(
      harness.container.bootstrapSuperAdmin.execute({ email: 'tenant-owner@qrew.test' }),
    ).rejects.toMatchObject({ code: 'USER_HAS_TENANT_MEMBERSHIPS', statusCode: 409 });

    // 2. Clean verified account can be bootstrapped and immediately loses customer workspace access
    const adminPassword = 'CleanAdmin#2026!';
    const admin = await registerAndVerifyUser(harness, {
      name: 'Clean Platform Admin',
      email: 'clean-admin@qrew.test',
      password: adminPassword,
    });
    await harness.container.bootstrapSuperAdmin.execute({ email: 'clean-admin@qrew.test' });

    const preMfaCtxRes = await harness.app.request('/api/v1/access-context', {
      headers: { cookie: admin.jar.toHeader() },
    });
    expect(preMfaCtxRes.status).toBe(200);
    expect(await preMfaCtxRes.json()).toMatchObject({
      principalType: 'admin',
      platformRoleKey: 'super_admin',
      mfaRequired: true,
    });

    const adminListTenantsDenied = await harness.app.request('/api/v1/tenants', {
      headers: { cookie: admin.jar.toHeader() },
    });
    expect(adminListTenantsDenied.status).toBe(403);
    expect((await adminListTenantsDenied.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'PLATFORM_ADMIN_CUSTOMER_ACCESS_DENIED' },
    });

    const adminCreateTenantDenied = await harness.app.request('/api/v1/tenants', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: admin.jar.toHeader(),
      },
      body: JSON.stringify({ name: 'Should Fail', slug: 'should-fail' }),
    });
    expect(adminCreateTenantDenied.status).toBe(403);
    expect((await adminCreateTenantDenied.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'PLATFORM_ADMIN_CUSTOMER_ACCESS_DENIED' },
    });

    // Un-enrolled admin cannot read /api/v1/platform/admins
    const adminsBeforeMfa = await harness.app.request('/api/v1/platform/admins', {
      headers: { cookie: admin.jar.toHeader() },
    });
    expect(adminsBeforeMfa.status).toBe(403);

    // Enable & verify MFA for admin
    const enableRes = await harness.app.request('/api/auth/two-factor/enable', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: admin.jar.toHeader(),
      },
      body: JSON.stringify({ password: adminPassword }),
    });
    expect(enableRes.status).toBe(200);
    const { totpURI } = (await enableRes.json()) as { totpURI: string };
    const verifyRes = await harness.app.request('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: admin.jar.toHeader(),
      },
      body: JSON.stringify({ code: generateTotpCodeFromUri(totpURI) }),
    });
    expect(verifyRes.status).toBe(200);
    admin.jar.ingest(verifyRes);

    // 3. Provisioning rejects tenant-owning user with 409 USER_HAS_TENANT_MEMBERSHIPS
    const provisionTenantMemberRes = await harness.app.request('/api/v1/platform/admins', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: admin.jar.toHeader(),
      },
      body: JSON.stringify({
        email: 'tenant-owner@qrew.test',
        roleKey: 'platform_admin',
      }),
    });
    expect(provisionTenantMemberRes.status).toBe(409);
    expect((await provisionTenantMemberRes.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'USER_HAS_TENANT_MEMBERSHIPS' },
    });

    // 4. Clean second verified user can be provisioned and appears in GET /api/v1/platform/admins
    const secondCandidatePassword = 'SecondAdmin#2026!';
    const secondCandidate = await registerAndVerifyUser(harness, {
      name: 'Support Operator',
      email: 'support-admin@qrew.test',
      password: secondCandidatePassword,
    });

    const provisionCleanRes = await harness.app.request('/api/v1/platform/admins', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: admin.jar.toHeader(),
      },
      body: JSON.stringify({
        email: 'support-admin@qrew.test',
        roleKey: 'platform_admin',
      }),
    });
    expect(provisionCleanRes.status).toBe(201);

    const listAdminsRes = await harness.app.request('/api/v1/platform/admins', {
      headers: { cookie: admin.jar.toHeader() },
    });
    expect(listAdminsRes.status).toBe(200);
    const adminList = (await listAdminsRes.json()) as Array<{ email: string; roleKey: string }>;
    expect(adminList).toHaveLength(2);
    expect(adminList.map((a) => `${a.email}:${a.roleKey}`)).toEqual([
      'clean-admin@qrew.test:super_admin',
      'support-admin@qrew.test:platform_admin',
    ]);

    // Enable MFA on platform_admin and confirm they can READ admins but CANNOT provision new admins
    const enableSecond = await harness.app.request('/api/auth/two-factor/enable', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: secondCandidate.jar.toHeader(),
      },
      body: JSON.stringify({ password: secondCandidatePassword }),
    });
    const secondUri = ((await enableSecond.json()) as { totpURI: string }).totpURI;
    const verifySecond = await harness.app.request('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: secondCandidate.jar.toHeader(),
      },
      body: JSON.stringify({ code: generateTotpCodeFromUri(secondUri) }),
    });
    secondCandidate.jar.ingest(verifySecond);

    const secondReadRes = await harness.app.request('/api/v1/platform/admins', {
      headers: { cookie: secondCandidate.jar.toHeader() },
    });
    expect(secondReadRes.status).toBe(200);

    const thirdCandidate = await registerAndVerifyUser(harness, {
      name: 'Third Candidate',
      email: 'third@qrew.test',
      password: 'Password#2026!',
    });
    expect(thirdCandidate.userId).toBeTruthy();

    const secondProvisionAttempt = await harness.app.request('/api/v1/platform/admins', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: secondCandidate.jar.toHeader(),
      },
      body: JSON.stringify({
        email: 'third@qrew.test',
        roleKey: 'platform_admin',
      }),
    });
    expect(secondProvisionAttempt.status).toBe(403);

    const logs = await harness.container.db.select().from(auditLogs);
    expect(
      logs.some(
        (l) =>
          l.action === 'platform.super_admin.bootstrap_rejected' &&
          (l.metadata as Record<string, unknown>)?.reason === 'user_has_tenant_memberships',
      ),
    ).toBe(true);
    expect(
      logs.some(
        (l) =>
          l.action === 'platform.admin.provision_rejected' &&
          (l.metadata as Record<string, unknown>)?.reason === 'user_has_tenant_memberships',
      ),
    ).toBe(true);
  });

  it('allows super_admin to toggle platform MFA policy safely with self-lockout protection and audit logging', async () => {
    const adminPassword = 'PolicyAdmin#2026!';
    const superAdmin = await registerAndVerifyUser(harness, {
      name: 'Policy Super Admin',
      email: 'policy-super@qrew.test',
      password: adminPassword,
    });
    await harness.container.bootstrapSuperAdmin.execute({ email: 'policy-super@qrew.test' });

    const subAdmin = await registerAndVerifyUser(harness, {
      name: 'Policy Sub Admin',
      email: 'policy-sub@qrew.test',
      password: 'SubAdminPassword#2026!',
    });

    // Simulate dev default OFF in DB via direct row (in production/test default is ON)
    await harness.container.db.insert(platformSecuritySettings).values({
      id: 'default',
      requirePlatformMfa: false,
    });

    // When policy is OFF, super_admin cannot turn it ON without enrolling personal 2FA first
    const enableWithoutOwnMfa = await harness.app.request('/api/v1/platform/security-settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: superAdmin.jar.toHeader(),
      },
      body: JSON.stringify({ requirePlatformMfa: true }),
    });
    expect(enableWithoutOwnMfa.status).toBe(409);
    expect((await enableWithoutOwnMfa.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'MFA_SETUP_REQUIRED_BEFORE_ENFORCEMENT' },
    });

    // Provision sub-admin while policy is OFF (no MFA enrolled on either account yet)
    const provisionRes = await harness.app.request('/api/v1/platform/admins', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: superAdmin.jar.toHeader(),
      },
      body: JSON.stringify({ email: 'policy-sub@qrew.test', roleKey: 'platform_admin' }),
    });
    expect(provisionRes.status).toBe(201);

    // Sub-admin accesses platform endpoints without MFA while policy is OFF
    const subStatusOff = await harness.app.request('/api/v1/platform/status', {
      headers: { cookie: subAdmin.jar.toHeader() },
    });
    expect(subStatusOff.status).toBe(200);
    expect((await subStatusOff.json()) as { requirePlatformMfa: boolean }).toMatchObject({
      requirePlatformMfa: false,
    });

    // Sub-admin CANNOT change security settings (403)
    const subToggleAttempt = await harness.app.request('/api/v1/platform/security-settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: subAdmin.jar.toHeader(),
      },
      body: JSON.stringify({ requirePlatformMfa: false }),
    });
    expect(subToggleAttempt.status).toBe(403);

    // Super Admin enables personal 2FA, then toggles platform MFA policy ON
    const enableRes = await harness.app.request('/api/auth/two-factor/enable', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: superAdmin.jar.toHeader(),
      },
      body: JSON.stringify({ password: adminPassword }),
    });
    const { totpURI } = (await enableRes.json()) as { totpURI: string };
    const verifyRes = await harness.app.request('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: superAdmin.jar.toHeader(),
      },
      body: JSON.stringify({ code: generateTotpCodeFromUri(totpURI) }),
    });
    superAdmin.jar.ingest(verifyRes);

    const turnOnRes = await harness.app.request('/api/v1/platform/security-settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: superAdmin.jar.toHeader(),
      },
      body: JSON.stringify({ requirePlatformMfa: true }),
    });
    expect(turnOnRes.status).toBe(200);
    expect((await turnOnRes.json()) as { requirePlatformMfa: boolean }).toMatchObject({
      requirePlatformMfa: true,
    });

    // Un-enrolled sub-admin is immediately blocked by MFA policy ON
    const subStatusOn = await harness.app.request('/api/v1/platform/status', {
      headers: { cookie: subAdmin.jar.toHeader() },
    });
    expect(subStatusOn.status).toBe(403);
    expect((await subStatusOn.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'PLATFORM_MFA_REQUIRED' },
    });

    const subCtxOn = await harness.app.request('/api/v1/access-context', {
      headers: { cookie: subAdmin.jar.toHeader() },
    });
    expect(
      (await subCtxOn.json()) as { requirePlatformMfa: boolean; mfaRequired: boolean },
    ).toEqual(expect.objectContaining({ requirePlatformMfa: true, mfaRequired: true }));

    // Super Admin toggles policy back OFF -> sub-admin access restores immediately
    const turnOffRes = await harness.app.request('/api/v1/platform/security-settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: superAdmin.jar.toHeader(),
      },
      body: JSON.stringify({ requirePlatformMfa: false }),
    });
    expect(turnOffRes.status).toBe(200);

    const subStatusRestored = await harness.app.request('/api/v1/platform/status', {
      headers: { cookie: subAdmin.jar.toHeader() },
    });
    expect(subStatusRestored.status).toBe(200);

    const policyLogs = await harness.container.db.select().from(auditLogs);
    expect(
      policyLogs.filter((l) => l.action === 'platform.security.mfa_policy_updated'),
    ).toHaveLength(2);
  });
});
