import type { Pool } from 'pg';
import {
  type AppDatabase,
  createDatabase,
  DrizzleAuditRepository,
  DrizzleUnitOfWork,
} from '../db/client.js';
import type { AuthUserLookupPort, SessionResolverPort } from '../modules/authn/index.js';
import {
  type BetterAuthInstance,
  BetterAuthSessionResolver,
  createBetterAuth,
} from '../modules/authn/infrastructure/better-auth.js';
import { DrizzleAuthUserDirectory } from '../modules/authn/infrastructure/user-directory-repository.js';
import {
  AuthorizationEngine,
  type AuthorizationEnginePort,
  type AuthzRepositoryPort,
} from '../modules/authz/index.js';
import { DrizzleAuthzRepository } from '../modules/authz/infrastructure/authz-repository.js';
import {
  BootstrapSuperAdminUseCase,
  ListPlatformAdminsUseCase,
  ProvisionPlatformAdminUseCase,
  UpdatePlatformSecuritySettingsUseCase,
} from '../modules/platform-admin/index.js';
import {
  CreateOfficeUseCase,
  CreateTenantUseCase,
  ListOfficesUseCase,
  ListUserTenantsUseCase,
} from '../modules/tenancy/index.js';
import { DrizzleTenancyRepository } from '../modules/tenancy/infrastructure/tenancy-repository.js';
import { type EmailOutboundPort, SmtpEmailAdapter } from '../shared/email-port.js';
import type { AppEnv } from '../shared/env.js';
import { type AppLogger, createLogger } from '../shared/logger.js';

export interface ContainerOverrides {
  readonly emailPort?: EmailOutboundPort;
  readonly enableRateLimit?: boolean;
  readonly defaultRequirePlatformMfa?: boolean;
}

export interface AppContainer {
  readonly env: AppEnv;
  readonly logger: AppLogger;
  readonly pool: Pool;
  readonly db: AppDatabase;
  readonly emailPort: EmailOutboundPort;
  readonly auth: BetterAuthInstance;
  readonly sessionResolver: SessionResolverPort;
  readonly userDirectory: AuthUserLookupPort;
  readonly authzRepo: AuthzRepositoryPort;
  readonly authorizationEngine: AuthorizationEnginePort;
  readonly tenancyRepo: DrizzleTenancyRepository;
  readonly bootstrapSuperAdmin: BootstrapSuperAdminUseCase;
  readonly provisionPlatformAdmin: ProvisionPlatformAdminUseCase;
  readonly listPlatformAdmins: ListPlatformAdminsUseCase;
  readonly updatePlatformSecuritySettings: UpdatePlatformSecuritySettingsUseCase;
  readonly createTenant: CreateTenantUseCase;
  readonly listUserTenants: ListUserTenantsUseCase;
  readonly createOffice: CreateOfficeUseCase;
  readonly listOffices: ListOfficesUseCase;
  close(): Promise<void>;
}

export function createContainer(env: AppEnv, overrides: ContainerOverrides = {}): AppContainer {
  const logger = createLogger(env);
  const { pool, db } = createDatabase(env.DATABASE_URL);
  const unitOfWork = new DrizzleUnitOfWork(db);
  const auditLog = new DrizzleAuditRepository(db);

  const emailPort =
    overrides.emailPort ??
    new SmtpEmailAdapter({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      from: env.SMTP_FROM,
    });

  const auth = createBetterAuth({
    db,
    env,
    emailPort,
    logger,
    enableRateLimit: overrides.enableRateLimit,
  });

  const sessionResolver = new BetterAuthSessionResolver(auth);
  const userDirectory = new DrizzleAuthUserDirectory(db);
  const authzRepo = new DrizzleAuthzRepository(db);
  const tenancyRepo = new DrizzleTenancyRepository(db);

  const defaultRequirePlatformMfa =
    overrides.defaultRequirePlatformMfa ?? env.NODE_ENV !== 'development';

  const authorizationEngine = new AuthorizationEngine(authzRepo, tenancyRepo, {
    defaultRequirePlatformMfa,
  });

  const bootstrapSuperAdmin = new BootstrapSuperAdminUseCase(
    userDirectory,
    authzRepo,
    tenancyRepo,
    unitOfWork,
    auditLog,
  );
  const provisionPlatformAdmin = new ProvisionPlatformAdminUseCase(
    userDirectory,
    authzRepo,
    tenancyRepo,
    unitOfWork,
    auditLog,
  );
  const listPlatformAdmins = new ListPlatformAdminsUseCase(authzRepo, userDirectory);
  const updatePlatformSecuritySettings = new UpdatePlatformSecuritySettingsUseCase(
    authzRepo,
    unitOfWork,
    auditLog,
    defaultRequirePlatformMfa,
  );

  const createTenant = new CreateTenantUseCase(tenancyRepo, authzRepo, unitOfWork, auditLog);
  const listUserTenants = new ListUserTenantsUseCase(tenancyRepo, authzRepo);
  const createOffice = new CreateOfficeUseCase(tenancyRepo, unitOfWork, auditLog);
  const listOffices = new ListOfficesUseCase(tenancyRepo);

  return {
    env,
    logger,
    pool,
    db,
    emailPort,
    auth,
    sessionResolver,
    userDirectory,
    authzRepo,
    authorizationEngine,
    tenancyRepo,
    bootstrapSuperAdmin,
    provisionPlatformAdmin,
    listPlatformAdmins,
    updatePlatformSecuritySettings,
    createTenant,
    listUserTenants,
    createOffice,
    listOffices,
    close: async () => {
      await pool.end();
    },
  };
}
