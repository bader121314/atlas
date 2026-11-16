'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { AuthShell } from '../../components/auth-shell';
import { Field, Notice, value } from '../../components/form';
import { api, describeFailure } from '../../lib/api';

export default function ForgotPasswordPage() {
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
      describeFailure(result.status, 'Enter the email you sign in with.'),
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      intro={<p>We will email you a link to choose a new password.</p>}
    >
      {state === 'sent' ? (
        <Notice>
          <p>
            If an account uses that address, a reset link is on its way. It
            works once and expires in 1 hour.
          </p>
        </Notice>
      ) : (
        <form className="form" onSubmit={submit}>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Field label="Email" name="email" type="email" autoComplete="email" />
          <button className="button" type="submit" disabled={state === 'busy'}>
            {state === 'busy' ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <p className="switch">
        <Link href="/login">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}
