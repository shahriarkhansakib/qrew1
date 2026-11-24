import path from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createApp } from '../../src/app.js';
import {
  type AppContainer,
  type ContainerOverrides,
  createContainer,
} from '../../src/composition/container.js';
import { InMemoryEmailSpy } from '../../src/shared/email-port.js';
import { type AppEnv, loadEnv } from '../../src/shared/env.js';

export interface TestHarness {
  readonly env: AppEnv;
  readonly container: AppContainer;
  readonly emailSpy: InMemoryEmailSpy;
  readonly app: ReturnType<typeof createApp>;
  resetDatabase(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestHarness(
  overrides: Omit<ContainerOverrides, 'emailPort'> & { useSmtp?: boolean } = {},
): Promise<TestHarness> {
  process.env.NODE_ENV = 'test';
  const env = loadEnv();
  const emailSpy = new InMemoryEmailSpy();

  const container = createContainer(env, {
    emailPort: overrides.useSmtp ? undefined : emailSpy,
    enableRateLimit: overrides.enableRateLimit,
  });

  const migrationsFolder = path.resolve(import.meta.dirname, '../../drizzle');
  await migrate(container.db, { migrationsFolder });

  const app = createApp(container);

  const resetDatabase = async (): Promise<void> => {
    emailSpy.clear();
    await container.db.execute(
      sql`TRUNCATE TABLE
        "office_assignments",
        "offices",
        "tenant_memberships",
        "tenants",
        "platform_security_settings",
        "platform_role_assignments",
        "role_permissions",
        "roles",
        "audit_logs",
        "two_factor",
        "verification",
        "account",
        "session",
        "rate_limit",
        "user"
      RESTART IDENTITY CASCADE`,
    );
  };

  return {
    env,
    container,
    emailSpy,
    app,
    resetDatabase,
    close: async () => {
      await container.close();
    },
  };
}

export class TestCookieJar {
  private readonly cookies = new Map<string, string>();

  ingest(response: Response): string[] {
    const setCookies =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : (() => {
            const raw = response.headers.get('set-cookie');
            return raw ? [raw] : [];
          })();

    for (const header of setCookies) {
      const firstPart = header.split(';')[0];
      if (!firstPart) continue;
      const eqIdx = firstPart.indexOf('=');
      if (eqIdx <= 0) continue;
      const name = firstPart.slice(0, eqIdx).trim();
      const value = firstPart.slice(eqIdx + 1).trim();
      if (!value) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }

    return setCookies;
  }

  toHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  clear(): void {
    this.cookies.clear();
  }
}

export function extractFirstUrl(text: string): string {
  const match = text.match(/https?:\/\/[^\s<>"']+/);
  if (!match) {
    throw new Error(`No URL found in email text: ${text}`);
  }
  return match[0];
}
