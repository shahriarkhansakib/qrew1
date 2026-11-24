import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { type Browser, expect, type Page, test } from '@playwright/test';

const MAILPIT_API_URL = process.env.MAILPIT_API_URL ?? 'http://localhost:8029';
const WEB_PUBLIC_ORIGIN = process.env.WEB_PUBLIC_ORIGIN ?? 'http://localhost:3000';
const VERIFY_EMAIL_URL_RE = new RegExp(
  `${WEB_PUBLIC_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/api/auth/verify-email\\?[^\\s"'<>]+`,
);
const ROOT_DIR = path.resolve(import.meta.dirname, '../../..');

interface MailpitSummaryMessage {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
}

interface MailpitListResponse {
  messages: MailpitSummaryMessage[];
}

interface MailpitMessageDetail {
  Text?: string;
  HTML?: string;
}

async function generateSafeTotpCode(totpUri: string): Promise<string> {
  const remainingSeconds = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (remainingSeconds < 3) {
    await new Promise((resolve) => setTimeout(resolve, (remainingSeconds + 1) * 1000));
  }

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

async function waitForVerificationUrl(email: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  const normalizedTarget = email.toLowerCase();

  while (Date.now() < deadline) {
    const listRes = await fetch(`${MAILPIT_API_URL}/api/v1/messages?limit=50`);
    if (listRes.ok) {
      const data = (await listRes.json()) as MailpitListResponse;
      const match = data.messages.find((msg) =>
        msg.To.some((recipient) => recipient.Address.toLowerCase() === normalizedTarget),
      );

      if (match) {
        const detailRes = await fetch(`${MAILPIT_API_URL}/api/v1/message/${match.ID}`);
        if (detailRes.ok) {
          const detail = (await detailRes.json()) as MailpitMessageDetail;
          const bodyText = detail.Text ?? detail.HTML ?? '';
          const urlMatch = bodyText.match(VERIFY_EMAIL_URL_RE);
          if (urlMatch) {
            return urlMatch[0].replaceAll('&amp;', '&');
          }
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for Mailpit verification email for ${email}`);
}

async function registerAndVerifyUser(
  page: Page,
  params: { name: string; email: string; password: string },
) {
  await page.goto('/register');
  await page.getByLabel('Full name').fill(params.name);
  await page.getByLabel('Work email').fill(params.email);
  await page.getByLabel('Password', { exact: true }).fill(params.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByTestId('register-success')).toBeVisible();

  const verificationUrl = await waitForVerificationUrl(params.email);
  await page.goto(verificationUrl);
  await expect(page).toHaveURL(/\/dashboard/);
}

test('enters /admin with dev 2FA OFF by default, guards toggling ON until personal MFA setup, enforces policy across sub-admins, and completes 2FA login', async ({
  browser,
}: {
  browser: Browser;
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const adminPassword = 'AdminStrongPassword#2026!';
  const secondPassword = 'OpsStrongPassword#2026!';
  const adminUser = {
    name: 'Root Platform Admin',
    email: `root-admin-${uniqueSuffix}@qrew.test`,
    password: adminPassword,
  };
  const secondAdmin = {
    name: 'Operations Admin',
    email: `ops-admin-${uniqueSuffix}@qrew.test`,
    password: secondPassword,
  };

  // Register and verify second admin candidate in an isolated context (kept signed in for gating checks)
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();

  try {
    await registerAndVerifyUser(secondPage, secondAdmin);
    await registerAndVerifyUser(adminPage, adminUser);

    const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    execFileSync(pnpmBin, ['bootstrap:admin', '--', '--email', adminUser.email], {
      cwd: ROOT_DIR,
      shell: process.platform === 'win32',
      stdio: 'pipe',
    });

    // In dev mode, platform 2FA defaults to OFF: /dashboard redirects straight to unlocked /admin
    await adminPage.goto('/dashboard');
    await expect(adminPage).toHaveURL(/\/admin/);
    await expect(adminPage.getByTestId('platform-admin-panel')).toBeVisible();
    await expect(adminPage.getByTestId('mfa-policy-off-banner')).toBeVisible();
    await expect(adminPage.getByTestId('platform-mfa-policy-status')).toHaveText('Optional (OFF)');
    await expect(adminPage.getByTestId('platform-mfa-status')).toHaveText('Disabled');

    // Admin still gets 403 PLATFORM_ADMIN_CUSTOMER_ACCESS_DENIED on customer routes
    const listTenantsRes = await adminPage.request.get('/api/v1/tenants');
    expect(listTenantsRes.status()).toBe(403);
    expect((await listTenantsRes.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'PLATFORM_ADMIN_CUSTOMER_ACCESS_DENIED' },
    });

    // Attempting to toggle ON before setting up personal 2FA is blocked cleanly (self-lockout protection)
    await adminPage.getByTestId('toggle-platform-mfa-btn').click();
    await expect(adminPage.getByTestId('platform-admin-error')).toContainText(
      'Enable and verify your own 2FA authenticator',
    );
    await expect(adminPage.getByTestId('platform-mfa-policy-status')).toHaveText('Optional (OFF)');

    // Enroll personal TOTP 2FA inside /admin Security card (also testing eye toggle)
    const panelPwdInput = adminPage.locator('#panel-mfa-password');
    await expect(panelPwdInput).toHaveAttribute('type', 'password');
    await adminPage.getByTestId('panel-mfa-password-toggle').click();
    await expect(panelPwdInput).toHaveAttribute('type', 'text');
    await adminPage.getByTestId('panel-mfa-password-toggle').click();
    await expect(panelPwdInput).toHaveAttribute('type', 'password');

    await panelPwdInput.fill(adminPassword);
    await adminPage.getByRole('button', { name: 'Set up personal 2FA' }).click();

    const totpUriElement = adminPage.getByTestId('panel-mfa-totp-uri');
    await expect(totpUriElement).toBeVisible();
    const totpUri = (await totpUriElement.textContent())?.trim() ?? '';
    expect(totpUri).toContain('otpauth://totp/');

    const totpCode = await generateSafeTotpCode(totpUri);
    await adminPage.getByLabel('Enter 6-digit verification code').fill(totpCode);
    await adminPage.getByRole('button', { name: 'Verify & activate personal 2FA' }).click();

    await expect(adminPage.getByTestId('platform-mfa-status')).toHaveText('Enabled');

    // Toggle platform-wide 2FA requirement ON -> policy becomes Required (ON)
    await adminPage.getByTestId('toggle-platform-mfa-btn').click();
    await expect(adminPage.getByTestId('platform-mfa-policy-status')).toHaveText('Required (ON)');
    await expect(adminPage.getByTestId('mfa-policy-off-banner')).toHaveCount(0);

    // Provision second admin -> second admin without MFA hits /admin MFA enrollment gate
    await adminPage.getByLabel('Verified user email').fill(secondAdmin.email);
    await adminPage.getByRole('button', { name: 'Provision platform admin' }).click();
    await expect(adminPage.getByTestId(`admin-row-${secondAdmin.email}`)).toBeVisible();

    await secondPage.goto('/admin');
    await expect(secondPage).toHaveURL(/\/admin/);
    await expect(secondPage.getByTestId('admin-mfa-gate')).toBeVisible();

    // Super admin signs out, completes 2FA login challenge on /login, and toggles policy back OFF
    await adminPage.getByRole('button', { name: 'Sign out' }).click();
    await expect(adminPage).toHaveURL(/\/login/);

    await adminPage.getByLabel('Email').fill(adminUser.email);
    await adminPage.getByLabel('Password', { exact: true }).fill(adminPassword);
    await adminPage.getByRole('button', { name: 'Sign in' }).click();

    const loginTotpInput = adminPage.getByTestId('login-totp-input');
    await expect(loginTotpInput).toBeVisible();
    const loginTotpCode = await generateSafeTotpCode(totpUri);
    await loginTotpInput.fill(loginTotpCode);
    await adminPage.getByRole('button', { name: 'Verify and sign in' }).click();

    await expect(adminPage).toHaveURL(/\/admin/);
    await expect(adminPage.getByTestId('platform-admin-panel')).toBeVisible();

    await adminPage.getByTestId('toggle-platform-mfa-btn').click();
    await expect(adminPage.getByTestId('platform-mfa-policy-status')).toHaveText('Optional (OFF)');
    await expect(adminPage.getByTestId('mfa-policy-off-banner')).toBeVisible();

    // Reloading un-enrolled sub-admin now unlocks /admin immediately (without super_admin toggle)
    await secondPage.reload();
    await expect(secondPage.getByTestId('platform-admin-panel')).toBeVisible();
    await expect(secondPage.getByTestId('admin-role-badge')).toHaveText('platform_admin');
    await expect(secondPage.getByTestId('toggle-platform-mfa-btn')).toHaveCount(0);
  } finally {
    await secondContext.close();
    await adminContext.close();
  }
});
