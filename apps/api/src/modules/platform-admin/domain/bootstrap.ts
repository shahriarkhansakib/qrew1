export const SUPER_ADMIN_BOOTSTRAP_LOCK_KEY = 918273645;

export interface BootstrapSuperAdminResult {
  readonly status: 'bootstrapped' | 'already_bootstrapped';
  readonly userId: string;
  readonly email: string;
}
