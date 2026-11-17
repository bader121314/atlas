'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, describeFailure } from '../lib/api';
import { Notice } from './form';

interface Token {
  id: string;
  prefix: string;
  createdBy: { displayName: string };
  createdAt: string;
  lastUsedAt: string | null;
}

const day = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/** SCIM provisioning setup for owners (ADR-055). */
export function ScimSection({ slug }: { slug: string }) {
  const base = `/organizations/${slug}/scim-tokens`;
  const [tokens, setTokens] = useState<Token[]>([]);
  const [secret, setSecret] = useState<string>();
  const [error, setError] = useState('');
  const [origin, setOrigin] = useState('');

  const load = useCallback(async () => {
    const result = await api<Token[]>(base);
    setTokens(result.data ?? []);
  }, [base]);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, [load]);

  async function create() {
    const result = await api<{ secret: string }>(base, { method: 'POST' });
    if (result.data) {
      setSecret(result.data.secret);
      setError('');
    } else {
      setError(
        describeFailure(
          result.status,
          result.status === 409
            ? 'There are already two tokens. Revoke one before creating another.'
            : 'The token could not be created.',
        ),
      );
    }
    await load();
  }

  async function revoke(token: Token) {
    if (
      !window.confirm(
        'Revoke this token? Your identity provider stops syncing until it has a new one.',
      )
    )
      return;
    await api(`${base}/${token.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <section className="section" aria-labelledby="scim-heading">
      <h2 id="scim-heading">Provisioning (SCIM)</h2>
      <p className="muted">
        Let your identity provider (Okta, Microsoft Entra ID and others) add,
        suspend and remove members. People it adds join as members; owners and
        admins are never changed by it, and it cannot edit anyone&apos;s name,
        email or password.
      </p>
      <p>
        SCIM base URL: <code>{origin}/api/scim/v2</code>
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {secret ? (
        <Notice>
          <p>
            Copy this token into your identity provider now; it will not be
            shown again: <code className="secret">{secret}</code>
          </p>
          <button
            className="button secondary small"
            type="button"
            onClick={() => setSecret(undefined)}
          >
            I have saved it
          </button>
        </Notice>
      ) : null}
      <ul className="rows">
        {tokens.map((token) => (
          <li key={token.id}>
            <span className="grow">
              <code>{token.prefix}…</code>
              <br />
              <span className="muted">
                By {token.createdBy.displayName},{' '}
                {day.format(new Date(token.createdAt))}
                {token.lastUsedAt
                  ? `, last used ${day.format(new Date(token.lastUsedAt))}`
                  : ', never used'}
              </span>
            </span>
            <button
              className="button danger small"
              type="button"
              onClick={() => void revoke(token)}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      <button
        className="button secondary"
        type="button"
        onClick={() => void create()}
      >
        Create SCIM token
      </button>
    </section>
  );
}
