import type { AuditLogPort } from '../../../shared/audit.js';
import { ConflictError } from '../../../shared/errors.js';
import type { UnitOfWorkPort } from '../../../shared/unit-of-work.js';
import type { AuthenticatedIdentity } from '../../authn/index.js';
import type {
  AuthorizationDecision,
  AuthzRepositoryPort,
  PlatformSecuritySettingsRecord,
} from '../../authz/index.js';

export class UpdatePlatformSecuritySettingsUseCase {
  constructor(
    private readonly authzRepo: AuthzRepositoryPort,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly auditLog: AuditLogPort,
    private readonly defaultRequirePlatformMfa: boolean,
  ) {}

  async execute(input: {
    readonly identity: AuthenticatedIdentity;
    readonly decision: AuthorizationDecision<{ readonly kind: 'platform' }>;
    readonly requirePlatformMfa: boolean;
  }): Promise<PlatformSecuritySettingsRecord> {
    if (input.requirePlatformMfa && !input.identity.mfaEnabled) {
      throw new ConflictError(
        'MFA_SETUP_REQUIRED_BEFORE_ENFORCEMENT',
        'Enable and verify your own 2FA authenticator before turning on the platform-wide 2FA requirement',
      );
    }

    return this.unitOfWork.execute(async (tx) => {
      const current = await this.authzRepo.findPlatformSecuritySettings(tx);
      const previousRequirePlatformMfa =
        current?.requirePlatformMfa ?? this.defaultRequirePlatformMfa;

      const updated = await this.authzRepo.upsertPlatformSecuritySettings(
        {
          requirePlatformMfa: input.requirePlatformMfa,
          updatedByUserId: input.decision.actorUserId,
        },
        tx,
      );

      await this.auditLog.record(
        {
          actorUserId: input.decision.actorUserId,
          scopeType: 'platform',
          action: 'platform.security.mfa_policy_updated',
          targetType: 'platform_security_settings',
          targetId: 'default',
          metadata: {
            previousRequirePlatformMfa,
            nextRequirePlatformMfa: updated.requirePlatformMfa,
          },
        },
        tx,
      );

      return updated;
    });
  }
}
