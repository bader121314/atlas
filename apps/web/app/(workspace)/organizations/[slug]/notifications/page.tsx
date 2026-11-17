'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Notice } from '../../../../../components/form';
import { api, describeFailure } from '../../../../../lib/api';
import type { AppNotification } from '../../../../../lib/api';

const when = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function describe(item: AppNotification): string {
  const who = item.actor ?? 'Someone';
  return item.kind === 'task.assigned'
    ? `${who} assigned ${item.task.key} to you`
    : `${who} commented on ${item.task.key}`;
}

export default function NotificationsPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [email, setEmail] = useState<boolean>();
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const [list, settings] = await Promise.all([
      api<AppNotification[]>(
        `/organizations/${slug}/notifications${unreadOnly ? '?unread=true' : ''}`,
      ),
      api<{ email: boolean }>(`/organizations/${slug}/notification-settings`),
    ]);
    if (list.status === 404) {
      setMissing(true);
      return;
    }
    setItems(list.data ?? []);
    if (settings.data) setEmail(settings.data.email);
  }, [slug, unreadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(body: { ids: string[] } | { all: true }) {
    const result = await api(`/organizations/${slug}/notifications/read`, {
      method: 'POST',
      body,
    });
    setError(
      result.ok ? '' : describeFailure(result.status, 'Could not mark read.'),
    );
    window.dispatchEvent(new Event('atlas:notifications'));
    await load();
  }

  async function open(item: AppNotification) {
    if (!item.readAt) await markRead({ ids: [item.id] });
    router.push(
      `/organizations/${slug}/projects/${item.task.projectKey}/tasks/${item.task.number}`,
    );
  }

  async function toggleEmail(next: boolean) {
    const result = await api<{ email: boolean }>(
      `/organizations/${slug}/notification-settings`,
      { method: 'PUT', body: { email: next } },
    );
    if (result.data) setEmail(result.data.email);
  }

  if (missing) {
    return (
      <>
        <h1>Organization not found</h1>
        <p>It does not exist, or you are not a member.</p>
        <p>
          <Link href="/organizations">Your organizations</Link>
        </p>
      </>
    );
  }

  const unread = items?.filter((i) => !i.readAt).length ?? 0;
  return (
    <>
      <p className="muted">
        <Link href={`/organizations/${slug}`}>Organization</Link> /
        Notifications
      </p>
      <h1>Notifications</h1>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="inline-form">
        <label className="checks inline">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => setUnreadOnly(event.target.checked)}
          />
          Unread only
        </label>
        <button
          className="button secondary small"
          type="button"
          disabled={unread === 0}
          onClick={() => void markRead({ all: true })}
        >
          Mark all read
        </button>
      </div>
      {items === undefined ? (
        <p className="muted" role="status">
          Loading…
        </p>
      ) : items.length === 0 ? (
        <p className="muted">
          {unreadOnly
            ? 'Nothing unread.'
            : 'Nothing yet. You will hear here when a task is assigned to you or someone comments on your work.'}
        </p>
      ) : (
        <ul className="rows section">
          {items.map((item) => (
            <li key={item.id} className={item.readAt ? '' : 'unread'}>
              <span className="grow">
                <button
                  className="link-button title"
                  type="button"
                  onClick={() => void open(item)}
                >
                  {describe(item)}
                </button>
                <br />
                <span className="muted">
                  {item.task.title} · {when.format(new Date(item.createdAt))}
                  {item.readAt ? '' : ' · unread'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {email === undefined ? null : (
        <section className="section" aria-labelledby="email-heading">
          <h2 id="email-heading">Email</h2>
          <label className="checks inline">
            <input
              type="checkbox"
              checked={email}
              onChange={(event) => void toggleEmail(event.target.checked)}
            />
            Email me about notifications I have not read within two minutes
          </label>
        </section>
      )}
    </>
  );
}
