'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { AuthShell } from '../../components/auth-shell';
import { Field, Notice, value } from '../../components/form';
import { api, describeFailure } from '../../lib/api';
import { useT } from '../../lib/i18n';

export default function ForgotPasswordPage() {
  const t = useT();
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState('busy');
    const result = await api('/auth/password-reset/request', {
      method: 'POST',
      body: { email: value(form, 'email') },
    });
    if (result.status === 202) {
      setState('sent');
      return;
    }
    setState('idle');
    setError(
      describeFailure(result.status, t('Enter the email you sign in with.')),
    );
  }

  return (
    <AuthShell
      title={t('Reset your password')}
      intro={<p>{t('We will email you a link to choose a new password.')}</p>}
    >
      {state === 'sent' ? (
        <Notice>
          <p>
            {t(
              'If an account uses that address, a reset link is on its way. It works once and expires in 1 hour.',
            )}
          </p>
        </Notice>
      ) : (
        <form className="form" onSubmit={submit}>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Field
            label={t('Email')}
            name="email"
            type="email"
            autoComplete="email"
          />
          <button className="button" type="submit" disabled={state === 'busy'}>
            {state === 'busy' ? t('Sending…') : t('Send reset link')}
          </button>
        </form>
      )}
      <p className="switch">
        <Link href="/login">{t('Back to sign in')}</Link>
      </p>
    </AuthShell>
  );
}
