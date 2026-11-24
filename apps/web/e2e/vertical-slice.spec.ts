import { type Browser, expect, type Page, test } from '@playwright/test';

const MAILPIT_API_URL = process.env.MAILPIT_API_URL ?? 'http://localhost:8029';
const WEB_PUBLIC_ORIGIN = process.env.WEB_PUBLIC_ORIGIN ?? 'http://localhost:3000';
const VERIFY_EMAIL_URL_RE = new RegExp(
  `${WEB_PUBLIC_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/api/auth/verify-email\\?[^\\s"'<>]+`,
);

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
  await expect(page.getByTestId('user-email')).toContainText(params.email);
}

test('completes registration, email verification, tenant & office creation, and enforces cross-tenant 403 isolation', async ({
  browser,
}: {
  browser: Browser;
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const password = 'E2eStrongPassword#2026!';

  const userA = {
    name: 'Tenant Owner A',
    email: `owner-a-${uniqueSuffix}@qrew.test`,
    password,
  };
  const tenantName = `Acme Workspace ${uniqueSuffix}`;
  const tenantSlug = `acme-${uniqueSuffix}`;
  const officeName = `Dhaka HQ ${uniqueSuffix}`;
  const officeSlug = `dhaka-hq-${uniqueSuffix}`;

  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();

  let tenantAId = '';
  try {
    // Landing page shows only unauthenticated entry links (no explicit dashboard/admin buttons)
    await pageA.goto('/');
    await expect(pageA.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(pageA.getByRole('link', { name: 'Create account' })).toBeVisible();
    await expect(pageA.getByRole('link', { name: 'Customer Dashboard' })).toHaveCount(0);
    await expect(pageA.getByRole('link', { name: 'Platform Admin' })).toHaveCount(0);

    // Auth pages expose a clear Back to home button and working password eye toggle
    await pageA.getByRole('link', { name: 'Sign in' }).click();
    await expect(pageA).toHaveURL(/\/login/);
    const loginPasswordInput = pageA.locator('#login-password');
    await expect(loginPasswordInput).toHaveAttribute('type', 'password');
    await pageA.getByTestId('login-password-toggle').click();
    await expect(loginPasswordInput).toHaveAttribute('type', 'text');
    await pageA.getByTestId('login-password-toggle').click();
    await expect(loginPasswordInput).toHaveAttribute('type', 'password');

    await pageA.getByRole('link', { name: /Back to home/i }).click();
    await expect(pageA).toHaveURL(/\/$/);

    await pageA.getByRole('link', { name: 'Create account' }).click();
    await expect(pageA).toHaveURL(/\/register/);
    await expect(pageA.getByRole('link', { name: /Back to home/i })).toBeVisible();
    const registerPasswordInput = pageA.locator('#register-password');
    await expect(registerPasswordInput).toHaveAttribute('type', 'password');
    await pageA.getByTestId('register-password-toggle').click();
    await expect(registerPasswordInput).toHaveAttribute('type', 'text');
    await pageA.getByTestId('register-password-toggle').click();
    await expect(registerPasswordInput).toHaveAttribute('type', 'password');

    await registerAndVerifyUser(pageA, userA);

    await pageA.getByLabel('Tenant name').fill(tenantName);
    await pageA.getByLabel('Tenant slug').fill(tenantSlug);
    await pageA.getByRole('button', { name: 'Create tenant' }).click();

    const tenantButton = pageA.getByTestId(`tenant-item-${tenantSlug}`);
    await expect(tenantButton).toBeVisible();
    await expect(pageA.getByTestId('active-tenant-role')).toHaveText('tenant_owner');

    tenantAId = (await pageA.getByTestId('active-tenant-id').textContent())?.trim() ?? '';
    expect(tenantAId).toMatch(/^[0-9a-f-]{36}$/i);

    await pageA.getByLabel('Office name').fill(officeName);
    await pageA.getByLabel('Office slug').fill(officeSlug);
    await pageA.getByRole('button', { name: 'Create office' }).click();

    await expect(pageA.getByTestId(`office-item-${officeSlug}`)).toBeVisible();
    await expect(pageA.getByTestId(`office-item-${officeSlug}`)).toContainText(officeName);

    // Customer principal cannot enter /admin or access /api/v1/platform/status
    await pageA.goto('/admin');
    await expect(pageA).toHaveURL(/\/dashboard/);

    const platformStatusRes = await pageA.request.get('/api/v1/platform/status');
    expect(platformStatusRes.status()).toBe(403);
  } finally {
    await contextA.close();
  }

  // Independent browser context for User B verifying strict cross-tenant isolation
  const userB = {
    name: 'Isolated User B',
    email: `user-b-${uniqueSuffix}@qrew.test`,
    password,
  };
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();

  try {
    await registerAndVerifyUser(pageB, userB);

    const listOfficesRes = await pageB.request.get(`/api/v1/tenants/${tenantAId}/offices`);
    expect(listOfficesRes.status()).toBe(403);
    const listErr = (await listOfficesRes.json()) as { error: { code: string } };
    expect(listErr.error.code).toBe('FORBIDDEN');

    const createOfficeRes = await pageB.request.post(`/api/v1/tenants/${tenantAId}/offices`, {
      headers: {
        origin: WEB_PUBLIC_ORIGIN,
      },
      data: {
        name: 'Unauthorized Branch',
        slug: `unauth-branch-${uniqueSuffix}`,
      },
    });
    expect(createOfficeRes.status()).toBe(403);
    const createErr = (await createOfficeRes.json()) as { error: { code: string } };
    expect(createErr.error.code).toBe('FORBIDDEN');
  } finally {
    await contextB.close();
  }
});
