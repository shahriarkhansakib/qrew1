# Qrew Domain Glossary

Canonical business and security vocabulary for Qrew. All modules, API contracts, database schemas, and ADRs must use these terms consistently.

---

### 1. Platform
- **Canonical definition:** The operator-managed Qrew SaaS system as a whole, spanning all customer Tenants, global configuration, and system-level governance.
- **Important distinctions:** Distinct from any individual **Tenant**; Platform operators govern SaaS operations and cross-tenant administration, not everyday tenant business workflows.
- **Implementation context:** `apps/api/src/modules/platform-admin/`, platform-scoped `ResourceScope` (`{ kind: 'platform' }`), and `platform_role_assignments`.

### 2. Authentication
- **Canonical definition:** The process of verifying *who* a human caller is via credentials or federated login and maintaining their active login session.
- **Important distinctions:** Establishes **Identity** only; Authentication never decides what a caller is permitted to do inside a Platform, Tenant, or Office (**Authorization**).
- **Implementation context:** Owned by `modules/authn` using Better Auth (`scrypt` passwords, Google OAuth config, email verification, password reset, TOTP `twoFactor`).

### 3. Authorization
- **Canonical definition:** The server-side evaluation of whether an authenticated actor holds the required **Permission** to perform a specific operation within a target **Scope**.
- **Important distinctions:** Separate from both **Authentication** (who you are) and **Entitlement** (whether a Tenant's paid plan includes a capability). Never bypassed by UI visibility.
- **Implementation context:** Owned by `modules/authz` via `AuthorizationEngine` (`AuthorizationEnginePort.authorize()`), returning an `AuthorizationDecision` proof object.

### 4. Identity
- **Canonical definition:** The verified security principal representing a caller across a single request after **Authentication** succeeds.
- **Important distinctions:** Carries minimal global identity facts (`userId`, `sessionId`, `email`, `name`, `emailVerified`, `mfaEnabled`)—never Tenant IDs, Office IDs, roles, or cached permission lists.
- **Implementation context:** `AuthenticatedIdentity` defined in `apps/api/src/modules/authn/domain/identity.ts` and resolved by `SessionResolverPort`.

### 5. User
- **Canonical definition:** A global person registered in Qrew with top-level **Principal Type** `user` (customer) or `admin` (platform operator); in B2B workflows, "User" refers specifically to a customer account participating in zero, one, or multiple Tenants.
- **Important distinctions:** Top-level principals are strictly partitioned into **`admin`** (internal Qrew platform staff governed by `platform_role_assignments`) and **`user`** (B2B customers belonging to Tenants/Offices). Upgrading a clean account to `admin` removes all access to customer tenant/office workspaces, and accounts with existing **Tenant memberships** cannot be promoted to `admin`. Also distinct from a Better Auth `account` (credential/OAuth provider binding).
- **Implementation context:** Identity stored in Better Auth tables (`user`, `account`, `session`); top-level `principalType: 'admin' | 'user'` resolved dynamically by `AuthorizationEngine.resolveAccessContext()` (`GET /api/v1/access-context`).

### 6. Tenant
- **Canonical definition:** An isolated B2B customer organization subscribing to Qrew as its private workspace boundary.
- **Important distinctions:** A Tenant is the primary data-isolation boundary; all business entities, memberships, offices, and tenant-custom roles belong to exactly one Tenant. Never use "account" to mean Tenant.
- **Implementation context:** `tenants` table (`modules/tenancy`) with unique `slug` and `status` (`active | suspended`).

### 7. Tenant membership
- **Canonical definition:** The formal relationship linking a **User** to a **Tenant** together with a tenant-level **Role** and lifecycle status.
- **Important distinctions:** Required before a User can access any resource or **Office** within that Tenant. Changing or revoking a Tenant membership takes effect immediately in **Authorization** without terminating the User's global login session across other Tenants.
- **Implementation context:** `tenant_memberships` (`unique(tenant_id, user_id)`, `unique(tenant_id, id)`, status `active | suspended | revoked`).

### 8. Tenant Owner
- **Canonical definition:** The founding or highest-authority tenant-scoped **Role** granted full administrative control over a specific **Tenant**, its offices, and its memberships.
- **Important distinctions:** Scoped strictly to a single **Tenant**—a Tenant Owner has zero **Platform** privileges and zero access to other Tenants. Distinct from Platform `super_admin` and `platform_admin`.
- **Implementation context:** System role `tenant_owner` seeded in `roles`/`role_permissions`, automatically granted to the creator inside the `CreateTenantUseCase` transaction.

### 9. Office
- **Canonical definition:** A distinct operational branch, location, or organizational workspace operating inside a single **Tenant**.
- **Important distinctions:** An Office always belongs to exactly one Tenant and is isolated from other Tenants via composite database foreign keys. Distinct from **Tenant** (top-level customer organization) and **Department** (functional sub-unit).
- **Implementation context:** `offices` table (`unique(tenant_id, id)`, unique `(tenant_id, slug)`, status `active | archived`).

### 10. Office membership
- **Canonical definition:** An explicit **Office**-scoped relationship linking a **Tenant membership** to a specific **Office** within the same **Tenant** under an office **Role**.
- **Important distinctions:** Requires an active parent **Tenant membership** in the owning Tenant; cannot link a User directly to an Office across Tenant boundaries.
- **Implementation context:** Represented in schema by `office_assignments` (`modules/tenancy`), bound by composite foreign keys `(tenant_id, office_id) -> offices(tenant_id, id)` and `(tenant_id, membership_id) -> tenant_memberships(tenant_id, id)`.

### 11. Department
- **Canonical definition:** A functional team or organizational division (such as Finance, Operations, or HR) inside an **Office** or **Tenant** used to structure people and workflows.
- **Important distinctions:** Represents functional structure rather than the top-level legal/billing customer boundary (**Tenant**) or physical/branch boundary (**Office**).
- **Implementation context:** *Planned domain entity* for upcoming organization-structure milestones; not yet added to database migrations.

### 12. Role
- **Canonical definition:** A named collection of **Permissions** assignable to a User or Membership at a defined **Scope** (`platform`, `tenant`, or `office`).
- **Important distinctions:** Roles group permissions for manageability; authorization checks always verify specific **Permissions** in a **Scope**, rather than hardcoding role names inside feature handlers.
- **Implementation context:** `roles` and `role_permissions` tables (`isSystem`, `scopeType`, optional `tenantId`), plus `PLATFORM_ROLE_PERMISSIONS` (`super_admin`, `platform_admin`) and `SYSTEM_ROLE_DEFINITIONS` (`tenant_owner`, `tenant_admin`, `office_manager`, `office_member`).

### 13. Permission
- **Canonical definition:** An atomic capability token naming a concrete allowed action on a domain resource (for example, `office:create` or `platform:admins:manage`).
- **Important distinctions:** Governs actor authority (**Authorization**), not commercial plan availability (**Entitlement**).
- **Implementation context:** Typed `PERMISSIONS` registry and `Permission` union in `apps/api/src/modules/authz/domain/policy.ts`.

### 14. Scope
- **Canonical definition:** The explicit organizational boundary within which an **Authorization** decision is evaluated: `platform`, `tenant`, or `office`.
- **Important distinctions:** A Permission granted in one Tenant or Office **Scope** never authorizes access to a different Tenant or Office. `platform` scope evaluates platform governance only and enforces verified email plus active MFA.
- **Implementation context:** Discriminated union `ResourceScope` in `apps/api/src/modules/authz/domain/policy.ts`.

### 15. Subscription
- **Canonical definition:** A **Tenant**'s commercial agreement governing plan tier, billing cycle, status, and **Entitlements**.
- **Important distinctions:** Attached to a **Tenant**, not an individual **User**. Billing state restricts plan features/quotas separately from **Role**/**Permission** checks.
- **Implementation context:** *Planned billing/entitlements subsystem*; keep strictly separated from `modules/authz` when introduced.

### 16. Entitlement
- **Canonical definition:** A plan-derived feature flag or quantitative usage limit (such as maximum active offices or custom workflow quotas) enabled for a **Tenant** by its **Subscription**.
- **Important distinctions:** An Entitlement states what a Tenant *paid for* (`plan allows up to N offices`), whereas a **Permission** states what an actor *is allowed to do* (`user can create offices`). Both must be checked independently where applicable.
- **Implementation context:** *Planned billing/entitlements capability*; must remain decoupled from `AuthorizationEngine`.

### 17. Invitation
- **Canonical definition:** A time-bounded, revocable offer allowing a recipient email address to join a specific **Tenant** (and optionally pre-assigned **Office** and **Role**) after verifying ownership of that email.
- **Important distinctions:** Not an active **Tenant membership** until accepted and validated server-side; an unaccepted Invitation confers zero Tenant or Office access.
- **Implementation context:** *Planned onboarding feature* for upcoming membership milestones; not yet added to database migrations.

### 18. Audit event
- **Canonical definition:** An immutable record capturing who performed a security-sensitive or state-changing action, within which **Scope**, against what target, and when.
- **Important distinctions:** Audit events are compliance/security evidence written transactionally alongside mutations (or explicitly persisted on rejected privilege operations such as rejected Super Admin bootstrap attempts), never overwritten or deleted by normal operations.
- **Implementation context:** `audit_logs` table (`modules/authz`) written via `AuditLogPort` / `DrizzleAuditRepository` using the active `UnitOfWork` transaction where changes must commit atomically.
