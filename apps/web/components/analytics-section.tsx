'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Analytics {
  total: number;
  done: number;
  overdue: number;
  unassigned: number;
  byState: { stateId: string; label: string; count: number }[];
  weeks: { weekStart: string; created: number; completed: number }[];
  medianLeadDays: number | null;
  openByAssignee: { userId: string; displayName: string; open: number }[];
}

const week = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** Project numbers: totals, tasks per status and an eight-week trend. */
export function AnalyticsSection({
  base,
  refreshKey,
}: {
  base: string;
  refreshKey: number;
}) {
  const [data, setData] = useState<Analytics>();

  useEffect(() => {
    void api<Analytics>(`${base}/analytics`).then((r) => setData(r.data));
  }, [base, refreshKey]);

  if (!data || data.total === 0) return null;
  const peak = Math.max(
    1,
    ...data.weeks.flatMap((w) => [w.created, w.completed]),
  );
  const percent = Math.round((data.done / data.total) * 100);
  return (
    <section className="section" aria-labelledby="numbers-heading">
      <h2 id="numbers-heading">Project numbers</h2>
      <dl className="stats">
        <div>
          <dt>Done</dt>
          <dd>
            {data.done} of {data.total} ({percent}%)
          </dd>
        </div>
        <div>
          <dt>Overdue</dt>
          <dd className={data.overdue > 0 ? 'priority-high' : undefined}>
            {data.overdue}
          </dd>
        </div>
        <div>
          <dt>Open and unassigned</dt>
          <dd>{data.unassigned}</dd>
        </div>
        <div>
          <dt>Typical time to finish</dt>
          <dd>
            {data.medianLeadDays === null
              ? 'Not enough finished tasks'
              : `${data.medianLeadDays} days (median, last 90 days)`}
          </dd>
        </div>
      </dl>
      <div className="numbers-grid">
        <table className="tasks-table">
          <caption>Tasks by status</caption>
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Tasks</th>
            </tr>
          </thead>
          <tbody>
            {data.byState.map((s) => (
              <tr key={s.stateId}>
                <th scope="row">{s.label}</th>
                <td>{s.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="tasks-table trend">
          <caption>Created and finished per week</caption>
          <thead>
            <tr>
              <th scope="col">Week of</th>
              <th scope="col">Created</th>
              <th scope="col">Finished</th>
            </tr>
          </thead>
          <tbody>
            {data.weeks.map((w) => (
              <tr key={w.weekStart}>
                <th scope="row">
                  {week.format(new Date(`${w.weekStart}T00:00:00Z`))}
                </th>
                <td>
                  <span
                    className="bar created"
                    style={{ inlineSize: `${(w.created / peak) * 4}rem` }}
                    aria-hidden="true"
                  />
                  {w.created}
                </td>
                <td>
                  <span
                    className="bar completed"
                    style={{ inlineSize: `${(w.completed / peak) * 4}rem` }}
                    aria-hidden="true"
                  />
                  {w.completed}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.openByAssignee.length > 0 ? (
          <table className="tasks-table">
            <caption>Open tasks by assignee</caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Open</th>
              </tr>
            </thead>
            <tbody>
              {data.openByAssignee.map((p) => (
                <tr key={p.userId}>
                  <th scope="row">{p.displayName}</th>
                  <td>{p.open}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}
