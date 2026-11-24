import { z } from 'zod';
import { UuidV7Schema } from './common.js';

export const SlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(63)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Slug must contain lowercase letters, numbers, and single hyphens',
  );

export const CreateTenantRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: SlugSchema,
});

export type CreateTenantRequest = z.infer<typeof CreateTenantRequestSchema>;

export const TenantDtoSchema = z.object({
  id: UuidV7Schema,
  name: z.string(),
  slug: z.string(),
  status: z.enum(['active', 'suspended']),
  createdAt: z.string(),
});

export type TenantDto = z.infer<typeof TenantDtoSchema>;

export const TenantWithRoleDtoSchema = TenantDtoSchema.extend({
  roleKey: z.string(),
  membershipStatus: z.enum(['active', 'suspended', 'revoked']),
});

export type TenantWithRoleDto = z.infer<typeof TenantWithRoleDtoSchema>;

export const CreateOfficeRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: SlugSchema,
});

export type CreateOfficeRequest = z.infer<typeof CreateOfficeRequestSchema>;

export const OfficeDtoSchema = z.object({
  id: UuidV7Schema,
  tenantId: UuidV7Schema,
  name: z.string(),
  slug: z.string(),
  status: z.enum(['active', 'archived']),
  createdAt: z.string(),
});

export type OfficeDto = z.infer<typeof OfficeDtoSchema>;
