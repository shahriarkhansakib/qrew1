import pino, { type Logger } from 'pino';
import type { AppEnv } from './env.js';

export type AppLogger = Logger;

export function createLogger(env: Pick<AppEnv, 'NODE_ENV' | 'LOG_LEVEL'>): AppLogger {
  return pino({
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'headers.cookie',
        'headers.authorization',
        '*.password',
        '*.passwordHash',
        '*.token',
        '*.secret',
        '*.accessToken',
        '*.refreshToken',
        '*.idToken',
        '*.twoFactorSecret',
        '*.backupCodes',
        'password',
        'token',
        'secret',
      ],
      censor: '[REDACTED]',
    },
  });
}
