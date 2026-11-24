import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import type { AppDatabase } from '../../../db/client.js';
import type { EmailOutboundPort } from '../../../shared/email-port.js';
import type { AppEnv } from '../../../shared/env.js';
import { ForbiddenError, UnauthorizedError } from '../../../shared/errors.js';
import { generateId } from '../../../shared/id.js';
import type { AppLogger } from '../../../shared/logger.js';
import {
  type AuthenticatedIdentity,
  asSessionId,
  asUserId,
  type SessionResolverPort,
} from '../domain/identity.js';
import {
  authAccounts,
  authRateLimits,
  authSessions,
  authTwoFactors,
  authUsers,
  authVerifications,
} from './schema.js';

export interface CreateBetterAuthDeps {
  readonly db: AppDatabase;
  readonly env: AppEnv;
  readonly emailPort: EmailOutboundPort;
  readonly logger: AppLogger;
  readonly enableRateLimit?: boolean;
}

export function createBetterAuth(deps: CreateBetterAuthDeps) {
  const { db, env, emailPort, logger } = deps;

  return betterAuth({
    appName: 'Qrew',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.WEB_PUBLIC_ORIGIN, env.API_INTERNAL_URL],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
        twoFactor: authTwoFactors,
        rateLimit: authRateLimits,
      },
    }),
    advanced: {
      cookiePrefix: 'qrew',
      useSecureCookies: env.NODE_ENV === 'production',
      disableOriginCheck: false,
      database: {
        generateId: () => generateId(),
      },
    },
    session: {
      cookieCache: {
        enabled: false,
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await emailPort.sendEmail({
          to: user.email,
          subject: 'Reset your Qrew password',
          text: `Reset your Qrew password using this link: ${url}`,
          html: `<p>Reset your Qrew password using this link: <a href="${url}">${url}</a></p>`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await emailPort.sendEmail({
          to: user.email,
          subject: 'Verify your Qrew email address',
          text: `Verify your Qrew email address using this link: ${url}`,
          html: `<p>Verify your Qrew email address: <a href="${url}">${url}</a></p>`,
        });
      },
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    rateLimit: {
      enabled: deps.enableRateLimit ?? env.NODE_ENV === 'production',
      storage: 'database',
    },
    logger: {
      disabled: env.NODE_ENV === 'test',
      log: (level, message, ...args) => {
        if (level === 'error') {
          logger.error({ module: 'better-auth', args }, message);
        } else if (level === 'warn') {
          logger.warn({ module: 'better-auth', args }, message);
        } else {
          logger.info({ module: 'better-auth', args }, message);
        }
      },
    },
    plugins: [
      twoFactor({
        issuer: 'Qrew',
      }),
    ],
  });
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;

export class BetterAuthSessionResolver implements SessionResolverPort {
  constructor(private readonly auth: BetterAuthInstance) {}

  async resolveIdentity(headers: Headers): Promise<AuthenticatedIdentity | null> {
    const disableCookieRefresh = headers.get('x-qrew-rsc-prefetch') === '1';
    const result = await this.auth.api.getSession({
      headers,
      query: disableCookieRefresh ? { disableRefresh: true } : undefined,
    });

    if (!result) {
      return null;
    }

    return {
      userId: asUserId(result.user.id),
      sessionId: asSessionId(result.session.id),
      email: result.user.email,
      name: result.user.name,
      emailVerified: Boolean(result.user.emailVerified),
      mfaEnabled: Boolean((result.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled),
    };
  }

  async requireIdentity(
    headers: Headers,
    options?: { readonly requireVerifiedEmail?: boolean },
  ): Promise<AuthenticatedIdentity> {
    const identity = await this.resolveIdentity(headers);
    if (!identity) {
      throw new UnauthorizedError('UNAUTHORIZED', 'Authentication is required');
    }

    if (options?.requireVerifiedEmail && !identity.emailVerified) {
      throw new ForbiddenError('EMAIL_NOT_VERIFIED', 'Verified email address is required');
    }

    return identity;
  }
}
