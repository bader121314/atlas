'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { FormEvent } from 'react';
import { AuthShell } from '../../../components/auth-shell';
import { Field, Notice, value } from '../../../components/form';

const ERRORS: Record<string, string> = {
  unavailable:
    'Single sign-on is not set up for that email address. Sign in with your password instead.',
  failed:
    'Single sign-on did not complete. Try again, or ask your administrator to check the setup.',
  suspended:
    'Your membership is suspended. Ask an owner or admin of your organization.',
};

function SsoForm() {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const error = ERRORS[params.get('error') ?? ''];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const email = value(event.currentTarget, 'email');
    // A full navigation: the API sends the browser on to the provider.
    window.location.assign(
      `/api/auth/sso/start?email=${encodeURIComponent(email)}`,
    );
  }

  return (
    <>
      <form className="form" onSubmit={submit}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Field
          label="Work email"
          name="email"
          type="email"
          autoComplete="email"
        />
        <button className="button" type="submit" disabled={busy}>
          {busy ? 'Continuing…' : 'Continue'}
        </button>
      </form>
      <p className="switch">
        <Link href="/login">Sign in with a password</Link>
      </p>
    </>
  );
}

/** Starts sign-in with the organization's identity provider (ADR-058). */
export default function SsoLoginPage() {
  return (
    <AuthShell
      title="Single sign-on"
      intro="Enter your work email and we will send you to your organization's sign-in page."
    >
      <Suspense>
        <SsoForm />
      </Suspense>
    </AuthShell>
  );
}
