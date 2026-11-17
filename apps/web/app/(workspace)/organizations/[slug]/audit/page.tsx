'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../../../../lib/api';

interface AuditEvent {
  id: string;
  action: string;
  actor: { userId: string; displayName: string } | null;
  target: { type: string; id: string } | null;
  ipSummary: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

const when = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const FILTERS: [string, string][] = [
  ['', 'Everything'],
  ['org.member', 'Members'],
  ['org.invitation', 'Invitations'],
  ['project', 'Projects'],
  ['api_token', 'API tokens'],
  ['share_link', 'Public links'],
  ['org.audit', 'Audit exports'],
];

function details(metadata: Record<string, unknown>): string {
  return Object.entries(metadata)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(', ');
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The organization's audit log for owners and admins (ADR-051). */
export default function AuditPage() {
  const { slug } = useParams<{ slug: string }>();
  const [action, setAction] = useState('');
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [status, setStatus] = useState<number>();
  const base = `/organizations/${slug}/audit-events`;

  const load = useCallback(
    async (before: string | null) => {
      const query = new URLSearchParams({ limit: '50' });
      if (action) query.set('action', action);
      if (before) query.set('before', before);
      const result = await api<{
        items: AuditEvent[];
        nextBefore: string | null;
      }>(`${base}?${query.toString()}`);
      setStatus(result.status);
      if (!result.data) return;
      const page = result.data;
      setItems((current) =>
        before ? [...current, ...page.items] : page.items,
      );
      setNext(page.nextBefore);
    },
    [base, action],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    window.location.href = `/api${base}/export?from=${String(values.get('from'))}&to=${String(values.get('to'))}`;
  }

  const today = new Date();
  return (
    <>
      <p className="muted">
        <Link href={`/organizations/${slug}`}>Organization</Link> / Audit log
      </p>
      <h1>Audit log</h1>
      {status === 403 ? (
        <p>Only owners and admins can read the audit log.</p>
      ) : (
        <>
          <p className="muted">
            Changes to this organization&apos;s members, projects, tokens and
            links. Networks are shortened to protect privacy; sign-ins belong to
            each person&apos;s own account.
          </p>
          <div className="field">
            <label htmlFor="auditFilter">Show</label>
            <select
              id="auditFilter"
              value={action}
              onChange={(event) => setAction(event.target.value)}
            >
              {FILTERS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {items.length === 0 && status === 200 ? (
            <p>Nothing recorded yet.</p>
          ) : null}
          {items.length > 0 ? (
            // Focusable so keyboard users can scroll a wide table.
            <div
              className="table-wrap section"
              tabIndex={0}
              role="region"
              aria-label="Audit events"
            >
              <table className="tasks-table">
                <caption className="visually-hidden">
                  Audit events, newest first
                </caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Action</th>
                    <th scope="col">By</th>
                    <th scope="col">Details</th>
                    <th scope="col">Network</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{when.format(new Date(item.occurredAt))}</td>
                      <th scope="row">
                        <code>{item.action}</code>
                      </th>
                      <td>{item.actor?.displayName ?? 'System'}</td>
                      <td>{details(item.metadata)}</td>
                      <td>{item.ipSummary ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {next ? (
            <button
              className="button secondary section"
              type="button"
              onClick={() => void load(next)}
            >
              Show older events
            </button>
          ) : null}
          <section className="section" aria-labelledby="audit-export-heading">
            <h2 id="audit-export-heading">Download</h2>
            <p className="muted">
              A CSV of every event in the range (UTC days, up to a year). The
              download is recorded in the log.
            </p>
            <form className="inline-form" onSubmit={download}>
              <div className="field">
                <label htmlFor="auditFrom">From</label>
                <input
                  id="auditFrom"
                  name="from"
                  type="date"
                  required
                  defaultValue={isoDay(
                    new Date(today.getTime() - 30 * 86_400_000),
                  )}
                />
              </div>
              <div className="field">
                <label htmlFor="auditTo">To</label>
                <input
                  id="auditTo"
                  name="to"
                  type="date"
                  required
                  defaultValue={isoDay(today)}
                />
              </div>
              <button className="button secondary" type="submit">
                Download CSV
              </button>
            </form>
          </section>
        </>
      )}
    </>
  );
}
