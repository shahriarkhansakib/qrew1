import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authAccounts,
  authSessions,
  authUsers,
} from '../../src/modules/authn/infrastructure/schema.js';
import {
  createTestHarness,
  extractFirstUrl,
  TestCookieJar,
  type TestHarness,
} from '../helpers/test-harness.js';

describe('Authentication Integration (Better Auth + Real PostgreSQL)', () => {
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

  it('registers with scrypt hash, enforces email verification, sets HttpOnly SameSite=Lax cookies, and signs out cleanly', async () => {
    const email = 'asif.user@qrew.test';
    const password = 'StrongPassword#2026!';

    const signUpRes = await harness.app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
      },
      body: JSON.stringify({
        name: 'Asif User',
        email: 'ASIF.User@qrew.test',
        password,
      }),
    });
    expect(signUpRes.status).toBe(200);

    // Unverified user cannot sign in when requireEmailVerification is true
    const unverifiedLoginRes = await harness.app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
      },
      body: JSON.stringify({ email, password }),
    });
    expect(unverifiedLoginRes.status).toBe(403);

    // Verify stored password is salted scrypt hash, not plaintext
    const accounts = await harness.container.db.select().from(authAccounts);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.password).toBeTruthy();
    expect(accounts[0]?.password).not.toBe(password);
    expect(accounts[0]?.password).toContain(':');

    // Consume verification email link (may deliver initial + resend from unverified login attempt)
    expect(harness.emailSpy.sent.length).toBeGreaterThanOrEqual(1);
    const verifyUrl = new URL(extractFirstUrl(harness.emailSpy.sent[0]!.text));
    const jar = new TestCookieJar();
    const verifyRes = await harness.app.request(`${verifyUrl.pathname}${verifyUrl.search}`, {
      method: 'GET',
      headers: { origin: harness.env.WEB_PUBLIC_ORIGIN },
    });
    expect([200, 302]).toContain(verifyRes.status);
    const setCookies = jar.ingest(verifyRes);
    expect(setCookies.length).toBeGreaterThanOrEqual(1);
    expect(setCookies.some((c) => c.toLowerCase().includes('httponly'))).toBe(true);
    expect(setCookies.some((c) => c.toLowerCase().includes('samesite=lax'))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('qrew.'))).toBe(true);

    // Protected route /api/v1/me succeeds and leaks zero internal secret fields
    const meRes = await harness.app.request('/api/v1/me', {
      method: 'GET',
      headers: { cookie: jar.toHeader() },
    });
    expect(meRes.status).toBe(200);
    const meJson = (await meRes.json()) as {
      authenticated: boolean;
      user: Record<string, unknown>;
    };
    expect(meJson.authenticated).toBe(true);
    expect(meJson.user.email).toBe(email);
    expect(meJson.user.emailVerified).toBe(true);
    expect(meJson.user.password).toBeUndefined();
    expect(meJson.user.twoFactorSecret).toBeUndefined();

    // Sign-out deletes server-side session row and subsequent /api/v1/me returns 401
    const preSignOutCookieHeader = jar.toHeader();
    const signOutRes = await harness.app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
        cookie: preSignOutCookieHeader,
      },
      body: JSON.stringify({}),
    });
    expect(signOutRes.status).toBe(200);

    const sessionsAfterLogout = await harness.container.db.select().from(authSessions);
    expect(sessionsAfterLogout).toHaveLength(0);

    const meAfterLogout = await harness.app.request('/api/v1/me', {
      method: 'GET',
      headers: { cookie: preSignOutCookieHeader },
    });
    expect(meAfterLogout.status).toBe(401);
  });

  it('prevents duplicate user creation or password overwrite on duplicate registration when requireEmailVerification is enabled', async () => {
    const originalPassword = 'FirstPassword#2026!';
    const attackerPassword = 'AttackerPassword#9999!';

    const firstSignUp = await harness.app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
      },
      body: JSON.stringify({
        name: 'Original User',
        email: 'dup@qrew.test',
        password: originalPassword,
      }),
    });
    expect(firstSignUp.status).toBe(200);

    const [originalAccount] = await harness.container.db.select().from(authAccounts);
    const originalHash = originalAccount?.password;

    // Duplicate registration attempt with different password
    await harness.app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
      },
      body: JSON.stringify({
        name: 'Attacker Attempt',
        email: 'dup@qrew.test',
        password: attackerPassword,
      }),
    });

    const users = await harness.container.db
      .select()
      .from(authUsers)
      .where(eq(authUsers.email, 'dup@qrew.test'));
    expect(users).toHaveLength(1);
    expect(users[0]?.name).toBe('Original User');

    const [accountAfterDup] = await harness.container.db.select().from(authAccounts);
    expect(accountAfterDup?.password).toBe(originalHash);
  });

  it('revokes all existing login sessions upon password reset and blocks untrusted CSRF Origin', async () => {
    const email = 'reset@qrew.test';
    const oldPassword = 'OldPassword#2026!';
    const newPassword = 'NewPassword#2026!';

    await harness.app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
      },
      body: JSON.stringify({ name: 'Reset User', email, password: oldPassword }),
    });

    const verifyUrl = new URL(extractFirstUrl(harness.emailSpy.sent[0]!.text));
    const jar = new TestCookieJar();
    const verifyRes = await harness.app.request(`${verifyUrl.pathname}${verifyUrl.search}`, {
      method: 'GET',
      headers: { origin: harness.env.WEB_PUBLIC_ORIGIN },
    });
    jar.ingest(verifyRes);

    // Untrusted Origin CSRF check on state-changing auth endpoint must fail
    const csrfRes = await harness.app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil-attacker.example',
        cookie: jar.toHeader(),
      },
      body: JSON.stringify({}),
    });
    expect(csrfRes.status).toBe(403);

    // Unknown email password reset request does not leak existence
    const unknownResetRes = await harness.app.request('/api/auth/request-password-reset', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
      },
      body: JSON.stringify({
        email: 'nonexistent@qrew.test',
        redirectTo: `${harness.env.WEB_PUBLIC_ORIGIN}/reset-password`,
      }),
    });
    expect(unknownResetRes.status).toBe(200);

    harness.emailSpy.clear();
    const knownResetRes = await harness.app.request('/api/auth/request-password-reset', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
      },
      body: JSON.stringify({
        email,
        redirectTo: `${harness.env.WEB_PUBLIC_ORIGIN}/reset-password`,
      }),
    });
    expect(knownResetRes.status).toBe(200);
    expect(harness.emailSpy.sent).toHaveLength(1);

    const resetUrl = new URL(extractFirstUrl(harness.emailSpy.sent[0]!.text));
    const tokenFromUrl =
      resetUrl.searchParams.get('token') ?? resetUrl.pathname.split('/').pop() ?? '';
    expect(tokenFromUrl.length).toBeGreaterThan(5);

    const completeResetRes = await harness.app.request('/api/auth/reset-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
      },
      body: JSON.stringify({
        token: tokenFromUrl,
        newPassword,
      }),
    });
    expect(completeResetRes.status).toBe(200);

    // Old session must now be revoked in DB and rejected with 401
    const meWithOldSession = await harness.app.request('/api/v1/me', {
      method: 'GET',
      headers: { cookie: jar.toHeader() },
    });
    expect(meWithOldSession.status).toBe(401);

    // Signing in with new password succeeds
    const newLoginRes = await harness.app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
      },
      body: JSON.stringify({ email, password: newPassword }),
    });
    expect(newLoginRes.status).toBe(200);
  });

  it('initiates Google OAuth sign-in using public WEB_PUBLIC_ORIGIN callback URL', async () => {
    const res = await harness.app.request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: harness.env.WEB_PUBLIC_ORIGIN,
      },
      body: JSON.stringify({
        provider: 'google',
        callbackURL: '/dashboard',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url?: string; redirect?: boolean };
    expect(body.url).toContain('accounts.google.com');
    expect(body.url).toContain(
      encodeURIComponent(`${harness.env.WEB_PUBLIC_ORIGIN}/api/auth/callback/google`),
    );
  });
});
