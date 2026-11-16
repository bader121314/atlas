'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthShell } from '../../components/auth-shell';
import { Notice } from '../../components/form';
import { api, describeFailure } from '../../lib/api';

// Verification needs a click: link scanners in mail clients often open links
// automatically, and a GET must never change state.
function Verify() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>(
    'idle',
  );
  const [error, setError] = useState('');

  async function verify() {
    setState('busy');
    const result = await api('/auth/verify-email', {
      method: 'POST',
      body: { token },
    });
    if (result.ok) {
      setState('done');
      return;
    }
    setState('failed');
    setError(
      describeFailure(
        result.status,
        'This link is invalid or has expired. Request a new one from the sign-in page.',
      ),
    );
  }

  if (state === 'done') {
    return (
      <>
        <Notice>
          <p>Your email is verified.</p>
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
    <>
      {state === 'failed' ? <Notice tone="error">{error}</Notice> : null}
      <p>
        <button
          className="button"
          type="button"
          onClick={verify}
          disabled={!token || state === 'busy'}
        >
          {state === 'busy' ? 'Verifying…' : 'Verify email'}
        </button>
      </p>
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthShell title="Verify your email">
      <Suspense>
        <Verify />
      </Suspense>
    </AuthShell>
  );
}
