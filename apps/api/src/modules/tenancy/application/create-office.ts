import type { AuditLogPort } from '../../../shared/audit.js';
import { ConflictError } from '../../../shared/errors.js';
import type { UnitOfWorkPort } from '../../../shared/unit-of-work.js';
import type { AuthorizationDecision, TenantId } from '../../authz/index.js';
import type { OfficeEntity, TenancyRepositoryPort } from '../domain/tenancy.js';

export class CreateOfficeUseCase {
  constructor(
    private readonly tenancyRepo: TenancyRepositoryPort,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly auditLog: AuditLogPort,
  ) {}

  async execute(input: {
    readonly decision: AuthorizationDecision<{
      readonly kind: 'tenant';
      readonly tenantId: TenantId;
    }>;
    readonly name: string;
    readonly slug: string;
  }): Promise<OfficeEntity> {
    const tenantId = input.decision.scope.tenantId;
    const normalizedSlug = input.slug.trim().toLowerCase();
    const trimmedName = input.name.trim();

    return this.unitOfWork.execute(async (tx) => {
      const existing = await this.tenancyRepo.findOfficeBySlug(tenantId, normalizedSlug, tx);
      if (existing) {
        throw new ConflictError(
          'OFFICE_SLUG_TAKEN',
          `Office slug '${normalizedSlug}' already exists in this tenant`,
        );
      }

      const office = await this.tenancyRepo.insertOffice(
        {
          tenantId,
          name: trimmedName,
          slug: normalizedSlug,
        },
        tx,
      );

      await this.auditLog.record(
        {
          actorUserId: input.decision.actorUserId,
          tenantId,
          officeId: office.id,
          scopeType: 'office',
          action: 'office.created',
          targetType: 'office',
          targetId: office.id,
          metadata: { slug: office.slug },
        },
        tx,
      );

      return office;
    });
  }
}
