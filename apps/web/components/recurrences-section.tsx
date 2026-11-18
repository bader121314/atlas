'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { PRIORITIES, api, describeFailure, priorityLabel } from '../lib/api';
import { Notice, value } from './form';
import { useT } from '../lib/i18n';

interface Recurrence {
  id: string;
  title: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: number;
  nextRunAt: string;
  enabled: boolean;
}

const when = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const UNITS = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
} as const;

function every(r: Recurrence): string {
  const [one, many] = UNITS[r.frequency];
  return r.interval === 1 ? `Every ${one}` : `Every ${r.interval} ${many}`;
}

/** Tasks Atlas creates on a schedule (ADR-039). */
export function RecurrencesSection({
  base,
  canWrite,
}: {
  base: string;
  canWrite: boolean;
}) {
  const t = useT();
  const [items, setItems] = useState<Recurrence[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const result = await api<Recurrence[]>(`${base}/recurrences`);
    setItems(result.data ?? []);
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const due = value(form, 'recurDue');
    const start = value(form, 'recurStart');
    const result = await api(`${base}/recurrences`, {
      method: 'POST',
      body: {
        title: value(form, 'recurTitle'),
        frequency: value(form, 'recurFrequency'),
        interval: Number(value(form, 'recurInterval')),
        priority: value(form, 'recurPriority'),
        dueInDays: due ? Number(due) : null,
        ...(start ? { startsAt: new Date(start).toISOString() } : {}),
      },
    });
    setError(
      result.ok
        ? ''
        : describeFailure(
            result.status,
            t('The recurring task could not be saved.'),
          ),
    );
    if (result.ok) form.reset();
    await load();
  }

  if (!canWrite && items.length === 0) return null;
  return (
    <section className="section" aria-labelledby="recurring-heading">
      <h2 id="recurring-heading">{t('Recurring tasks')}</h2>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {items.length === 0 ? (
        <p className="muted">{t('Nothing repeats yet.')}</p>
      ) : null}
      <ul className="rows">
        {items.map((r) => (
          <li key={r.id}>
            <span className="grow">
              <span className="title">{r.title}</span>
              {r.enabled ? null : <span className="muted"> {t('(off)')}</span>}
              <br />
              <span className="muted">
                {every(r)}, next {when.format(new Date(r.nextRunAt))}
              </span>
            </span>
            {canWrite ? (
              <>
                <button
                  className="button secondary small"
                  type="button"
                  onClick={() =>
                    void api(`${base}/recurrences/${r.id}`, {
                      method: 'PATCH',
                      body: { enabled: !r.enabled },
                    }).then(load)
                  }
                >
                  {r.enabled ? t('Pause') : t('Resume')}
                </button>
                <button
                  className="button danger small"
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        t(
                          'Stop repeating {name}? Tasks already created stay.',
                          { name: r.title },
                        ),
                      )
                    )
                      void api(`${base}/recurrences/${r.id}`, {
                        method: 'DELETE',
                      }).then(load);
                  }}
                >
                  {t('Delete')}
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {canWrite ? (
        <form className="form section" onSubmit={create}>
          <div className="field">
            <label htmlFor="recurTitle">{t('Task title')}</label>
            <input id="recurTitle" name="recurTitle" required maxLength={200} />
          </div>
          <div className="inline-form">
            <div className="field">
              <label htmlFor="recurInterval">{t('Every')}</label>
              <input
                id="recurInterval"
                name="recurInterval"
                type="number"
                min={1}
                max={12}
                defaultValue={1}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="recurFrequency">{t('Unit')}</label>
              <select
                id="recurFrequency"
                name="recurFrequency"
                defaultValue="weekly"
              >
                <option value="daily">{t('Days')}</option>
                <option value="weekly">{t('Weeks')}</option>
                <option value="monthly">{t('Months')}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="recurStart">{t('First time')}</label>
              <input id="recurStart" name="recurStart" type="datetime-local" />
            </div>
            <div className="field">
              <label htmlFor="recurPriority">{t('Priority')}</label>
              <select
                id="recurPriority"
                name="recurPriority"
                defaultValue="none"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {priorityLabel(p)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="recurDue">{t('Due after (days)')}</label>
              <input
                id="recurDue"
                name="recurDue"
                type="number"
                min={0}
                max={365}
              />
            </div>
          </div>
          <button className="button secondary" type="submit">
            {t('Add recurring task')}
          </button>
        </form>
      ) : null}
    </section>
  );
}
