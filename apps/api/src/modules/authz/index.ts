export {
  AuthorizationEngine,
  type AuthorizationEngineOptions,
} from './application/authorization-engine.js';
export {
  type AccessContext,
  type ActiveOfficeAccessRecord,
  type ActiveTenantMembershipRecord,
  type AuthorizationDecision,
  type AuthorizationEnginePort,
  type AuthzRepositoryPort,
  asOfficeId,
  asTenantId,
  type OfficeId,
  PERMISSIONS,
  type Permission,
  PLATFORM_ROLE_PERMISSIONS,
  type PlatformAssignmentRecord,
  type PlatformRoleKey,
  type PlatformSecuritySettingsRecord,
  type PrincipalType,
  type ResourceScope,
  SYSTEM_ROLE_DEFINITIONS,
  type SystemTenantRoleKey,
  type TenantId,
  type TenantScopeMembershipLookupPort,
} from './domain/policy.js';
export { createAccessContextRouter } from './http/access-context-routes.js';
export {
  type AuthzEnvVariables,
  createAuthorizeMiddleware,
  createRequireCustomerUserMiddleware,
} from './http/guard-middleware.js';
