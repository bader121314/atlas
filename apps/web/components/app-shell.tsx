'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { api } from '../lib/api';
import type { Organization, SessionUser } from '../lib/api';
import type { Shortcut } from '../lib/shortcuts';
import { ShortcutHint, ShortcutProvider } from './shortcuts';

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

  const global = useMemo<Shortcut[]>(
    () => [
      {
        keys: 'g o',
        description: 'Go to your organizations',
        run: () => router.push('/organizations'),
      },
      {
        keys: 'g n',
        description: 'Go to notifications in this organization',
        run: () => {
          const slug = window.location.pathname.split('/')[2];
          if (window.location.pathname.startsWith('/organizations/') && slug)
            router.push(`/organizations/${slug}/notifications`);
        },
      },
      {
        keys: 'g a',
        description: 'Go to your account',
        run: () => router.push('/account'),
      },
    ],
    [router],
  );

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

  const currentSlug = pathname.startsWith('/organizations/')
    ? pathname.split('/')[2]
    : undefined;
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!currentSlug || !user) return;
    let active = true;
    const check = async () => {
      const result = await api<{ count: number }>(
        `/organizations/${currentSlug}/notifications/unread-count`,
      );
      if (active) setUnread(result.data?.count ?? 0);
    };
    void check();
    const timer = setInterval(() => void check(), 60_000);
    window.addEventListener('focus', check);
    window.addEventListener('atlas:notifications', check);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('atlas:notifications', check);
    };
  }, [currentSlug, user, pathname]);

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

  return (
    <ShellContext.Provider
      value={{ user, organizations, refreshOrganizations }}
    >
      <ShortcutProvider global={global}>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
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
                  router.push(
                    slug ? `/organizations/${slug}` : '/organizations',
                  );
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
          {currentSlug ? (
            <Link href={`/organizations/${currentSlug}/notifications`}>
              Notifications
              {unread > 0 ? (
                <span className="count-badge">
                  {' '}
                  {unread}
                  <span className="visually-hidden"> unread</span>
                </span>
              ) : null}
            </Link>
          ) : null}
          <ShortcutHint />
          <Link href="/account">{user.displayName}</Link>
          <button
            className="button secondary small"
            type="button"
            onClick={signOut}
          >
            Sign out
          </button>
        </header>
        <main className="page" id="main" tabIndex={-1}>
          {children}
        </main>
      </ShortcutProvider>
    </ShellContext.Provider>
  );
}
