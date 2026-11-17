'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, describeFailure } from '../lib/api';
import { Notice, value } from './form';

interface Link {
  id: string;
  prefix: string;
  createdBy: { displayName: string };
  expiresAt: string;
  lastUsedAt: string | null;
}

const day = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/** Public read-only links to this project's task list (ADR-050). */
export function ShareLinksSection({ base }: { base: string }) {
  const path = `${base}/share-links`;
  const [links, setLinks] = useState<Link[]>([]);
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const result = await api<Link[]>(path);
    setLinks(result.data ?? []);
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api<{ token: string }>(path, {
      method: 'POST',
      body: { expiresInDays: Number(value(event.currentTarget, 'shareDays')) },
    });
    if (result.data) {
      setUrl(`${window.location.origin}/share/${result.data.token}`);
      setError('');
    } else {
      setError(
        describeFailure(
          result.status,
          result.status === 409
            ? 'This project already has 10 public links. Revoke one first.'
            : 'The link could not be created.',
        ),
      );
    }
    await load();
  }

  async function revoke(link: Link) {
    if (
      !window.confirm('Revoke this link? Anyone using it loses access at once.')
    )
      return;
    await api(`${path}/${link.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <section className="section" aria-labelledby="share-heading">
      <h2 id="share-heading">Public links</h2>
      <p className="muted">
        Anyone with a link can see this project&apos;s task titles, statuses,
        priorities and due dates without signing in. Descriptions, people,
        comments and files are never shown. A link stops working when it
        expires, is revoked, the project is archived, or its creator stops
        managing the project.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {url ? (
        <Notice>
          <p>
            Copy this link now; it will not be shown again:{' '}
            <code className="secret">{url}</code>
          </p>
          <button
            className="button secondary small"
            type="button"
            onClick={() => setUrl(undefined)}
          >
            I have copied it
          </button>
        </Notice>
      ) : null}
      <ul className="rows">
        {links.map((link) => (
          <li key={link.id}>
            <span className="grow">
              <code>{link.prefix}…</code>
              <br />
              <span className="muted">
                By {link.createdBy.displayName}, expires{' '}
                {day.format(new Date(link.expiresAt))}
                {link.lastUsedAt
                  ? `, last opened ${day.format(new Date(link.lastUsedAt))}`
                  : ', never opened'}
              </span>
            </span>
            <button
              className="button danger small"
              type="button"
              onClick={() => void revoke(link)}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      <form className="inline-form section" onSubmit={create}>
        <div className="field">
          <label htmlFor="shareDays">Expires after</label>
          <select id="shareDays" name="shareDays" defaultValue="30">
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
        </div>
        <button className="button secondary" type="submit">
          Create public link
        </button>
      </form>
    </section>
  );
}
