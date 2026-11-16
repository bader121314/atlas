'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { FormEvent } from 'react';
import { AuthShell } from '../../components/auth-shell';
import { Field, Notice, value } from '../../components/form';
import { api, describeFailure } from '../../lib/api';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState('busy');
    const result = await api('/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, password: value(form, 'password') },
    });
    if (result.ok) {
      setState('done');
      return;
    }
    setState('idle');
    setError(
      describeFailure(
        result.status,
        'The password must be at least 12 characters, and the link must be the most recent one, used within 1 hour.',
      ),
    );
  }

  if (state === 'done') {
    return (
      <>
        <Notice>
          <p>Your password is changed and every device has been signed out.</p>
        </Notice>
        <p className="switch">
          <Link className="button" href="/login">
            Sign in
          </Link>
        </p>
      </>
    );
  }
  return (
    <form className="form" onSubmit={submit}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        hint="At least 12 characters."
      />
      <button
        className="button"
        type="submit"
        disabled={!token || state === 'busy'}
      >
        {state === 'busy' ? 'Saving…' : 'Save new password'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Choose a new password">
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
