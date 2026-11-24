import { redirect } from 'next/navigation';
import { getServerAccessContext, getServerTenants } from '@/lib/server-api';
import { TenantWorkspace } from './tenant-workspace';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const access = await getServerAccessContext();
  if (!access) {
    redirect('/login');
  }

  if (access.principalType === 'admin') {
    redirect('/admin');
  }

  const tenants = await getServerTenants();

  return <TenantWorkspace initialUser={access.user} initialTenants={tenants} />;
}
