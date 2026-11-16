'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { api } from '../lib/api';
import type { Organization, SessionUser } from '../lib/api';

interface Shell {
  user: SessionUser;
  organizations: Organization[];
  refreshOrganizations: () => Promise<void>;
}

const ShellContext = createContext<Shell | undefined>(undefined);

export function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error('useShell must be used inside AppShell');
  return shell;
}

/**
 * Signed-in frame: checks the session, loads the caller's organizations for
 * the switcher, and sends signed-out visitors to the sign-in page.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser>();
  const [organizations, setOrganizations] = useState<Organization[]>([]);

  const refreshOrganizations = useCallback(async () => {
    const result = await api<{ organizations: Organization[] }>(
      '/organizations',
    );
    if (result.data) setOrganizations(result.data.organizations);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const session = await api<{ user: SessionUser }>('/auth/session');
      if (!active) return;
      if (!session.data) {
        // Keep the query string so invitation links survive signing in.
        const here = window.location.pathname + window.location.search;
        router.replace(`/login?next=${encodeURIComponent(here)}`);
        return;
      }
      setUser(session.data.user);
      await refreshOrganizations();
    })();
    return () => {
      active = false;
    };
  }, [pathname, refreshOrganizations, router]);

  async function signOut() {
    await api('/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  if (!user) {
    return (
      <main className="page">
        <p className="muted" role="status">
          Loading your workspace…
        </p>
      </main>
    );
  }

  const currentSlug = pathname.startsWith('/organizations/')
    ? pathname.split('/')[2]
    : undefined;

  return (
    <ShellContext.Provider
      value={{ user, organizations, refreshOrganizations }}
    >
      <header className="topbar">
        <Link className="wordmark" href="/organizations">
          Atlas
        </Link>
        {organizations.length > 0 ? (
          <label>
            <span className="muted">Organization </span>
            <select
              value={currentSlug ?? ''}
              onChange={(event) => {
                const slug = event.target.value;
                router.push(slug ? `/organizations/${slug}` : '/organizations');
              }}
            >
              <option value="">All organizations</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.slug}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="spacer" />
        <Link href="/account">{user.displayName}</Link>
        <button
          className="button secondary small"
          type="button"
          onClick={signOut}
        >
          Sign out
        </button>
      </header>
      <main className="page">{children}</main>
    </ShellContext.Provider>
  );
}
