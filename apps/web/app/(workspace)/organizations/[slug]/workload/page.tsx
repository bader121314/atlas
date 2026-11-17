'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../../../../../lib/api';

interface Person {
  userId: string;
  displayName: string;
  overdue: number;
  weeks: number[];
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
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<{
    weekStarts: string[];
    people: Person[];
  }>();
  const [status, setStatus] = useState<number>();

  useEffect(() => {
    void api<{ weekStarts: string[]; people: Person[] }>(
      `/organizations/${slug}/workload?weeks=6`,
    ).then((r) => {
      setStatus(r.status);
      setData(r.data);
    });
  }, [slug]);

  return (
    <>
      <p className="muted">
        <Link href={`/organizations/${slug}`}>Organization</Link> / Workload
      </p>
      <h1>Workload</h1>
      <p className="muted">
        Open tasks assigned to each person, by the week they are due, across the
        projects you can open.
      </p>
      {status === 403 ? (
        <p>Guests cannot see the team&apos;s workload.</p>
      ) : !data ? (
        <p className="muted" role="status">
          Loading…
        </p>
      ) : data.people.length === 0 ? (
        <p className="muted">Nobody has open assigned tasks.</p>
      ) : (
        <div className="table-wrap">
          <table className="tasks-table workload">
            <caption className="visually-hidden">
              Open tasks per person and week
            </caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Overdue</th>
                {data.weekStarts.map((w) => (
                  <th key={w} scope="col">
                    Week of {week.format(new Date(`${w}T00:00:00Z`))}
                  </th>
                ))}
                <th scope="col">Later</th>
                <th scope="col">No date</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.userId}>
                  <th scope="row">{p.displayName}</th>
                  <td className={p.overdue > 0 ? 'load-over' : 'load-0'}>
                    {p.overdue}
                  </td>
                  {p.weeks.map((count, i) => (
                    <td key={data.weekStarts[i]} className={level(count)}>
                      {count}
                    </td>
                  ))}
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
    </>
  );
}
