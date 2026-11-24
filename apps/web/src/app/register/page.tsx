'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { PasswordInput } from '@/components/password-input';
import { authClient } from '@/lib/auth-client';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await authClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
        callbackURL: '/dashboard',
      });

      if (result.error) {
        setErrorMessage(result.error.message ?? 'Unable to create account');
        return;
      }

      setRegisteredEmail(email.trim().toLowerCase());
    } catch {
      setErrorMessage('Network error while creating your account');
    } finally {
      setSubmitting(false);
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

        <h1>Create your Qrew account</h1>

        {errorMessage ? (
          <div role="alert" className="qrew-alert-error">
            {errorMessage}
          </div>
        ) : null}

        {registeredEmail ? (
          <div data-testid="register-success" className="qrew-alert-success">
            Check your email to verify your account before signing in.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="qrew-form">
            <div className="qrew-field">
              <label htmlFor="register-name">Full name</label>
              <input
                id="register-name"
                name="name"
                type="text"
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Asif Rahman"
              />
            </div>

            <div className="qrew-field">
              <label htmlFor="register-email">Work email</label>
              <input
                id="register-email"
                name="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="asif@company.com"
              />
            </div>

            <div className="qrew-field">
              <label htmlFor="register-password">Password</label>
              <PasswordInput
                id="register-password"
                name="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={setPassword}
              />
            </div>

            <button type="submit" className="qrew-btn" disabled={submitting}>
              {submitting ? 'Creating account...' : 'Create account'}
            </button>
          </form>
        )}

        <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
