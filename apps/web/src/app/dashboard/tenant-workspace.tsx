'use client';

import type {
  ApiErrorResponse,
  AuthenticatedUserDto,
  OfficeDto,
  TenantWithRoleDto,
} from '@qrew/contracts';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';

interface TenantWorkspaceProps {
  readonly initialUser: AuthenticatedUserDto;
  readonly initialTenants: TenantWithRoleDto[];
}

function toSlugSuggestion(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as Partial<ApiErrorResponse>;
    return payload.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function TenantWorkspace({ initialUser, initialTenants }: TenantWorkspaceProps) {
  const router = useRouter();
  const [tenants, setTenants] = useState<TenantWithRoleDto[]>(initialTenants);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(
    initialTenants[0]?.id ?? null,
  );
  const [offices, setOffices] = useState<OfficeDto[]>([]);
  const [loadingOffices, setLoadingOffices] = useState(false);

  const [tenantName, setTenantName] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [tenantSlugTouched, setTenantSlugTouched] = useState(false);
  const [submittingTenant, setSubmittingTenant] = useState(false);

  const [officeName, setOfficeName] = useState('');
  const [officeSlug, setOfficeSlug] = useState('');
  const [officeSlugTouched, setOfficeSlugTouched] = useState(false);
  const [submittingOffice, setSubmittingOffice] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId) ?? null;

  useEffect(() => {
    if (!selectedTenantId) {
      setOffices([]);
      return;
    }

    let cancelled = false;
    setLoadingOffices(true);

    async function loadOffices(tenantId: string) {
      try {
        const res = await fetch(`/api/v1/tenants/${tenantId}/offices`, {
          method: 'GET',
          credentials: 'same-origin',
        });

        if (!res.ok) {
          if (!cancelled) {
            const msg = await readErrorMessage(res, 'Unable to load tenant offices');
            setErrorMessage(msg);
            setOffices([]);
          }
          return;
        }

        const data = (await res.json()) as OfficeDto[];
        if (!cancelled) {
          setOffices(data);
        }
      } catch {
        if (!cancelled) {
          setErrorMessage('Network error while loading offices');
        }
      } finally {
        if (!cancelled) {
          setLoadingOffices(false);
        }
      }
    }

    void loadOffices(selectedTenantId);
    return () => {
      cancelled = true;
    };
  }, [selectedTenantId]);

  async function handleSignOut() {
    await authClient.signOut();
    router.push('/login');
    router.refresh();
  }

  async function handleCreateTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingTenant(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/v1/tenants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: tenantName.trim(),
          slug: tenantSlug.trim().toLowerCase(),
        }),
      });

      if (!res.ok) {
        setErrorMessage(await readErrorMessage(res, 'Failed to create tenant'));
        return;
      }

      const created = (await res.json()) as TenantWithRoleDto;
      setTenants((prev) => [...prev, created]);
      setSelectedTenantId(created.id);
      setTenantName('');
      setTenantSlug('');
      setTenantSlugTouched(false);
    } catch {
      setErrorMessage('Network error while creating tenant');
    } finally {
      setSubmittingTenant(false);
    }
  }

  async function handleCreateOffice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTenantId) return;

    setSubmittingOffice(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/v1/tenants/${selectedTenantId}/offices`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: officeName.trim(),
          slug: officeSlug.trim().toLowerCase(),
        }),
      });

      if (!res.ok) {
        setErrorMessage(await readErrorMessage(res, 'Failed to create office'));
        return;
      }

      const created = (await res.json()) as OfficeDto;
      setOffices((prev) => [...prev, created]);
      setOfficeName('');
      setOfficeSlug('');
      setOfficeSlugTouched(false);
    } catch {
      setErrorMessage('Network error while creating office');
    } finally {
      setSubmittingOffice(false);
    }
  }

  return (
    <main className="qrew-container">
      <header
        className="qrew-card"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Qrew Workspace</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.95rem' }} data-testid="user-email">
            Signed in as <strong>{initialUser.email}</strong>
          </p>
        </div>
        <button type="button" className="qrew-btn qrew-btn-secondary" onClick={handleSignOut}>
          Sign out
        </button>
      </header>

      {errorMessage ? (
        <div role="alert" className="qrew-alert-error">
          {errorMessage}
        </div>
      ) : null}

      <div className="qrew-grid">
        <section className="qrew-card">
          <h2>Tenants</h2>
          {tenants.length === 0 ? (
            <p>No tenants yet. Create your first organization below.</p>
          ) : (
            <ul
              data-testid="tenant-list"
              style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.5rem' }}
            >
              {tenants.map((tenant) => {
                const isSelected = tenant.id === selectedTenantId;
                return (
                  <li key={tenant.id}>
                    <button
                      type="button"
                      data-testid={`tenant-item-${tenant.slug}`}
                      data-tenant-id={tenant.id}
                      className={isSelected ? 'qrew-btn' : 'qrew-btn qrew-btn-secondary'}
                      style={{
                        width: '100%',
                        justifyContent: 'space-between',
                        gap: '0.5rem',
                      }}
                      onClick={() => {
                        setErrorMessage(null);
                        setSelectedTenantId(tenant.id);
                      }}
                    >
                      <span>{tenant.name}</span>
                      <span className="qrew-badge">{tenant.roleKey}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <h3 style={{ marginTop: '1.5rem' }}>Create tenant</h3>
          <form onSubmit={handleCreateTenant} className="qrew-form">
            <div className="qrew-field">
              <label htmlFor="tenant-name">Tenant name</label>
              <input
                id="tenant-name"
                name="tenantName"
                type="text"
                required
                minLength={2}
                value={tenantName}
                onChange={(e) => {
                  const next = e.target.value;
                  setTenantName(next);
                  if (!tenantSlugTouched) {
                    setTenantSlug(toSlugSuggestion(next));
                  }
                }}
                placeholder="Acme Global"
              />
            </div>

            <div className="qrew-field">
              <label htmlFor="tenant-slug">Tenant slug</label>
              <input
                id="tenant-slug"
                name="tenantSlug"
                type="text"
                required
                minLength={2}
                value={tenantSlug}
                onChange={(e) => {
                  setTenantSlugTouched(true);
                  setTenantSlug(e.target.value);
                }}
                placeholder="acme-global"
              />
            </div>

            <button type="submit" className="qrew-btn" disabled={submittingTenant}>
              {submittingTenant ? 'Creating tenant...' : 'Create tenant'}
            </button>
          </form>
        </section>

        <section className="qrew-card">
          <h2>Offices</h2>
          {!selectedTenant ? (
            <p>Select or create a tenant to manage its offices.</p>
          ) : (
            <>
              <p style={{ fontSize: '0.9rem', marginTop: 0 }}>
                Active tenant: <strong>{selectedTenant.name}</strong> (
                <code data-testid="active-tenant-id">{selectedTenant.id}</code>) · Role:{' '}
                <span className="qrew-badge" data-testid="active-tenant-role">
                  {selectedTenant.roleKey}
                </span>
              </p>

              {loadingOffices ? (
                <p>Loading offices...</p>
              ) : offices.length === 0 ? (
                <p>No offices yet in this tenant.</p>
              ) : (
                <ul data-testid="office-list" style={{ paddingLeft: '1.25rem' }}>
                  {offices.map((office) => (
                    <li key={office.id} data-testid={`office-item-${office.slug}`}>
                      <strong>{office.name}</strong> (<code>{office.slug}</code>) ·{' '}
                      <span className="qrew-badge">{office.status}</span>
                    </li>
                  ))}
                </ul>
              )}

              <h3 style={{ marginTop: '1.5rem' }}>Create office</h3>
              <form onSubmit={handleCreateOffice} className="qrew-form">
                <div className="qrew-field">
                  <label htmlFor="office-name">Office name</label>
                  <input
                    id="office-name"
                    name="officeName"
                    type="text"
                    required
                    minLength={2}
                    value={officeName}
                    onChange={(e) => {
                      const next = e.target.value;
                      setOfficeName(next);
                      if (!officeSlugTouched) {
                        setOfficeSlug(toSlugSuggestion(next));
                      }
                    }}
                    placeholder="Dhaka HQ"
                  />
                </div>

                <div className="qrew-field">
                  <label htmlFor="office-slug">Office slug</label>
                  <input
                    id="office-slug"
                    name="officeSlug"
                    type="text"
                    required
                    minLength={2}
                    value={officeSlug}
                    onChange={(e) => {
                      setOfficeSlugTouched(true);
                      setOfficeSlug(e.target.value);
                    }}
                    placeholder="dhaka-hq"
                  />
                </div>

                <button type="submit" className="qrew-btn" disabled={submittingOffice}>
                  {submittingOffice ? 'Creating office...' : 'Create office'}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
