import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

let envLoaded = false;

export function loadEnvFiles(): void {
  if (envLoaded) return;
  envLoaded = true;
  const dirname =
    typeof import.meta.dirname === 'string'
      ? import.meta.dirname
      : path.resolve(process.cwd(), 'src/shared');
  dotenv.config({ path: path.resolve(dirname, '../../../../.env'), quiet: true });
  dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });
  dotenv.config({ quiet: true });
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url(),
  WEB_PUBLIC_ORIGIN: z.string().url(),
  API_INTERNAL_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  SMTP_HOST: z.string().min(1).default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(10259),
  SMTP_FROM: z.string().email().default('no-reply@qrew.local'),
  MAILPIT_API_URL: z.string().url().optional(),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export function loadEnv(): AppEnv {
  loadEnvFiles();
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid backend environment configuration: ${formatted}`);
  }
  return parsed.data;
}
