import type { AuditLogPort } from '../../../shared/audit.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors.js';
import type { UnitOfWorkPort } from '../../../shared/unit-of-work.js';
import type { AuthUserLookupPort } from '../../authn/index.js';
import type { AuthzRepositoryPort, TenantScopeMembershipLookupPort } from '../../authz/index.js';
import {
  type BootstrapSuperAdminResult,
  SUPER_ADMIN_BOOTSTRAP_LOCK_KEY,
} from '../domain/bootstrap.js';

export class BootstrapSuperAdminUseCase {
  constructor(
    private readonly userLookup: AuthUserLookupPort,
    private readonly authzRepo: AuthzRepositoryPort,
    private readonly membershipLookup: TenantScopeMembershipLookupPort,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly auditLog: AuditLogPort,
  ) {}

  async execute(input: { readonly email: string }): Promise<BootstrapSuperAdminResult> {
    const normalizedEmail = input.email.trim().toLowerCase();

    return this.unitOfWork.executeWithAdvisoryLock(SUPER_ADMIN_BOOTSTRAP_LOCK_KEY, async (tx) => {
      const user = await this.userLookup.findByEmail(normalizedEmail);
      if (!user) {
        throw new NotFoundError(
          'USER_NOT_FOUND',
          `No registered user exists with email: ${normalizedEmail}`,
        );
      }

      if (!user.emailVerified) {
        await this.auditLog.record({
          actorUserId: null,
          scopeType: 'platform',
          action: 'platform.super_admin.bootstrap_rejected',
          targetType: 'user',
          targetId: user.id,
          metadata: { reason: 'email_not_verified', email: user.email },
        });
        throw new ForbiddenError(
          'EMAIL_NOT_VERIFIED',
          'Initial Super Admin account must verify its email address before bootstrap promotion',
        );
      }

      const existingSuperAdmin = await this.authzRepo.findActiveSuperAdmin(tx);
      if (existingSuperAdmin) {
        if (existingSuperAdmin.userId === user.id) {
          return {
            status: 'already_bootstrapped',
            userId: user.id,
            email: user.email,
          };
        }

        await this.auditLog.record({
          actorUserId: null,
          scopeType: 'platform',
          action: 'platform.super_admin.bootstrap_rejected',
          targetType: 'user',
          targetId: user.id,
          metadata: {
            reason: 'super_admin_already_exists',
            existingSuperAdminUserId: existingSuperAdmin.userId,
          },
        });
        throw new ConflictError(
          'SUPER_ADMIN_ALREADY_EXISTS',
          'An active initial Super Admin already exists. Subsequent admins must be provisioned by an authorized platform administrator.',
        );
      }

      const existingUserAssignment = await this.authzRepo.findPlatformAssignmentByUserId(
        user.id,
        tx,
      );
      if (existingUserAssignment) {
        throw new ConflictError(
          'PLATFORM_ASSIGNMENT_EXISTS',
          'Target user already holds a platform role assignment',
        );
      }

      const hasTenantMemberships = await this.membershipLookup.hasAnyTenantMembership(user.id, tx);
      if (hasTenantMemberships) {
        await this.auditLog.record({
          actorUserId: null,
          scopeType: 'platform',
          action: 'platform.super_admin.bootstrap_rejected',
          targetType: 'user',
          targetId: user.id,
          metadata: {
            reason: 'user_has_tenant_memberships',
            email: user.email,
          },
        });
        throw new ConflictError(
          'USER_HAS_TENANT_MEMBERSHIPS',
          'Users with existing tenant memberships cannot be promoted to platform admin. Register a dedicated admin account.',
        );
      }

      await this.authzRepo.insertPlatformAssignment(
        {
          userId: user.id,
          roleKey: 'super_admin',
          grantedByUserId: null,
        },
        tx,
      );

      await this.auditLog.record(
        {
          actorUserId: user.id,
          scopeType: 'platform',
          action: 'platform.super_admin.bootstrapped',
          targetType: 'user',
          targetId: user.id,
          metadata: { email: user.email, mechanism: 'server_cli_bootstrap' },
        },
        tx,
      );

      return {
        status: 'bootstrapped',
        userId: user.id,
        email: user.email,
      };
    });
  }
}
