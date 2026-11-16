'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { AuthShell } from '../../components/auth-shell';
import { Field, Notice, value } from '../../components/form';
import { api, describeFailure } from '../../lib/api';

export default function SignupPage() {
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
    setError(
      describeFailure(
        result.status,
        'Check the details: use a valid email and a password of at least 12 characters.',
      ),
    );
  }

  if (state === 'sent') {
    return (
      <AuthShell title="Check your email">
        <Notice>
          <p>
            If this address can be used, a verification link is on its way. Open
            it to finish creating your account.
          </p>
        </Notice>
        <p className="switch">
          <Link href="/login">Go to sign in</Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account">
      <form className="form" onSubmit={submit} noValidate={false}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Field label="Your name" name="displayName" autoComplete="name" />
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          hint="At least 12 characters. A short phrase is easier to remember."
        />
        <button className="button" type="submit" disabled={state === 'busy'}>
          {state === 'busy' ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="switch">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </AuthShell>
  );
}
