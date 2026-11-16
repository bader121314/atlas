'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useShell } from '../../../../components/app-shell';
import { Notice } from '../../../../components/form';
import { api, describeFailure } from '../../../../lib/api';
import type { Organization } from '../../../../lib/api';

function Accept() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const { user, refreshOrganizations } = useShell();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function accept() {
    setBusy(true);
    setError('');
    const result = await api<Organization>('/invitations/accept', {
      method: 'POST',
      body: { token },
    });
    if (result.ok && result.data) {
      await refreshOrganizations();
      router.replace(`/organizations/${result.data.slug}`);
      return;
    }
    setBusy(false);
    setError(
      result.status === 409
        ? 'You are already a member of this organization, or your membership is suspended.'
        : describeFailure(
            result.status,
            `This invitation is not valid for ${user.email}. It may have expired, been revoked, or been sent to a different address.`,
          ),
    );
  }

  return (
    <>
      <h1>Join an organization</h1>
      <p>
        You are signed in as <strong>{user.email}</strong>. Invitations only
        work for the address they were sent to.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <p>
        <button
          className="button"
          type="button"
          onClick={accept}
          disabled={!token || busy}
        >
          {busy ? 'Joining…' : 'Accept invitation'}
        </button>
      </p>
      <p>
        <Link href="/organizations">Not now</Link>
      </p>
    </>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <Accept />
    </Suspense>
  );
}
