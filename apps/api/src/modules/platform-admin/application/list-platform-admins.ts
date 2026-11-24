import type { AuthUserLookupPort, UserId } from '../../authn/index.js';
import type { AuthzRepositoryPort, PlatformRoleKey } from '../../authz/index.js';

export interface PlatformAdminSummary {
  readonly id: string;
  readonly userId: UserId;
  readonly email: string;
  readonly name: string;
  readonly emailVerified: boolean;
  readonly mfaEnabled: boolean;
  readonly roleKey: PlatformRoleKey;
  readonly status: 'active' | 'revoked';
  readonly createdAt: Date;
}

export class ListPlatformAdminsUseCase {
  constructor(
    private readonly authzRepo: AuthzRepositoryPort,
    private readonly userLookup: AuthUserLookupPort,
  ) {}

  async execute(): Promise<readonly PlatformAdminSummary[]> {
    const assignments = await this.authzRepo.listPlatformAssignments();
    const userIds = assignments.map((assignment) => assignment.userId);
    const usersById = await this.userLookup.findByIds(userIds);

    const results: PlatformAdminSummary[] = [];
    for (const assignment of assignments) {
      const user = usersById.get(assignment.userId);
      if (!user) continue;

      results.push({
        id: assignment.id,
        userId: assignment.userId,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
        mfaEnabled: user.mfaEnabled,
        roleKey: assignment.roleKey,
        status: assignment.status,
        createdAt: assignment.createdAt,
      });
    }

    return results;
  }
}
