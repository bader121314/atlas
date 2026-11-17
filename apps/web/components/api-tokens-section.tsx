'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, describeFailure } from '../lib/api';
import { Notice, value } from './form';
import { useT } from '../lib/i18n';

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
  const t = useT();
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
        describeFailure(result.status, t('The token could not be created.')),
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
      <h2 id="tokens-heading">{t('Your API tokens')}</h2>
      <p className="muted">
        {t(
          'For scripts: send the header {header}. A token can read or change tasks in projects you can open in this organization, and nothing else.',
          { header: 'Authorization: Bearer <token>' },
        )}
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
            {t('I have saved it')}
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
              {t('Revoke')}
            </button>
          </li>
        ))}
      </ul>
      <form className="inline-form section" onSubmit={create}>
        <div className="field">
          <label htmlFor="tokenName">{t('Token name')}</label>
          <input id="tokenName" name="tokenName" required maxLength={60} />
        </div>
        <div className="field">
          <label htmlFor="tokenDays">{t('Expires after')}</label>
          <select id="tokenDays" name="tokenDays" defaultValue="90">
            <option value="7">{t('7 days')}</option>
            <option value="30">{t('30 days')}</option>
            <option value="90">{t('90 days')}</option>
            <option value="365">{t('1 year')}</option>
          </select>
        </div>
        <label className="checks inline">
          <input type="checkbox" name="tokenWrite" />
          {t('Can change tasks')}
        </label>
        <button className="button secondary" type="submit">
          {t('Create token')}
        </button>
      </form>
    </section>
  );
}
