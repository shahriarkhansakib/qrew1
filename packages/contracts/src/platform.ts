import { z } from 'zod';
import { AuthenticatedUserDtoSchema } from './auth.js';
import { UuidV7Schema } from './common.js';

export const PrincipalTypeSchema = z.enum(['admin', 'user']);
export type PrincipalType = z.infer<typeof PrincipalTypeSchema>;

export const PlatformRoleKeySchema = z.enum(['super_admin', 'platform_admin']);
export type PlatformRoleKeyDto = z.infer<typeof PlatformRoleKeySchema>;

export const AccessContextDtoSchema = z.object({
  principalType: PrincipalTypeSchema,
  platformRoleKey: PlatformRoleKeySchema.nullable(),
  requirePlatformMfa: z.boolean(),
  mfaRequired: z.boolean(),
  user: AuthenticatedUserDtoSchema,
});

export type AccessContextDto = z.infer<typeof AccessContextDtoSchema>;

export const PlatformStatusDtoSchema = z.object({
  status: z.literal('ok'),
  actorUserId: UuidV7Schema,
  roleKey: PlatformRoleKeySchema,
  totalTenants: z.number().int().nonnegative(),
  requirePlatformMfa: z.boolean(),
});

export type PlatformStatusDto = z.infer<typeof PlatformStatusDtoSchema>;

export const UpdatePlatformSecuritySettingsRequestSchema = z.object({
  requirePlatformMfa: z.boolean(),
});

export type UpdatePlatformSecuritySettingsRequest = z.infer<
  typeof UpdatePlatformSecuritySettingsRequestSchema
>;

export const PlatformSecuritySettingsDtoSchema = z.object({
  requirePlatformMfa: z.boolean(),
  updatedAt: z.string().nullable(),
});

export type PlatformSecuritySettingsDto = z.infer<typeof PlatformSecuritySettingsDtoSchema>;

export const ProvisionPlatformAdminRequestSchema = z.object({
  email: z.string().trim().email(),
  roleKey: z.enum(['platform_admin']),
});

export type ProvisionPlatformAdminRequest = z.infer<typeof ProvisionPlatformAdminRequestSchema>;

export const PlatformAdminAssignmentDtoSchema = z.object({
  id: UuidV7Schema,
  userId: UuidV7Schema,
  roleKey: PlatformRoleKeySchema,
  status: z.enum(['active', 'revoked']),
  createdAt: z.string(),
});

export type PlatformAdminAssignmentDto = z.infer<typeof PlatformAdminAssignmentDtoSchema>;

export const PlatformAdminListItemDtoSchema = z.object({
  id: UuidV7Schema,
  userId: UuidV7Schema,
  email: z.string().email(),
  name: z.string(),
  emailVerified: z.boolean(),
  mfaEnabled: z.boolean(),
  roleKey: PlatformRoleKeySchema,
  status: z.enum(['active', 'revoked']),
  createdAt: z.string(),
});

export type PlatformAdminListItemDto = z.infer<typeof PlatformAdminListItemDtoSchema>;
