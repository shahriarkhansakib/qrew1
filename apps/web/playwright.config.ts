import path from 'node:path';
import { defineConfig } from '@playwright/test';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');

try {
  process.loadEnvFile(path.join(ROOT_DIR, '.env'));
} catch {
  // Root .env is optional (CI provides environment variables directly).
}

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:8787';
const webUrl = process.env.WEB_PUBLIC_ORIGIN ?? 'http://localhost:3000';
const apiPort = process.env.PORT ?? (new URL(apiUrl).port || '8787');
const webPort = new URL(webUrl).port || '3000';
const betterAuthUrl = `${webUrl}/api/auth`;

const definedProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
);

const webServerEnv: Record<string, string> = {
  ...definedProcessEnv,
  PORT: apiPort,
  API_INTERNAL_URL: apiUrl,
  WEB_PUBLIC_ORIGIN: webUrl,
  BETTER_AUTH_URL: betterAuthUrl,
  NEXT_PUBLIC_APP_URL: webUrl,
};

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: webUrl,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @qrew/api dev',
      cwd: ROOT_DIR,
      url: `${apiUrl}/api/health`,
      env: webServerEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @qrew/web exec next dev -p ${webPort}`,
      cwd: ROOT_DIR,
      url: webUrl,
      env: webServerEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
