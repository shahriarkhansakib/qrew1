import type { AuthorizationDecision, TenantId } from '../../authz/index.js';
import type { OfficeEntity, TenancyRepositoryPort } from '../domain/tenancy.js';

export class ListOfficesUseCase {
  constructor(private readonly tenancyRepo: TenancyRepositoryPort) {}

  async execute(
    decision: AuthorizationDecision<{ readonly kind: 'tenant'; readonly tenantId: TenantId }>,
  ): Promise<readonly OfficeEntity[]> {
    return this.tenancyRepo.listOfficesByTenant(decision.scope.tenantId);
  }
}
