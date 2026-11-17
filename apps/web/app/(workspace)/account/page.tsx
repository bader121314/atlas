'use client';

import { useCallback, useEffect, useState } from 'react';
import { useShell } from '../../../components/app-shell';
import { ChangePasswordSection } from '../../../components/change-password';
import { Notice } from '../../../components/form';
import { api, describeFailure } from '../../../lib/api';
import { useT } from '../../../lib/i18n';

interface Session {
  id: string;
  current: boolean;
  issuedAt: string;
  lastSeenAt: string | null;
  userAgent: string | null;
}

const when = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function device(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser';
  const system = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'another system';
  return `${browser} on ${system}`;
}

export default function AccountPage() {
  const t = useT();
  const { user } = useShell();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [message, setMessage] = useState<{
    tone: 'info' | 'error';
    text: string;
  }>();

  const load = useCallback(async () => {
    const result = await api<{ sessions: Session[] }>('/auth/sessions');
    setSessions(result.data?.sessions ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function signOutDevice(session: Session) {
    const result = await api(`/auth/sessions/${session.id}`, {
      method: 'DELETE',
    });
    setMessage(
      result.ok
        ? { tone: 'info', text: t('That device is signed out.') }
        : {
            tone: 'error',
            text: describeFailure(
              result.status,
              t('That device could not be signed out.'),
            ),
          },
    );
    await load();
  }

  async function signOutOthers() {
    const result = await api('/auth/sessions/revoke-others', {
      method: 'POST',
    });
    setMessage(
      result.ok
        ? { tone: 'info', text: t('Every other device is signed out.') }
        : {
            tone: 'error',
            text: describeFailure(
              result.status,
              t('Other devices could not be signed out.'),
            ),
          },
    );
    await load();
  }

  const others = sessions.filter((session) => !session.current).length;

  return (
    <>
      <h1>{t('Your account')}</h1>
      <p>
        {user.displayName}
        <br />
        <span className="muted">{user.email}</span>
      </p>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <ChangePasswordSection onChanged={() => void load()} />
      <section className="section" aria-labelledby="sessions-heading">
        <h2 id="sessions-heading">{t('Where you are signed in')}</h2>
        <ul className="rows">
          {sessions.map((session) => (
            <li key={session.id}>
              <span className="grow">
                <span className="title">
                  {device(session.userAgent)}
                  {session.current ? ' (this device)' : ''}
                </span>
                <br />
                <span className="muted">
                  Signed in {when.format(new Date(session.issuedAt))}
                  {session.lastSeenAt
                    ? `, last active ${when.format(new Date(session.lastSeenAt))}`
                    : ''}
                </span>
              </span>
              {session.current ? null : (
                <button
                  className="button secondary small"
                  type="button"
                  onClick={() => void signOutDevice(session)}
                >
                  {t('Sign out')}
                </button>
              )}
            </li>
          ))}
        </ul>
        {others > 0 ? (
          <p className="section">
            <button
              className="button danger"
              type="button"
              onClick={signOutOthers}
            >
              Sign out of {others} other {others === 1 ? 'device' : 'devices'}
            </button>
          </p>
        ) : null}
      </section>
    </>
  );
}
