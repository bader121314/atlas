'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { FormEvent } from 'react';
import { AuthShell } from '../../components/auth-shell';
import { Field, Notice, safeNext, value } from '../../components/form';
import { api, describeFailure } from '../../lib/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
        'Your organization requires single sign-on. Use "Sign in with single sign-on" below.',
      );
      return;
    }
    setError(
      describeFailure(
        result.status,
        'Email or password is incorrect, or the email has not been verified yet.',
      ),
    );
  }

  return (
    <>
      <form className="form" onSubmit={submit}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
        />
        <button className="button" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="switch">
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
      <p>
        <Link href="/login/sso">Sign in with single sign-on</Link>
      </p>
      <p>
        New to Atlas? <Link href="/signup">Create an account</Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <AuthShell title="Sign in">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
