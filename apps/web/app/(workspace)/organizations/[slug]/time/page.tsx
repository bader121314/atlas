'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../../../lib/api';
import { formatDuration } from '../../../../../lib/duration';

interface Report {
  from: string;
  to: string;
  everyone: boolean;
  totalMinutes: number;
  rows: {
    userId: string;
    displayName: string;
    projectKey: string;
    projectName: string;
    minutes: number;
  }[];
}

function isoDay(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

/** Time logged per person and project over a range (ADR-049). */
export default function TimeReportPage() {
  const { slug } = useParams<{ slug: string }>();
  const today = new Date();
  const [range, setRange] = useState({
    from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: isoDay(today),
  });
  const [report, setReport] = useState<Report>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void api<Report>(
      `/organizations/${slug}/time?from=${range.from}&to=${range.to}`,
    ).then((r) => {
      setFailed(!r.ok);
      setReport(r.data);
    });
  }, [slug, range]);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setRange({
      from: String(values.get('from')),
      to: String(values.get('to')),
    });
  }

  return (
    <>
      <p className="muted">
        <Link href={`/organizations/${slug}`}>Organization</Link> / Time
      </p>
      <h1>Time report</h1>
      <form className="inline-form" onSubmit={apply}>
        <div className="field">
          <label htmlFor="from">From</label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={range.from}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="to">To</label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={range.to}
            required
          />
        </div>
        <button className="button secondary" type="submit">
          Show
        </button>
      </form>
      {failed ? (
        <p role="alert">
          Choose a range of up to 93 days, with From before To.
        </p>
      ) : !report ? (
        <p className="muted" role="status">
          Loading…
        </p>
      ) : (
        <>
          <p className="muted section">
            {report.everyone
              ? 'Everyone’s time in the projects you can open.'
              : 'Your own time. Owners and admins see the whole team.'}
          </p>
          {report.rows.length === 0 ? (
            <p>No time logged in this range.</p>
          ) : (
            <div className="table-wrap">
              <table className="tasks-table">
                <caption className="visually-hidden">
                  Time logged per person and project
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Project</th>
                    <th scope="col">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={`${row.userId}:${row.projectKey}`}>
                      <th scope="row">{row.displayName}</th>
                      <td>
                        <Link
                          href={`/organizations/${slug}/projects/${row.projectKey}`}
                        >
                          {row.projectKey} {row.projectName}
                        </Link>
                      </td>
                      <td>{formatDuration(row.minutes)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={2}>
                      Total
                    </th>
                    <td>
                      <strong>{formatDuration(report.totalMinutes)}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
