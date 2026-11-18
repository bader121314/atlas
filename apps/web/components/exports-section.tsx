'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, describeFailure } from '../lib/api';
import { Notice } from './form';
import { useT } from '../lib/i18n';

interface TaskExport {
  id: string;
  status: 'queued' | 'ready' | 'failed' | 'expired';
  rowCount: number | null;
  createdAt: string;
  expiresAt: string | null;
}

const when = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Ask for a CSV of the project's tasks; download it while it lasts. */
export function ExportsSection({ base }: { base: string }) {
  const t = useT();
  const [items, setItems] = useState<TaskExport[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const result = await api<TaskExport[]>(`${base}/exports`);
    setItems(result.data ?? []);
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const waiting = items.some((i) => i.status === 'queued');
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  async function request() {
    const result = await api(`${base}/exports`, { method: 'POST' });
    setError(
      result.ok
        ? ''
        : describeFailure(
            result.status,
            result.status === 409
              ? 'You already have exports waiting. Try again when they finish.'
              : t('The export could not be started.'),
          ),
    );
    await load();
  }

  return (
    <section className="section" aria-labelledby="exports-heading">
      <h2 id="exports-heading">{t('Export')}</h2>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <p className="muted">
        {t(
          'A spreadsheet (CSV) of every task in this project. Only you can download it, for 24 hours.',
        )}
      </p>
      <button
        className="button secondary"
        type="button"
        onClick={() => void request()}
      >
        {t('Export tasks as CSV')}
      </button>
      {items.length > 0 ? (
        <ul className="rows section">
          {items.map((item) => (
            <li key={item.id}>
              <span className="grow">
                {item.status === 'ready' ? (
                  <a
                    className="title"
                    href={`/api${base}/exports/${item.id}/download`}
                  >
                    {item.rowCount === 1
                      ? t('Download (1 task)')
                      : t('Download ({count} tasks)', {
                          count: String(item.rowCount ?? 0),
                        })}
                  </a>
                ) : (
                  <span className="title">
                    {item.status === 'queued'
                      ? t('Preparing…')
                      : item.status === 'expired'
                        ? t('Expired')
                        : 'Failed: you may no longer have access to this project'}
                  </span>
                )}
                <br />
                <span className="muted">
                  {item.status === 'ready' && item.expiresAt
                    ? t('Requested {date}, available until {until}', {
                        date: when.format(new Date(item.createdAt)),
                        until: when.format(new Date(item.expiresAt)),
                      })
                    : t('Requested {date}', {
                        date: when.format(new Date(item.createdAt)),
                      })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
