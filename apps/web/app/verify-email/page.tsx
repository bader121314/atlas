'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthShell } from '../../components/auth-shell';
import { Notice } from '../../components/form';
import { api, describeFailure } from '../../lib/api';
import { useT } from '../../lib/i18n';

// Verification needs a click: link scanners in mail clients often open links
// automatically, and a GET must never change state.
function Verify() {
  const t = useT();
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
        t(
          'This link is invalid or has expired. Request a new one from the sign-in page.',
        ),
      ),
    );
  }

  if (state === 'done') {
    return (
      <>
        <Notice>
          <p>{t('Your email is verified.')}</p>
        </Notice>
        <p className="switch">
          <Link className="button" href="/login">
            {t('Sign in')}
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
          {state === 'busy' ? t('Verifying…') : t('Verify email')}
        </button>
      </p>
    </>
  );
}

export default function VerifyEmailPage() {
  const t = useT();
  return (
    <AuthShell title={t('Verify your email')}>
      <Suspense>
        <Verify />
      </Suspense>
    </AuthShell>
  );
}
