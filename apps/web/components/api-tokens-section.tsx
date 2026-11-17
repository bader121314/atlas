'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, describeFailure } from '../lib/api';
import { Notice, value } from './form';

interface Token {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string;
  lastUsedAt: string | null;
}

const day = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/** Personal API tokens for scripts in this organization (ADR-037). */
export function ApiTokensSection({ slug }: { slug: string }) {
  const base = `/organizations/${slug}/api-tokens`;
  const [tokens, setTokens] = useState<Token[]>([]);
  const [secret, setSecret] = useState<string>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const result = await api<Token[]>(base);
    setTokens(result.data ?? []);
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const write = (form.elements.namedItem('tokenWrite') as HTMLInputElement)
      .checked;
    const result = await api<{ secret: string }>(base, {
      method: 'POST',
      body: {
        name: value(form, 'tokenName'),
        scopes: write ? ['tasks:read', 'tasks:write'] : ['tasks:read'],
        expiresInDays: Number(value(form, 'tokenDays')),
      },
    });
    if (result.data) {
      setSecret(result.data.secret);
      setError('');
      form.reset();
    } else {
      setError(
        describeFailure(result.status, 'The token could not be created.'),
      );
    }
    await load();
  }

  async function revoke(token: Token) {
    if (
      !window.confirm(
        `Revoke ${token.name}? Scripts using it stop working at once.`,
      )
    )
      return;
    await api(`${base}/${token.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <section className="section" aria-labelledby="tokens-heading">
      <h2 id="tokens-heading">Your API tokens</h2>
      <p className="muted">
        For scripts: send <code>Authorization: Bearer &lt;token&gt;</code>. A
        token can read or change tasks in projects you can open in this
        organization, and nothing else.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {secret ? (
        <Notice>
          <p>
            Copy this token now; it will not be shown again:{' '}
            <code className="secret">{secret}</code>
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
              <span className="title">{token.name}</span>{' '}
              <code>{token.prefix}…</code>
              <br />
              <span className="muted">
                {token.scopes.includes('tasks:write')
                  ? 'Read and change tasks'
                  : 'Read tasks'}
                , expires {day.format(new Date(token.expiresAt))}
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
      <form className="inline-form section" onSubmit={create}>
        <div className="field">
          <label htmlFor="tokenName">Token name</label>
          <input id="tokenName" name="tokenName" required maxLength={60} />
        </div>
        <div className="field">
          <label htmlFor="tokenDays">Expires after</label>
          <select id="tokenDays" name="tokenDays" defaultValue="90">
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </select>
        </div>
        <label className="checks inline">
          <input type="checkbox" name="tokenWrite" />
          Can change tasks
        </label>
        <button className="button secondary" type="submit">
          Create token
        </button>
      </form>
    </section>
  );
}
