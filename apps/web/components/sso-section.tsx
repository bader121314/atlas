'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, describeFailure } from '../lib/api';
import { Notice, value } from './form';
import { useT } from '../lib/i18n';

interface Connection {
  issuer: string;
  clientId: string;
  enabled: boolean;
  requireSso: boolean;
  redirectUri: string;
}

/** OpenID Connect settings for owners (ADR-058). */
export function SsoSection({ slug }: { slug: string }) {
  const t = useT();
  const path = `/organizations/${slug}/sso`;
  const [connection, setConnection] = useState<Connection | null>();
  const [message, setMessage] = useState<{
    tone: 'info' | 'error';
    text: string;
  }>();

  const load = useCallback(async () => {
    const result = await api<Connection>(path);
    setConnection(result.data ?? null);
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const checked = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement).checked;
    const secret = value(form, 'ssoSecret');
    const result = await api<Connection>(path, {
      method: 'PUT',
      body: {
        issuer: value(form, 'ssoIssuer'),
        clientId: value(form, 'ssoClientId'),
        ...(secret ? { clientSecret: secret } : {}),
        enabled: checked('ssoEnabled'),
        requireSso: checked('ssoEnabled') && checked('ssoRequire'),
      },
    });
    if (result.data) {
      setConnection(result.data);
      setMessage({ tone: 'info', text: t('Single sign-on settings saved.') });
      (form.elements.namedItem('ssoSecret') as HTMLInputElement).value = '';
    } else {
      setMessage({
        tone: 'error',
        text: describeFailure(
          result.status,
          t(
            'Settings were not saved. Check the issuer URL, enter the client secret, and verify a domain before enabling.',
          ),
        ),
      });
    }
  }

  async function remove() {
    if (
      !window.confirm(
        t('Remove single sign-on? People sign in with passwords again.'),
      )
    )
      return;
    await api(path, { method: 'DELETE' });
    setMessage({ tone: 'info', text: t('Single sign-on removed.') });
    await load();
  }

  if (connection === undefined) return null;
  return (
    <section className="section" aria-labelledby="sso-heading">
      <h2 id="sso-heading">{t('Single sign-on')}</h2>
      <p className="muted">
        {t(
          'People with addresses on your verified domains sign in through your OpenID Connect provider and join as members. Register this redirect URL with the provider:',
        )}{' '}
        <code>
          {connection?.redirectUri ??
            (typeof window === 'undefined'
              ? ''
              : `${window.location.origin}/api/auth/sso/callback`)}
        </code>
      </p>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <form className="form" onSubmit={(e) => void save(e)}>
        <div className="field">
          <label htmlFor="ssoIssuer">{t('Issuer URL')}</label>
          <input
            id="ssoIssuer"
            name="ssoIssuer"
            type="url"
            required
            defaultValue={connection?.issuer ?? ''}
            placeholder={t('https://login.example.com')}
          />
        </div>
        <div className="field">
          <label htmlFor="ssoClientId">{t('Client ID')}</label>
          <input
            id="ssoClientId"
            name="ssoClientId"
            required
            defaultValue={connection?.clientId ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor="ssoSecret">
            {t('Client secret')}
            {connection ? ` ${t('(leave empty to keep the saved one)')}` : ''}
          </label>
          <input
            id="ssoSecret"
            name="ssoSecret"
            type="password"
            autoComplete="off"
            required={!connection}
          />
        </div>
        <label className="checks inline">
          <input
            type="checkbox"
            name="ssoEnabled"
            defaultChecked={connection?.enabled ?? false}
          />
          {t('Allow single sign-on')}
        </label>
        <label className="checks inline">
          <input
            type="checkbox"
            name="ssoRequire"
            defaultChecked={connection?.requireSso ?? false}
          />
          {t('Require it for everyone on our domains except owners')}
        </label>
        <div className="actions">
          <button className="button secondary" type="submit">
            {t('Save')}
          </button>
          {connection ? (
            <button
              className="button danger"
              type="button"
              onClick={() => void remove()}
            >
              {t('Remove single sign-on')}
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
