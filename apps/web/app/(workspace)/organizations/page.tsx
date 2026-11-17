'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useShell } from '../../../components/app-shell';
import { Notice, value } from '../../../components/form';
import { api, describeFailure } from '../../../lib/api';
import type { Organization } from '../../../lib/api';
import { useT } from '../../../lib/i18n';

function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

export default function OrganizationsPage() {
  const t = useT();
  const router = useRouter();
  const { user, organizations, refreshOrganizations } = useShell();
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    const result = await api<Organization>('/organizations', {
      method: 'POST',
      body: { name: value(form, 'name'), slug },
    });
    setBusy(false);
    if (result.ok && result.data) {
      await refreshOrganizations();
      router.push(`/organizations/${result.data.slug}`);
      return;
    }
    setError(
      result.status === 409
        ? 'That web address is taken. Choose another.'
        : describeFailure(
            result.status,
            t(
              'Use 3–63 lowercase letters, numbers or hyphens for the web address.',
            ),
          ),
    );
  }

  return (
    <>
      <h1>{t('Your organizations')}</h1>
      <p className="muted">Signed in as {user.email}</p>
      {organizations.length === 0 ? (
        <p>
          {t(
            'You are not part of any organization yet. Create one below, or open an invitation link someone sent you.',
          )}
        </p>
      ) : (
        <ul className="rows">
          {organizations.map((org) => (
            <li key={org.id}>
              <span className="grow">
                <Link className="title" href={`/organizations/${org.slug}`}>
                  {org.name}
                </Link>
                <br />
                <span className="muted">/{org.slug}</span>
              </span>
              <span className="role">{org.role}</span>
            </li>
          ))}
        </ul>
      )}

      <section className="section" aria-labelledby="create-heading">
        <h2 id="create-heading">{t('Create an organization')}</h2>
        <form className="form" onSubmit={create}>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="field">
            <label htmlFor="name">{t('Name')}</label>
            <input
              id="name"
              name="name"
              required
              maxLength={100}
              onChange={(event) => {
                if (!slugEdited) setSlug(suggestSlug(event.target.value));
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="slug">{t('Web address')}</label>
            <input
              id="slug"
              name="slug"
              required
              minLength={3}
              maxLength={63}
              pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
              value={slug}
              aria-describedby="slug-hint"
              onChange={(event) => {
                setSlugEdited(true);
                setSlug(event.target.value);
              }}
            />
            <span className="hint" id="slug-hint">
              Lowercase letters, numbers and hyphens. Appears in links as
              /organizations/{slug || 'your-team'}.
            </span>
          </div>
          <button className="button" type="submit" disabled={busy}>
            {busy ? t('Creating…') : t('Create organization')}
          </button>
        </form>
      </section>
    </>
  );
}
