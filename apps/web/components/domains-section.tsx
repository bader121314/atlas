'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, describeFailure } from '../lib/api';
import { Notice, value } from './form';
import { useT } from '../lib/i18n';

interface Domain {
  id: string;
  domain: string;
  verified: boolean;
  record: { name: string; value: string };
}

/** Email domains the organization proves it controls (ADR-057). */
export function DomainsSection({ slug }: { slug: string }) {
  const t = useT();
  const base = `/organizations/${slug}/domains`;
  const [domains, setDomains] = useState<Domain[]>([]);
  const [message, setMessage] = useState<{
    tone: 'info' | 'error';
    text: string;
  }>();

  const load = useCallback(async () => {
    const result = await api<Domain[]>(base);
    setDomains(result.data ?? []);
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await api(base, {
      method: 'POST',
      body: { domain: value(form, 'domainName') },
    });
    if (result.ok) {
      form.reset();
      setMessage({
        tone: 'info',
        text: t('Domain added. Publish the TXT record below, then verify.'),
      });
    } else {
      setMessage({
        tone: 'error',
        text: describeFailure(
          result.status,
          result.status === 409
            ? t('That domain is already listed, or the limit of 10 is reached.')
            : 'Enter a domain such as example.com.',
        ),
      });
    }
    await load();
  }

  async function verify(domain: Domain) {
    const result = await api(`${base}/${domain.id}/verify`, { method: 'POST' });
    setMessage(
      result.ok
        ? {
            tone: 'info',
            text: t('{domain} is verified.', { domain: domain.domain }),
          }
        : {
            tone: 'error',
            text: describeFailure(
              result.status,
              t(
                'The TXT record for {domain} was not found, or another organization has verified it. DNS changes can take a while to appear.',
                { domain: domain.domain },
              ),
            ),
          },
    );
    await load();
  }

  async function remove(domain: Domain) {
    if (!window.confirm(`Remove ${domain.domain}?`)) return;
    await api(`${base}/${domain.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <section className="section" aria-labelledby="domains-heading">
      <h2 id="domains-heading">{t('Verified domains')}</h2>
      <p className="muted">
        {t(
          'Prove your organization controls an email domain by publishing a DNS TXT record. Once a domain is verified, provisioning only adds people with addresses on your verified domains.',
        )}
      </p>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <ul className="rows">
        {domains.map((domain) => (
          <li key={domain.id}>
            <span className="grow">
              <span className="title">{domain.domain}</span>{' '}
              <span className="muted">
                {domain.verified ? t('Verified') : t('Not verified yet')}
              </span>
              {domain.verified ? null : (
                <>
                  <br />
                  <span className="muted">
                    {t('TXT record')} <code>{domain.record.name}</code> with
                    value <code className="secret">{domain.record.value}</code>
                  </span>
                </>
              )}
            </span>
            {domain.verified ? null : (
              <button
                className="button secondary small"
                type="button"
                onClick={() => void verify(domain)}
              >
                {t('Verify')}
              </button>
            )}
            <button
              className="button danger small"
              type="button"
              onClick={() => void remove(domain)}
            >
              {t('Remove')}
            </button>
          </li>
        ))}
      </ul>
      <form className="inline-form section" onSubmit={(e) => void add(e)}>
        <div className="field">
          <label htmlFor="domainName">{t('Domain')}</label>
          <input
            id="domainName"
            name="domainName"
            placeholder={t('example.com')}
            required
            maxLength={253}
            autoComplete="off"
          />
        </div>
        <button className="button secondary" type="submit">
          {t('Add domain')}
        </button>
      </form>
    </section>
  );
}
