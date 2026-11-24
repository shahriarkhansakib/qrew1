'use client';

import type {
  ApiErrorResponse,
  AuthenticatedUserDto,
  PlatformAdminListItemDto,
  PlatformRoleKeyDto,
  PlatformSecuritySettingsDto,
  PlatformStatusDto,
} from '@qrew/contracts';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { PasswordInput } from '@/components/password-input';
import { authClient } from '@/lib/auth-client';

interface PlatformAdminPanelProps {
  readonly initialUser: AuthenticatedUserDto;
  readonly initialStatus: PlatformStatusDto | null;
  readonly initialAdmins: PlatformAdminListItemDto[];
  readonly initialRequirePlatformMfa: boolean;
  readonly roleKey: PlatformRoleKeyDto;
}

function extractTotpSecret(totpURI: string): string | null {
  try {
    const parsed = new URL(totpURI);
    return parsed.searchParams.get('secret');
  } catch {
    return null;
  }
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as Partial<ApiErrorResponse>;
    return payload.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function PlatformAdminPanel({
  initialUser,
  initialStatus,
  initialAdmins,
  initialRequirePlatformMfa,
  roleKey,
}: PlatformAdminPanelProps) {
  const router = useRouter();
  const [admins, setAdmins] = useState<PlatformAdminListItemDto[]>(initialAdmins);
  const [mfaEnabled, setMfaEnabled] = useState(initialUser.mfaEnabled);
  const [requirePlatformMfa, setRequirePlatformMfa] = useState(
    initialStatus?.requirePlatformMfa ?? initialRequirePlatformMfa,
  );

  const [email, setEmail] = useState('');
  const [submittingProvision, setSubmittingProvision] = useState(false);
  const [submittingPolicy, setSubmittingPolicy] = useState(false);

  const [setupPassword, setSetupPassword] = useState('');
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<readonly string[]>([]);
  const [verificationCode, setVerificationCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [submittingPersonalMfa, setSubmittingPersonalMfa] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const effectiveRoleKey = initialStatus?.roleKey ?? roleKey;
  const isSuperAdmin = effectiveRoleKey === 'super_admin';
  const totpSecret = totpURI ? extractTotpSecret(totpURI) : null;

  async function handleSignOut() {
    await authClient.signOut();
    router.push('/login');
    router.refresh();
  }

  async function refreshAdmins() {
    const res = await fetch('/api/v1/platform/admins', {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (res.ok) {
      const updated = (await res.json()) as PlatformAdminListItemDto[];
      setAdmins(updated);
    }
  }

  async function handleTogglePlatformMfa() {
    setSubmittingPolicy(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const nextValue = !requirePlatformMfa;
    try {
      const res = await fetch('/api/v1/platform/security-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ requirePlatformMfa: nextValue }),
      });

      if (!res.ok) {
        setErrorMessage(await readErrorMessage(res, 'Unable to update platform MFA setting'));
        return;
      }

      const updated = (await res.json()) as PlatformSecuritySettingsDto;
      setRequirePlatformMfa(updated.requirePlatformMfa);
      setSuccessMessage(
        updated.requirePlatformMfa
          ? 'Platform-wide 2FA requirement is now ON.'
          : 'Platform-wide 2FA requirement is now OFF.',
      );
      router.refresh();
    } catch {
      setErrorMessage('Network error while updating platform security settings');
    } finally {
      setSubmittingPolicy(false);
    }
  }

  async function handleEnablePersonalMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingPersonalMfa(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await authClient.twoFactor.enable({ password: setupPassword });
      if (result.error) {
        setErrorMessage(result.error.message ?? 'Unable to initialize 2FA setup');
        return;
      }

      const data = result.data as { totpURI?: string; backupCodes?: string[] } | null;
      if (!data?.totpURI) {
        setErrorMessage('Authenticator setup response did not include a TOTP URI');
        return;
      }

      setTotpURI(data.totpURI);
      setBackupCodes(Array.isArray(data.backupCodes) ? data.backupCodes : []);
      setSetupPassword('');
    } catch {
      setErrorMessage('Network error while initializing 2FA setup');
    } finally {
      setSubmittingPersonalMfa(false);
    }
  }

  async function handleVerifyPersonalMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingPersonalMfa(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: verificationCode.trim(),
      });
      if (result.error) {
        setErrorMessage(result.error.message ?? 'Invalid 6-digit verification code');
        return;
      }

      setMfaEnabled(true);
      setTotpURI(null);
      setBackupCodes([]);
      setVerificationCode('');
      setSuccessMessage('Personal 2FA is now enabled.');
      await refreshAdmins();
      router.refresh();
    } catch {
      setErrorMessage('Network error while verifying TOTP code');
    } finally {
      setSubmittingPersonalMfa(false);
    }
  }

  async function handleDisablePersonalMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingPersonalMfa(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await authClient.twoFactor.disable({ password: disablePassword });
      if (result.error) {
        setErrorMessage(result.error.message ?? 'Unable to disable personal 2FA');
        return;
      }

      setMfaEnabled(false);
      setDisablePassword('');
      setSuccessMessage('Personal 2FA has been disabled.');
      await refreshAdmins();
      router.refresh();
    } catch {
      setErrorMessage('Network error while disabling 2FA');
    } finally {
      setSubmittingPersonalMfa(false);
    }
  }

  async function handleProvisionAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingProvision(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const res = await fetch('/api/v1/platform/admins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: normalizedEmail,
          roleKey: 'platform_admin',
        }),
      });

      if (!res.ok) {
        setErrorMessage(await readErrorMessage(res, 'Unable to provision platform administrator'));
        return;
      }

      setEmail('');
      setSuccessMessage(`Provisioned ${normalizedEmail} as platform_admin.`);
      await refreshAdmins();
    } catch {
      setErrorMessage('Network error while provisioning platform administrator');
    } finally {
      setSubmittingProvision(false);
    }
  }

  return (
    <main className="qrew-container" data-testid="platform-admin-panel">
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
          <h1 style={{ margin: 0 }}>Qrew Platform Admin</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.95rem' }} data-testid="admin-user-email">
            Signed in as <strong>{initialUser.email}</strong> · Role:{' '}
            <span className="qrew-badge" data-testid="admin-role-badge">
              {effectiveRoleKey}
            </span>{' '}
            · Personal 2FA:{' '}
            <span className="qrew-badge" data-testid="platform-mfa-status">
              {mfaEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </p>
        </div>
        <button type="button" className="qrew-btn qrew-btn-secondary" onClick={handleSignOut}>
          Sign out
        </button>
      </header>

      {!requirePlatformMfa ? (
        <div className="qrew-alert-warning" data-testid="mfa-policy-off-banner">
          Platform-wide 2FA requirement is currently <strong>OFF</strong> (optional). Enable it
          below whenever enforcement is needed.
        </div>
      ) : null}

      {errorMessage ? (
        <div role="alert" data-testid="platform-admin-error" className="qrew-alert-error">
          {errorMessage}
        </div>
      ) : null}

      {successMessage ? (
        <div data-testid="provision-success" className="qrew-alert-success">
          {successMessage}
        </div>
      ) : null}

      <section className="qrew-card">
        <h2 style={{ marginTop: 0 }}>Platform Overview</h2>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Platform Status</div>
            <strong style={{ fontSize: '1.25rem' }}>{initialStatus?.status ?? 'ok'}</strong>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Total Tenants</div>
            <strong style={{ fontSize: '1.25rem' }} data-testid="platform-total-tenants">
              {initialStatus?.totalTenants ?? 0}
            </strong>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Platform Admins</div>
            <strong style={{ fontSize: '1.25rem' }}>{admins.length}</strong>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Platform 2FA Policy</div>
            <strong style={{ fontSize: '1.25rem' }} data-testid="platform-mfa-policy-status">
              {requirePlatformMfa ? 'Required (ON)' : 'Optional (OFF)'}
            </strong>
          </div>
        </div>
      </section>

      <section className="qrew-card" data-testid="platform-security-card">
        <h2 style={{ marginTop: 0 }}>Platform Security & 2FA</h2>

        {isSuperAdmin ? (
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="qrew-btn"
                data-testid="toggle-platform-mfa-btn"
                disabled={submittingPolicy}
                onClick={handleTogglePlatformMfa}
              >
                {submittingPolicy
                  ? 'Updating...'
                  : requirePlatformMfa
                    ? 'Turn OFF platform 2FA requirement'
                    : 'Turn ON platform 2FA requirement'}
              </button>
            </div>
            {!requirePlatformMfa && !mfaEnabled ? (
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
                Enable your personal 2FA below before turning on platform-wide enforcement so you do
                not lock yourself out.
              </p>
            ) : null}
          </div>
        ) : (
          <p style={{ marginTop: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
            Only a <code>super_admin</code> can toggle platform-wide 2FA enforcement.
          </p>
        )}

        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '1rem 0' }} />

        <h3 style={{ marginTop: 0 }}>Your Personal 2FA</h3>
        {!mfaEnabled ? (
          !totpURI ? (
            <form onSubmit={handleEnablePersonalMfa} className="qrew-form">
              <div className="qrew-field">
                <label htmlFor="panel-mfa-password">Confirm password to set up 2FA</label>
                <PasswordInput
                  id="panel-mfa-password"
                  name="setupPassword"
                  required
                  autoComplete="current-password"
                  value={setupPassword}
                  onChange={setSetupPassword}
                />
              </div>
              <button type="submit" className="qrew-btn" disabled={submittingPersonalMfa}>
                {submittingPersonalMfa ? 'Generating key...' : 'Set up personal 2FA'}
              </button>
            </form>
          ) : (
            <div style={{ display: 'grid', gap: '1rem', maxWidth: '560px' }}>
              <div className="qrew-card" style={{ marginBottom: 0, background: 'var(--bg)' }}>
                {totpSecret ? (
                  <p style={{ margin: '0.3rem 0' }}>
                    Manual setup key: <code data-testid="panel-mfa-secret">{totpSecret}</code>
                  </p>
                ) : null}
                <p style={{ margin: '0.3rem 0', wordBreak: 'break-all', fontSize: '0.85rem' }}>
                  TOTP URI: <code data-testid="panel-mfa-totp-uri">{totpURI}</code>
                </p>
                {backupCodes.length > 0 ? (
                  <p style={{ margin: '0.4rem 0 0', fontSize: '0.85rem' }}>
                    Backup codes: <code>{backupCodes.join(', ')}</code>
                  </p>
                ) : null}
              </div>

              <form onSubmit={handleVerifyPersonalMfa} className="qrew-form">
                <div className="qrew-field">
                  <label htmlFor="panel-mfa-code">Enter 6-digit verification code</label>
                  <input
                    id="panel-mfa-code"
                    name="verificationCode"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    placeholder="123456"
                  />
                </div>
                <button type="submit" className="qrew-btn" disabled={submittingPersonalMfa}>
                  {submittingPersonalMfa ? 'Verifying...' : 'Verify & activate personal 2FA'}
                </button>
              </form>
            </div>
          )
        ) : requirePlatformMfa ? (
          <p style={{ marginBottom: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
            Personal 2FA is active. Turn off the platform-wide 2FA requirement above before
            disabling your personal authenticator.
          </p>
        ) : (
          <form onSubmit={handleDisablePersonalMfa} className="qrew-form">
            <div className="qrew-field">
              <label htmlFor="panel-disable-mfa-password">
                Confirm password to disable your 2FA
              </label>
              <PasswordInput
                id="panel-disable-mfa-password"
                name="disablePassword"
                required
                autoComplete="current-password"
                value={disablePassword}
                onChange={setDisablePassword}
              />
            </div>
            <button
              type="submit"
              className="qrew-btn qrew-btn-secondary"
              disabled={submittingPersonalMfa}
            >
              {submittingPersonalMfa ? 'Disabling...' : 'Disable personal 2FA'}
            </button>
          </form>
        )}
      </section>

      <div className="qrew-grid">
        <section className="qrew-card">
          <h2 style={{ marginTop: 0 }}>Platform Administrators</h2>
          {admins.length === 0 ? (
            <p>No platform administrators found.</p>
          ) : (
            <table className="qrew-table" data-testid="platform-admins-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>MFA</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((admin) => (
                  <tr key={admin.id} data-testid={`admin-row-${admin.email}`}>
                    <td>{admin.name}</td>
                    <td>{admin.email}</td>
                    <td>
                      <span className="qrew-badge">{admin.roleKey}</span>
                    </td>
                    <td>
                      <span className="qrew-badge">{admin.status}</span>
                    </td>
                    <td>{admin.mfaEnabled ? 'Enabled' : 'Pending'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {isSuperAdmin ? (
          <section className="qrew-card">
            <h2 style={{ marginTop: 0 }}>Provision Platform Admin</h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
              Target account must already exist, have a verified email address, and belong to zero
              customer tenants.
            </p>
            <form onSubmit={handleProvisionAdmin} className="qrew-form">
              <div className="qrew-field">
                <label htmlFor="provision-admin-email">Verified user email</label>
                <input
                  id="provision-admin-email"
                  name="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="operator@qrew.io"
                />
              </div>

              <div className="qrew-field">
                <label htmlFor="provision-admin-role">Platform role</label>
                <select id="provision-admin-role" name="roleKey" value="platform_admin" disabled>
                  <option value="platform_admin">platform_admin</option>
                </select>
              </div>

              <button type="submit" className="qrew-btn" disabled={submittingProvision}>
                {submittingProvision ? 'Provisioning...' : 'Provision platform admin'}
              </button>
            </form>
          </section>
        ) : null}
      </div>
    </main>
  );
}
