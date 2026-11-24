'use client';

import type { AuthenticatedUserDto, PlatformRoleKeyDto } from '@qrew/contracts';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { PasswordInput } from '@/components/password-input';
import { authClient } from '@/lib/auth-client';

interface AdminMfaGateProps {
  readonly user: AuthenticatedUserDto;
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

export function AdminMfaGate({ user, roleKey }: AdminMfaGateProps) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<readonly string[]>([]);
  const [verificationCode, setVerificationCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const secret = totpURI ? extractTotpSecret(totpURI) : null;

  async function handleSignOut() {
    await authClient.signOut();
    router.push('/login');
    router.refresh();
  }

  async function handleEnableMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await authClient.twoFactor.enable({ password });
      if (result.error) {
        setErrorMessage(result.error.message ?? 'Unable to initialize authenticator setup');
        return;
      }

      const data = result.data as { totpURI?: string; backupCodes?: string[] } | null;
      if (!data?.totpURI) {
        setErrorMessage('Authenticator setup response did not include a TOTP URI');
        return;
      }

      setTotpURI(data.totpURI);
      setBackupCodes(Array.isArray(data.backupCodes) ? data.backupCodes : []);
      setPassword('');
    } catch {
      setErrorMessage('Network error while setting up MFA');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: verificationCode.trim(),
      });

      if (result.error) {
        setErrorMessage(result.error.message ?? 'Invalid 6-digit verification code');
        return;
      }

      router.refresh();
    } catch {
      setErrorMessage('Network error while verifying TOTP code');
    } finally {
      setSubmitting(false);
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
          <h1 style={{ margin: 0 }}>Qrew Platform Admin — Security Setup</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.95rem' }} data-testid="admin-user-email">
            Signed in as <strong>{user.email}</strong> ·{' '}
            <span className="qrew-badge" data-testid="admin-role-badge">
              {roleKey}
            </span>
          </p>
        </div>
        <button type="button" className="qrew-btn qrew-btn-secondary" onClick={handleSignOut}>
          Sign out
        </button>
      </header>

      <section className="qrew-card" data-testid="admin-mfa-gate">
        <h2>Multi-Factor Authentication Required</h2>
        <p style={{ color: 'var(--muted)', maxWidth: '640px' }}>
          Platform administrators must enable TOTP two-factor authentication before accessing
          platform controls. Customer workspaces are disabled for platform admin accounts.
        </p>

        {errorMessage ? (
          <div role="alert" className="qrew-alert-error">
            {errorMessage}
          </div>
        ) : null}

        {!totpURI ? (
          <form onSubmit={handleEnableMfa} className="qrew-form">
            <div className="qrew-field">
              <label htmlFor="mfa-password">Confirm current password</label>
              <PasswordInput
                id="mfa-password"
                name="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
              />
            </div>

            <button type="submit" className="qrew-btn" disabled={submitting}>
              {submitting ? 'Generating setup key...' : 'Set up authenticator app'}
            </button>
          </form>
        ) : (
          <div style={{ display: 'grid', gap: '1.25rem', maxWidth: '560px' }}>
            <div className="qrew-card" style={{ marginBottom: 0, background: 'var(--bg)' }}>
              <h3 style={{ marginTop: 0 }}>1. Save authenticator secret & backup codes</h3>
              {secret ? (
                <p style={{ margin: '0.4rem 0' }}>
                  Manual setup key: <code data-testid="mfa-secret">{secret}</code>
                </p>
              ) : null}
              <p style={{ margin: '0.4rem 0', wordBreak: 'break-all', fontSize: '0.85rem' }}>
                TOTP URI: <code data-testid="mfa-totp-uri">{totpURI}</code>
              </p>
              {backupCodes.length > 0 ? (
                <div style={{ marginTop: '0.75rem' }}>
                  <strong style={{ fontSize: '0.85rem' }}>Backup recovery codes:</strong>
                  <ul
                    data-testid="mfa-backup-codes"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                      gap: '0.35rem',
                      paddingLeft: '1.25rem',
                      marginBottom: 0,
                      fontSize: '0.85rem',
                    }}
                  >
                    {backupCodes.map((code) => (
                      <li key={code}>
                        <code>{code}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <form onSubmit={handleVerifyTotp} className="qrew-form">
              <div className="qrew-field">
                <label htmlFor="mfa-code">2. Enter 6-digit verification code</label>
                <input
                  id="mfa-code"
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

              <button type="submit" className="qrew-btn" disabled={submitting}>
                {submitting ? 'Verifying code...' : 'Verify and unlock Admin Panel'}
              </button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
