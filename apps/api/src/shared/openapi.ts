import type { ZodError } from 'zod';
import { ValidationError } from './errors.js';

type ValidationHookResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: ZodError };

export const openApiDefaultHook = (result: ValidationHookResult): undefined => {
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));
    throw new ValidationError('Request validation failed', details);
  }
  return undefined;
};
