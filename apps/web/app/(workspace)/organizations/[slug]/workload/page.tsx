'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useShell } from '../../../../../components/app-shell';
import { Notice } from '../../../../../components/form';
import { api, describeFailure } from '../../../../../lib/api';
import type { Organization } from '../../../../../lib/api';
import { formatDuration, parseDuration } from '../../../../../lib/duration';
import { useT } from '../../../../../lib/i18n';

interface Person {
  userId: string;
  displayName: string;
  overdue: number;
  weeks: number[];
  weekMinutes: number[];
  capacityMinutes: number | null;
  later: number;
  noDueDate: number;
  total: number;
}

const week = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** Shading steps for a cell; the number is always shown as text too. */
function level(count: number): string {
  if (count === 0) return 'load-0';
  if (count <= 2) return 'load-1';
  if (count <= 4) return 'load-2';
  return 'load-3';
}

export default function WorkloadPage() {
  const t = useT();
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<{
    weekStarts: string[];
    people: Person[];
  }>();
  const [status, setStatus] = useState<number>();
  const [role, setRole] = useState<Organization['role']>();
  const [members, setMembers] = useState<
    { userId: string; displayName: string }[]
  >([]);
  const [message, setMessage] = useState<{
    tone: 'info' | 'error';
    text: string;
  }>();
  const { user } = useShell();
  const admin = role === 'owner' || role === 'admin';

  const load = useCallback(async () => {
    const r = await api<{ weekStarts: string[]; people: Person[] }>(
      `/organizations/${slug}/workload?weeks=6`,
    );
    setStatus(r.status);
    setData(r.data);
  }, [slug]);

  useEffect(() => {
    void load();
    void api<Organization>(`/organizations/${slug}`).then((r) =>
      setRole(r.data?.role),
    );
    void api<{ members: { userId: string; displayName: string }[] }>(
      `/organizations/${slug}/members`,
    ).then((r) => setMembers(r.data?.members ?? []));
  }, [slug, load]);

  async function saveCapacity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const person = String(values.get('person') ?? user.id);
    const text = String(values.get('hours') ?? '').trim();
    const minutes = text === '' ? null : parseDuration(text, 10080);
    if (minutes === undefined) {
      setMessage({
        tone: 'error',
        text: t(
          'Enter hours per week like 30h or 37h 30m, or leave it empty to clear it.',
        ),
      });
      return;
    }
    const result = await api(
      `/organizations/${slug}/workload/capacity/${person}`,
      { method: 'PUT', body: { weeklyMinutes: minutes } },
    );
    setMessage(
      result.ok
        ? { tone: 'info', text: t('Capacity saved.') }
        : {
            tone: 'error',
            text: describeFailure(result.status, t('Capacity was not saved.')),
          },
    );
    await load();
  }

  return (
    <>
      <p className="muted">
        <Link href={`/organizations/${slug}`}>{t('Organization')}</Link>{' '}
        {t('/ Workload')}
      </p>
      <h1>{t('Workload')}</h1>
      <p className="muted">
        Open tasks assigned to each person, by the week they are due, across the
        projects you can open. Where tasks have estimates, each week also shows
        the estimated hours against the person&apos;s weekly capacity; a task
        with several assignees counts a share for each.
      </p>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {status === 403 ? (
        <p>Guests cannot see the team&apos;s workload.</p>
      ) : !data ? (
        <p className="muted" role="status">
          {t('Loading…')}
        </p>
      ) : data.people.length === 0 ? (
        <p className="muted">
          {t('Nobody has open assigned tasks or a capacity yet.')}
        </p>
      ) : (
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label={t('Workload table')}
        >
          <table className="tasks-table workload">
            <caption className="visually-hidden">
              {t('Open tasks per person and week')}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('Person')}</th>
                <th scope="col">{t('Overdue')}</th>
                {data.weekStarts.map((w) => (
                  <th key={w} scope="col">
                    Week of {week.format(new Date(`${w}T00:00:00Z`))}
                  </th>
                ))}
                <th scope="col">{t('Later')}</th>
                <th scope="col">{t('No date')}</th>
                <th scope="col">{t('Total')}</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.userId}>
                  <th scope="row">
                    {p.displayName}
                    <br />
                    <span className="muted">
                      {p.capacityMinutes === null
                        ? 'No capacity set'
                        : `${formatDuration(p.capacityMinutes)} a week`}
                    </span>
                  </th>
                  <td className={p.overdue > 0 ? 'load-over' : 'load-0'}>
                    {p.overdue}
                  </td>
                  {p.weeks.map((count, i) => {
                    const minutes = p.weekMinutes[i] ?? 0;
                    const over =
                      p.capacityMinutes !== null && minutes > p.capacityMinutes;
                    return (
                      <td
                        key={data.weekStarts[i]}
                        className={over ? 'load-over' : level(count)}
                      >
                        {count}
                        {minutes > 0 ? (
                          <span className="load-hours">
                            {formatDuration(minutes)}
                            {p.capacityMinutes === null
                              ? ''
                              : ` of ${formatDuration(p.capacityMinutes)}`}
                            {over ? ', over capacity' : ''}
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                  <td>{p.later}</td>
                  <td>{p.noDueDate}</td>
                  <td>
                    <strong>{p.total}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {status === 200 ? (
        <section className="section" aria-labelledby="capacity-heading">
          <h2 id="capacity-heading">{t('Weekly capacity')}</h2>
          <form className="inline-form" onSubmit={(e) => void saveCapacity(e)}>
            {admin ? (
              <div className="field">
                <label htmlFor="capacityPerson">{t('Person')}</label>
                <select
                  id="capacityPerson"
                  name="person"
                  defaultValue={user.id}
                >
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <input type="hidden" name="person" value={user.id} />
            )}
            <div className="field">
              <label htmlFor="capacityHours">
                {admin ? t('Hours per week') : t('Your hours per week')}
              </label>
              <input
                id="capacityHours"
                name="hours"
                placeholder={t('e.g. 30h')}
                autoComplete="off"
              />
            </div>
            <button className="button secondary" type="submit">
              {t('Save capacity')}
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
