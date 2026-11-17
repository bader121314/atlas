'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';

// The workspace has no public landing page yet: send people where they belong.
export default function Home() {
  const t = useT();
  const router = useRouter();
  useEffect(() => {
    void api('/auth/session').then((session) => {
      router.replace(session.ok ? '/organizations' : '/login');
    });
  }, [router]);
  return (
    <main className="page">
      <p className="muted" role="status">
        {t('Opening Atlas…')}
      </p>
    </main>
  );
}
