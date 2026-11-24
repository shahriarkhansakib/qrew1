'use client';

import type { AccessContextDto } from '@qrew/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { PasswordInput } from '@/components/password-input';
import { authClient } from '@/lib/auth-client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaStep, setMfaStep] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function redirectAfterAuth() {
    let target = '/dashboard';
    try {
      const res = await fetch('/api/v1/access-context', {
        method: 'GET',
        credentials: 'same-origin',
      });
      if (res.ok) {
        const access = (await res.json()) as AccessContextDto;
        if (access.principalType === 'admin') {
          target = '/admin';
        }
      }
    } catch {
      // Fall back to /dashboard; SSR guard will redirect appropriately.
    }

    router.push(target);
    router.refresh();
  }

  async function handleEmailSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
      });

      if (result.error) {
        setErrorMessage(result.error.message ?? 'Invalid email or password');
        return;
      }

      if (
        result.data &&
        typeof result.data === 'object' &&
        'twoFactorRedirect' in result.data &&
        result.data.twoFactorRedirect === true
      ) {
        setMfaStep(true);
        return;
      }

      await redirectAfterAuth();
    } catch {
      setErrorMessage('Network error while signing in');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMfaVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const trimmedCode = mfaCode.trim();
      const result = useBackupCode
        ? await authClient.twoFactor.verifyBackupCode({ code: trimmedCode })
        : await authClient.twoFactor.verifyTotp({ code: trimmedCode });

      if (result.error) {
        setErrorMessage(result.error.message ?? 'Invalid verification code');
        return;
      }

      await redirectAfterAuth();
    } catch {
      setErrorMessage('Network error while verifying 2FA code');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    setErrorMessage(null);
    const result = await authClient.signIn.social({
      provider: 'google',
      callbackURL: '/dashboard',
    });

    if (result.error) {
      setErrorMessage(result.error.message ?? 'Unable to start Google sign-in');
    }
  }

  return (
    <main className="qrew-container">
      <section className="qrew-card" style={{ maxWidth: '500px', margin: '0 auto' }}>
        <div style={{ marginBottom: '1rem' }}>
          <Link href="/" className="qrew-btn qrew-btn-secondary">
            ← Back to home
          </Link>
        </div>

        <h1>{mfaStep ? 'Two-factor verification' : 'Sign in to Qrew'}</h1>

        {errorMessage ? (
          <div role="alert" className="qrew-alert-error">
            {errorMessage}
          </div>
        ) : null}

        {mfaStep ? (
          <form onSubmit={handleMfaVerify} className="qrew-form">
            <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--muted)' }}>
              {useBackupCode
                ? 'Enter one of your backup recovery codes to continue.'
                : 'Enter the 6-digit code from your authenticator app to continue.'}
            </p>

            <div className="qrew-field">
              <label htmlFor="login-totp">
                {useBackupCode ? 'Backup recovery code' : 'Authenticator code'}
              </label>
              <input
                id="login-totp"
                data-testid="login-totp-input"
                name="mfaCode"
                type="text"
                inputMode={useBackupCode ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                required
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder={useBackupCode ? 'xxxxxxxx' : '123456'}
              />
            </div>

            <button type="submit" className="qrew-btn" disabled={submitting}>
              {submitting ? 'Verifying...' : 'Verify and sign in'}
            </button>

            <button
              type="button"
              className="qrew-btn qrew-btn-secondary"
              onClick={() => {
                setErrorMessage(null);
                setMfaCode('');
                setUseBackupCode((prev) => !prev);
              }}
            >
              {useBackupCode ? 'Use authenticator code instead' : 'Use a backup recovery code'}
            </button>
          </form>
        ) : (
          <>
            <form onSubmit={handleEmailSignIn} className="qrew-form">
              <div className="qrew-field">
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="asif@company.com"
                />
              </div>

              <div className="qrew-field">
                <label htmlFor="login-password">Password</label>
                <PasswordInput
                  id="login-password"
                  name="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={setPassword}
                />
              </div>

              <button type="submit" className="qrew-btn" disabled={submitting}>
                {submitting ? 'Signing in...' : 'Sign in'}
              </button>
            </form>

            <div style={{ marginTop: '1rem', maxWidth: '420px' }}>
              <button
                type="button"
                className="qrew-btn qrew-btn-secondary"
                style={{ width: '100%' }}
                onClick={handleGoogleSignIn}
              >
                Continue with Google
              </button>
            </div>

            <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
              New to Qrew? <Link href="/register">Create an account</Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
