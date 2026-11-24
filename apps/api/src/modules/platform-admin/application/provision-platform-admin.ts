import type { AuditLogPort } from '../../../shared/audit.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors.js';
import type { UnitOfWorkPort } from '../../../shared/unit-of-work.js';
import type { AuthUserLookupPort } from '../../authn/index.js';
import type {
  AuthorizationDecision,
  AuthzRepositoryPort,
  PlatformAssignmentRecord,
  TenantScopeMembershipLookupPort,
} from '../../authz/index.js';

export class ProvisionPlatformAdminUseCase {
  constructor(
    private readonly userLookup: AuthUserLookupPort,
    private readonly authzRepo: AuthzRepositoryPort,
    private readonly membershipLookup: TenantScopeMembershipLookupPort,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly auditLog: AuditLogPort,
  ) {}

  async execute(input: {
    readonly decision: AuthorizationDecision<{ readonly kind: 'platform' }>;
    readonly email: string;
    readonly roleKey: 'platform_admin';
  }): Promise<PlatformAssignmentRecord> {
    const normalizedEmail = input.email.trim().toLowerCase();

    return this.unitOfWork.execute(async (tx) => {
      const targetUser = await this.userLookup.findByEmail(normalizedEmail);
      if (!targetUser) {
        throw new NotFoundError('USER_NOT_FOUND', 'Target user was not found');
      }

      if (!targetUser.emailVerified) {
        throw new ForbiddenError(
          'EMAIL_NOT_VERIFIED',
          'Target user must verify their email before platform admin provisioning',
        );
      }

      const existing = await this.authzRepo.findPlatformAssignmentByUserId(targetUser.id, tx);
      if (existing) {
        throw new ConflictError(
          'PLATFORM_ASSIGNMENT_EXISTS',
          'Target user already has a platform role assignment',
        );
      }

      const hasTenantMemberships = await this.membershipLookup.hasAnyTenantMembership(
        targetUser.id,
        tx,
      );
      if (hasTenantMemberships) {
        await this.auditLog.record({
          actorUserId: input.decision.actorUserId,
          scopeType: 'platform',
          action: 'platform.admin.provision_rejected',
          targetType: 'user',
          targetId: targetUser.id,
          metadata: {
            reason: 'user_has_tenant_memberships',
            targetEmail: targetUser.email,
          },
        });
        throw new ConflictError(
          'USER_HAS_TENANT_MEMBERSHIPS',
          'Users with existing tenant memberships cannot be promoted to platform admin. Register a dedicated admin account.',
        );
      }

      const created = await this.authzRepo.insertPlatformAssignment(
        {
          userId: targetUser.id,
          roleKey: input.roleKey,
          grantedByUserId: input.decision.actorUserId,
        },
        tx,
      );

      await this.auditLog.record(
        {
          actorUserId: input.decision.actorUserId,
          scopeType: 'platform',
          action: 'platform.admin.provisioned',
          targetType: 'platform_role_assignment',
          targetId: created.id,
          metadata: {
            targetUserId: targetUser.id,
            roleKey: input.roleKey,
          },
        },
        tx,
      );

      return created;
    });
  }
}
