import Link from 'next/link';
import { getServerAccessContext } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const access = await getServerAccessContext();
  const workspaceHref = access?.principalType === 'admin' ? '/admin' : '/dashboard';

  return (
    <main className="qrew-container">
      <section className="qrew-card">
        <h1>Qrew</h1>
        <p>Multi-tenant B2B office management platform.</p>
        <nav style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
          {access ? (
            <Link href={workspaceHref} className="qrew-btn">
              Continue to workspace
            </Link>
          ) : (
            <>
              <Link href="/login" className="qrew-btn">
                Sign in
              </Link>
              <Link href="/register" className="qrew-btn qrew-btn-secondary">
                Create account
              </Link>
            </>
          )}
        </nav>
      </section>
    </main>
  );
}
