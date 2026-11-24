import { redirect } from 'next/navigation';
import {
  getServerAccessContext,
  getServerPlatformAdmins,
  getServerPlatformStatus,
} from '@/lib/server-api';
import { AdminMfaGate } from './admin-mfa-gate';
import { PlatformAdminPanel } from './platform-admin-panel';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const access = await getServerAccessContext();
  if (!access) {
    redirect('/login');
  }

  if (access.principalType !== 'admin') {
    redirect('/dashboard');
  }

  if (access.mfaRequired) {
    return <AdminMfaGate user={access.user} roleKey={access.platformRoleKey ?? 'platform_admin'} />;
  }

  const [status, admins] = await Promise.all([
    getServerPlatformStatus(),
    getServerPlatformAdmins(),
  ]);

  return (
    <PlatformAdminPanel
      initialUser={access.user}
      initialStatus={status}
      initialAdmins={admins}
      initialRequirePlatformMfa={access.requirePlatformMfa}
      roleKey={access.platformRoleKey ?? 'platform_admin'}
    />
  );
}
