import type {
  AccessContextDto,
  PlatformAdminListItemDto,
  PlatformStatusDto,
  SessionResponseDto,
  TenantWithRoleDto,
} from '@qrew/contracts';
import { cookies } from 'next/headers';

function getApiInternalUrl(): string {
  return process.env.API_INTERNAL_URL ?? 'http://localhost:8787';
}

async function getCookieHeader(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

async function fetchInternalGet(path: string, cookieHeader: string): Promise<Response | null> {
  try {
    return await fetch(`${getApiInternalUrl()}${path}`, {
      method: 'GET',
      headers: {
        cookie: cookieHeader,
        accept: 'application/json',
        'x-qrew-rsc-prefetch': '1',
      },
      cache: 'no-store',
    });
  } catch {
    return null;
  }
}

export async function getServerSession(): Promise<SessionResponseDto | null> {
  const cookieHeader = await getCookieHeader();
  if (!cookieHeader) {
    return null;
  }

  const res = await fetchInternalGet('/api/v1/me', cookieHeader);
  if (!res?.ok) {
    return null;
  }

  return (await res.json()) as SessionResponseDto;
}

export async function getServerAccessContext(): Promise<AccessContextDto | null> {
  const cookieHeader = await getCookieHeader();
  if (!cookieHeader) {
    return null;
  }

  const res = await fetchInternalGet('/api/v1/access-context', cookieHeader);
  if (!res?.ok) {
    return null;
  }

  return (await res.json()) as AccessContextDto;
}

export async function getServerTenants(): Promise<TenantWithRoleDto[]> {
  const cookieHeader = await getCookieHeader();
  if (!cookieHeader) {
    return [];
  }

  const res = await fetchInternalGet('/api/v1/tenants', cookieHeader);
  if (!res?.ok) {
    return [];
  }

  return (await res.json()) as TenantWithRoleDto[];
}

export async function getServerPlatformStatus(): Promise<PlatformStatusDto | null> {
  const cookieHeader = await getCookieHeader();
  if (!cookieHeader) {
    return null;
  }

  const res = await fetchInternalGet('/api/v1/platform/status', cookieHeader);
  if (!res?.ok) {
    return null;
  }

  return (await res.json()) as PlatformStatusDto;
}

export async function getServerPlatformAdmins(): Promise<PlatformAdminListItemDto[]> {
  const cookieHeader = await getCookieHeader();
  if (!cookieHeader) {
    return [];
  }

  const res = await fetchInternalGet('/api/v1/platform/admins', cookieHeader);
  if (!res?.ok) {
    return [];
  }

  return (await res.json()) as PlatformAdminListItemDto[];
}
