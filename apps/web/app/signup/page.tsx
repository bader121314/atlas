'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { AuthShell } from '../../components/auth-shell';
import { Field, Notice, value } from '../../components/form';
import { api, describeFailure } from '../../lib/api';
import { useT } from '../../lib/i18n';

export default function SignupPage() {
  const t = useT();
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState('busy');
    setError('');
    const result = await api('/auth/signup', {
      method: 'POST',
      body: {
        displayName: value(form, 'displayName'),
        email: value(form, 'email'),
        password: value(form, 'password'),
      },
    });
    if (result.status === 202) {
      setState('sent');
      return;
    }
    setState('idle');
    if (result.status === 403) {
      setError(
        t(
          'New accounts are closed on this demo. Sign in with the demo account shown on the sign-in page.',
        ),
      );
      return;
    }
    setError(
      describeFailure(
        result.status,
        t(
          'Check the details: use a valid email and a password of at least 12 characters.',
        ),
      ),
    );
  }

  if (state === 'sent') {
    return (
      <AuthShell title={t('Check your email')}>
        <Notice>
          <p>
            {t(
              'If this address can be used, a verification link is on its way. Open it to finish creating your account.',
            )}
          </p>
        </Notice>
        <p className="switch">
          <Link href="/login">{t('Go to sign in')}</Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('Create your account')}>
      <form className="form" onSubmit={submit} noValidate={false}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Field label={t('Your name')} name="displayName" autoComplete="name" />
        <Field
          label={t('Email')}
          name="email"
          type="email"
          autoComplete="email"
        />
        <Field
          label={t('Password')}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          hint="At least 12 characters. A short phrase is easier to remember."
        />
        <button className="button" type="submit" disabled={state === 'busy'}>
          {state === 'busy' ? t('Creating account…') : t('Create account')}
        </button>
      </form>
      <p className="switch">
        {t('Already have an account?')}{' '}
        <Link href="/login">{t('Sign in')}</Link>
      </p>
    </AuthShell>
  );
}
