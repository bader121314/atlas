'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AuthShell } from '../../components/auth-shell';
import { Field, Notice, safeNext, value } from '../../components/form';
import { api, describeFailure } from '../../lib/api';
import { useT } from '../../lib/i18n';

function LoginForm() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demo, setDemo] = useState<{ email: string; password: string }>();

  // A public demo shares one account (ADR-062); elsewhere this is a 404.
  useEffect(() => {
    void api<{ email: string; password: string }>('/auth/demo').then((r) =>
      setDemo(r.data),
    );
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    const result = await api('/auth/login', {
      method: 'POST',
      body: { email: value(form, 'email'), password: value(form, 'password') },
    });
    if (result.ok) {
      router.replace(safeNext(params.get('next')));
      return;
    }
    setBusy(false);
    if (result.status === 403) {
      setError(
        t(
          'Your organization requires single sign-on. Use "Sign in with single sign-on" below.',
        ),
      );
      return;
    }
    setError(
      describeFailure(
        result.status,
        t(
          'Email or password is incorrect, or the email has not been verified yet.',
        ),
      ),
    );
  }

  return (
    <>
      <form className="form" onSubmit={submit}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {demo ? (
          <Notice>
            <p>
              {t(
                'This is a public demo with fictional data. Sign in as {email} with the password {password}. Anyone can see and change the demo, so do not enter anything private.',
                { email: demo.email, password: demo.password },
              )}
            </p>
            <button
              className="button secondary small"
              type="button"
              onClick={(event) => {
                const form = event.currentTarget.form;
                const set = (name: string, text: string) => {
                  const input = form?.elements.namedItem(name);
                  if (input instanceof HTMLInputElement) input.value = text;
                };
                set('email', demo.email);
                set('password', demo.password);
              }}
            >
              {t('Fill in the demo account')}
            </button>
          </Notice>
        ) : null}
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
          autoComplete="current-password"
        />
        <button className="button" type="submit" disabled={busy}>
          {busy ? t('Signing in…') : t('Sign in')}
        </button>
      </form>
      <p className="switch">
        <Link href="/forgot-password">{t('Forgot your password?')}</Link>
      </p>
      <p>
        <Link href="/login/sso">{t('Sign in with single sign-on')}</Link>
      </p>
      <p>
        {t('New to Atlas?')}{' '}
        <Link href="/signup">{t('Create an account')}</Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  const t = useT();
  return (
    <AuthShell title={t('Sign in')}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
