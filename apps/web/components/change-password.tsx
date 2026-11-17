'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, describeFailure } from '../lib/api';
import { Notice, value } from './form';
import { useT } from '../lib/i18n';

/** Change the password while signed in; other devices are signed out. */
export function ChangePasswordSection({
  onChanged,
}: {
  onChanged: () => void;
}) {
  const t = useT();
  const [message, setMessage] = useState<{
    tone: 'info' | 'error';
    text: string;
  }>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const next = value(form, 'newPassword');
    if (next !== value(form, 'confirmPassword')) {
      setMessage({ tone: 'error', text: t('The new passwords do not match.') });
      return;
    }
    const result = await api('/auth/password', {
      method: 'POST',
      body: {
        currentPassword: value(form, 'currentPassword'),
        newPassword: next,
      },
    });
    if (result.ok) {
      form.reset();
      setMessage({
        tone: 'info',
        text: t('Password changed. Your other devices are signed out.'),
      });
      onChanged();
    } else {
      setMessage({
        tone: 'error',
        text: describeFailure(
          result.status,
          t(
            'Check your current password. The new one needs at least 12 characters.',
          ),
        ),
      });
    }
  }

  return (
    <section className="section" aria-labelledby="password-heading">
      <h2 id="password-heading">{t('Change password')}</h2>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <form className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="currentPassword">{t('Current password')}</label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="newPassword">{t('New password')}</label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="confirmPassword">{t('New password again')}</label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </div>
        <button className="button secondary" type="submit">
          {t('Change password')}
        </button>
      </form>
    </section>
  );
}
