'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, describeFailure } from '../lib/api';
import { formatDuration, parseDuration } from '../lib/duration';
import { Notice } from './form';

interface Entry {
  id: string;
  user: { userId: string; displayName: string };
  minutes: number;
  spentOn: string;
  note: string | null;
}

const day = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function localToday(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

/** Time logged on a task (ADR-049). */
export function TimeSection({
  base,
  number,
  userId,
  canWrite,
  canManage,
  estimateMinutes = null,
}: {
  base: string;
  number: string;
  userId: string;
  canWrite: boolean;
  canManage: boolean;
  estimateMinutes?: number | null;
}) {
  const [data, setData] = useState<{
    totalMinutes: number;
    entries: Entry[];
  }>();
  const [error, setError] = useState<string>();
  const path = `${base}/tasks/${number}/time`;

  const load = useCallback(async () => {
    const result = await api<{ totalMinutes: number; entries: Entry[] }>(path);
    setData(result.data);
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  async function log(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const minutes = parseDuration(String(values.get('duration') ?? ''));
    if (minutes === undefined) {
      setError('Enter time like 45m, 1h 30m or 1:30, up to 24 hours.');
      return;
    }
    const note = String(values.get('note') ?? '').trim();
    const result = await api(path, {
      method: 'POST',
      body: {
        minutes,
        spentOn: String(values.get('spentOn')),
        ...(note ? { note } : {}),
      },
    });
    if (!result.ok) {
      setError(
        describeFailure(
          result.status,
          'The time could not be logged. Days in the future are not allowed.',
        ),
      );
      return;
    }
    setError(undefined);
    form.reset();
    await load();
  }

  async function remove(entry: Entry) {
    if (
      !window.confirm(
        `Remove ${formatDuration(entry.minutes)} logged by ${entry.user.displayName}?`,
      )
    )
      return;
    await api(`${path}/${entry.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <section className="section" aria-labelledby="time-heading">
      <h2 id="time-heading">Time</h2>
      {!data ? null : (
        <>
          <p>
            Logged in total:{' '}
            <strong>{formatDuration(data.totalMinutes)}</strong>
            {estimateMinutes ? (
              <span className="muted">
                {' '}
                of {formatDuration(estimateMinutes)} estimated
                {data.totalMinutes > estimateMinutes
                  ? ` (${formatDuration(data.totalMinutes - estimateMinutes)} over)`
                  : ''}
              </span>
            ) : null}
          </p>
          <ul className="rows">
            {data.entries.map((entry) => (
              <li key={entry.id}>
                <span className="grow">
                  <span className="title">
                    {formatDuration(entry.minutes)} by {entry.user.displayName}
                  </span>
                  <br />
                  <span className="muted">
                    {day.format(new Date(`${entry.spentOn}T00:00:00Z`))}
                    {entry.note ? `: ${entry.note}` : ''}
                  </span>
                </span>
                {canWrite && (entry.user.userId === userId || canManage) ? (
                  <button
                    className="button danger small"
                    type="button"
                    onClick={() => void remove(entry)}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {canWrite ? (
        <form className="inline-form section" onSubmit={(e) => void log(e)}>
          <div className="field">
            <label htmlFor="timeDuration">Time spent</label>
            <input
              id="timeDuration"
              name="duration"
              placeholder="1h 30m"
              required
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="timeDay">Day</label>
            <input
              id="timeDay"
              name="spentOn"
              type="date"
              defaultValue={localToday()}
              max={localToday()}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="timeNote">Note (optional)</label>
            <input id="timeNote" name="note" maxLength={500} />
          </div>
          <button className="button secondary" type="submit">
            Log time
          </button>
        </form>
      ) : null}
    </section>
  );
}
