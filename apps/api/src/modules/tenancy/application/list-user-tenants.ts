import { ForbiddenError } from '../../../shared/errors.js';
import type { AuthenticatedIdentity } from '../../authn/index.js';
import type { AuthzRepositoryPort } from '../../authz/index.js';
import type { TenancyRepositoryPort, TenantWithRole } from '../domain/tenancy.js';

export class ListUserTenantsUseCase {
  constructor(
    private readonly tenancyRepo: TenancyRepositoryPort,
    private readonly authzRepo: AuthzRepositoryPort,
  ) {}

  async execute(identity: AuthenticatedIdentity): Promise<readonly TenantWithRole[]> {
    const platformAssignment = await this.authzRepo.findActivePlatformAssignment(identity.userId);
    if (platformAssignment) {
      throw new ForbiddenError(
        'PLATFORM_ADMIN_CUSTOMER_ACCESS_DENIED',
        'Platform administrators cannot access customer tenant workspaces',
      );
    }

    const memberships = await this.tenancyRepo.listTenantMembershipsForUser(identity.userId);
    const roleIds = [...new Set(memberships.map((m) => m.roleId))];
    const roleKeys = await this.authzRepo.findRoleKeysByIds(roleIds);

    return memberships.map((m) => ({
      id: m.id,
      name: m.name,
      slug: m.slug,
      status: m.status,
      createdAt: m.createdAt,
      roleKey: roleKeys.get(m.roleId) ?? 'unknown',
      membershipStatus: m.membershipStatus,
    }));
  }
}
