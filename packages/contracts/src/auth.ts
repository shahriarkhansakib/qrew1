import { z } from 'zod';
import { UuidV7Schema } from './common.js';

export const AuthenticatedUserDtoSchema = z.object({
  id: UuidV7Schema,
  email: z.string().email(),
  name: z.string(),
  emailVerified: z.boolean(),
  mfaEnabled: z.boolean(),
});

export type AuthenticatedUserDto = z.infer<typeof AuthenticatedUserDtoSchema>;

export const SessionResponseDtoSchema = z.object({
  authenticated: z.literal(true),
  user: AuthenticatedUserDtoSchema,
});

export type SessionResponseDto = z.infer<typeof SessionResponseDtoSchema>;
