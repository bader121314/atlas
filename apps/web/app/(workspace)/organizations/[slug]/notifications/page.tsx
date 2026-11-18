'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Notice } from '../../../../../components/form';
import { api, describeFailure } from '../../../../../lib/api';
import type { AppNotification } from '../../../../../lib/api';
import { PushToggle } from '../../../../../components/push-toggle';
import { n, useT } from '../../../../../lib/i18n';

const when = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

type Kind = 'task.assigned' | 'comment.created' | 'mention';
type Mode = 'instant' | 'daily' | 'off';
interface Preferences {
  email: boolean;
  emailMode: Mode;
  muted: Kind[];
}

const KINDS: [Kind, string][] = [
  ['task.assigned', 'A task is assigned to me'],
  ['mention', n('Someone mentions me')],
  [
    'comment.created',
    n('Someone comments on a task I created, am assigned to or commented on'),
  ],
];

const MODES: [Mode, string][] = [
  ['instant', n('Email each notification I have not read within two minutes')],
  ['daily', n('Email one daily summary of what I have not read')],
  ['off', n('No email')],
];

function describe(
  item: AppNotification,
  t: (text: string, vars?: Record<string, string>) => string,
): string {
  const vars = { who: item.actor ?? t('Someone'), key: item.task.key };
  if (item.kind === 'task.assigned')
    return t('{who} assigned {key} to you', vars);
  if (item.kind === 'mention') return t('{who} mentioned you on {key}', vars);
  return t('{who} commented on {key}', vars);
}

export default function NotificationsPage() {
  const t = useT();
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>();
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const [list, settings] = await Promise.all([
      api<AppNotification[]>(
        `/organizations/${slug}/notifications${unreadOnly ? '?unread=true' : ''}`,
      ),
      api<Preferences>(`/organizations/${slug}/notification-settings`),
    ]);
    if (list.status === 404) {
      setMissing(true);
      return;
    }
    setItems(list.data ?? []);
    if (settings.data) setPrefs(settings.data);
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
      result.ok
        ? ''
        : describeFailure(result.status, t('Could not mark read.')),
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

  async function savePrefs(change: Partial<Omit<Preferences, 'email'>>) {
    const result = await api<Preferences>(
      `/organizations/${slug}/notification-settings`,
      {
        method: 'PUT',
        body: change,
      },
    );
    if (result.data) setPrefs(result.data);
  }

  if (missing) {
    return (
      <>
        <h1>{t('Organization not found')}</h1>
        <p>{t('It does not exist, or you are not a member.')}</p>
        <p>
          <Link href="/organizations">{t('Your organizations')}</Link>
        </p>
      </>
    );
  }

  const unread = items?.filter((i) => !i.readAt).length ?? 0;
  return (
    <>
      <p className="muted">
        <Link href={`/organizations/${slug}`}>{t('Organization')}</Link>{' '}
        {t('/ Notifications')}
      </p>
      <h1>{t('Notifications')}</h1>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="inline-form">
        <label className="checks inline">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => setUnreadOnly(event.target.checked)}
          />
          {t('Unread only')}
        </label>
        <button
          className="button secondary small"
          type="button"
          disabled={unread === 0}
          onClick={() => void markRead({ all: true })}
        >
          {t('Mark all read')}
        </button>
      </div>
      {items === undefined ? (
        <p className="muted" role="status">
          {t('Loading…')}
        </p>
      ) : items.length === 0 ? (
        <p className="muted">
          {unreadOnly
            ? t('Nothing unread.')
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
                  {describe(item, t)}
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
      {prefs === undefined ? null : (
        <section className="section" aria-labelledby="prefs-heading">
          <h2 id="prefs-heading">{t('Preferences')}</h2>
          <fieldset className="checks plain">
            <legend>{t('Notify me when')}</legend>
            {KINDS.map(([kind, label]) => (
              <label key={kind}>
                <input
                  type="checkbox"
                  checked={!prefs.muted.includes(kind)}
                  onChange={(event) =>
                    void savePrefs({
                      muted: event.target.checked
                        ? prefs.muted.filter((k) => k !== kind)
                        : [...prefs.muted, kind],
                    })
                  }
                />
                {t(label)}
              </label>
            ))}
          </fieldset>
          <fieldset className="checks plain section">
            <legend>{t('Email')}</legend>
            {MODES.map(([mode, label]) => (
              <label key={mode}>
                <input
                  type="radio"
                  name="emailMode"
                  checked={prefs.emailMode === mode}
                  onChange={() => void savePrefs({ emailMode: mode })}
                />
                {t(label)}
              </label>
            ))}
          </fieldset>
          <PushToggle />
        </section>
      )}
    </>
  );
}
