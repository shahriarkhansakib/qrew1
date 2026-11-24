export type UserId = string & { readonly __brand: 'UserId' };
export type SessionId = string & { readonly __brand: 'SessionId' };

export function asUserId(value: string): UserId {
  return value as UserId;
}

export function asSessionId(value: string): SessionId {
  return value as SessionId;
}

/**
 * Minimal verified principal emitted by Authentication (Better Auth).
 * Contains zero authorization roles, tenant claims, or network telemetry.
 */
export interface AuthenticatedIdentity {
  readonly userId: UserId;
  readonly sessionId: SessionId;
  readonly email: string;
  readonly name: string;
  readonly emailVerified: boolean;
  readonly mfaEnabled: boolean;
}

export interface SessionResolverPort {
  resolveIdentity(headers: Headers): Promise<AuthenticatedIdentity | null>;
  requireIdentity(
    headers: Headers,
    options?: { readonly requireVerifiedEmail?: boolean },
  ): Promise<AuthenticatedIdentity>;
}

export interface AuthUserSummary {
  readonly id: UserId;
  readonly email: string;
  readonly name: string;
  readonly emailVerified: boolean;
  readonly mfaEnabled: boolean;
}

export interface AuthUserLookupPort {
  findByEmail(email: string): Promise<AuthUserSummary | null>;
  findById(userId: UserId): Promise<AuthUserSummary | null>;
  findByIds(userIds: readonly UserId[]): Promise<ReadonlyMap<UserId, AuthUserSummary>>;
  revokeAllSessionsForUser(userId: UserId): Promise<void>;
}
