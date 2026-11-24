import type { AuditLogPort } from '../../../shared/audit.js';
import { ConflictError, ForbiddenError } from '../../../shared/errors.js';
import type { UnitOfWorkPort } from '../../../shared/unit-of-work.js';
import type { AuthenticatedIdentity } from '../../authn/index.js';
import type { AuthzRepositoryPort } from '../../authz/index.js';
import type { TenancyRepositoryPort, TenantWithRole } from '../domain/tenancy.js';

export class CreateTenantUseCase {
  constructor(
    private readonly tenancyRepo: TenancyRepositoryPort,
    private readonly authzRepo: AuthzRepositoryPort,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly auditLog: AuditLogPort,
  ) {}

  async execute(input: {
    readonly identity: AuthenticatedIdentity;
    readonly name: string;
    readonly slug: string;
  }): Promise<TenantWithRole> {
    if (!input.identity.emailVerified) {
      throw new ForbiddenError(
        'EMAIL_NOT_VERIFIED',
        'Verified email address is required to create a tenant',
      );
    }

    const platformAssignment = await this.authzRepo.findActivePlatformAssignment(
      input.identity.userId,
    );
    if (platformAssignment) {
      throw new ForbiddenError(
        'PLATFORM_ADMIN_CUSTOMER_ACCESS_DENIED',
        'Platform administrators cannot access customer tenant workspaces',
      );
    }

    const normalizedSlug = input.slug.trim().toLowerCase();
    const trimmedName = input.name.trim();

    return this.unitOfWork.execute(async (tx) => {
      const existing = await this.tenancyRepo.findTenantBySlug(normalizedSlug, tx);
      if (existing) {
        throw new ConflictError(
          'TENANT_SLUG_TAKEN',
          `Tenant slug '${normalizedSlug}' already exists`,
        );
      }

      const systemRoles = await this.authzRepo.ensureSystemRolesSeeded(tx);
      const tenant = await this.tenancyRepo.insertTenant(
        { name: trimmedName, slug: normalizedSlug },
        tx,
      );

      const membership = await this.tenancyRepo.insertMembership(
        {
          tenantId: tenant.id,
          userId: input.identity.userId,
          roleId: systemRoles.tenant_owner,
          status: 'active',
        },
        tx,
      );

      await this.auditLog.record(
        {
          actorUserId: input.identity.userId,
          tenantId: tenant.id,
          scopeType: 'tenant',
          action: 'tenant.created',
          targetType: 'tenant',
          targetId: tenant.id,
          metadata: {
            slug: tenant.slug,
            ownerMembershipId: membership.id,
          },
        },
        tx,
      );

      return {
        ...tenant,
        roleKey: 'tenant_owner',
        membershipStatus: 'active',
      };
    });
  }
}
