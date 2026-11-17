'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ContourMap } from './contour-map';
import { LanguageSwitch, useT } from '../lib/i18n';

export function AuthShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="auth">
      <aside className="auth-map">
        <ContourMap />
        <Link className="wordmark" href="/">
          {t('Atlas')}
        </Link>
        <p className="caption">
          {t('Every team, every project, mapped in one place.')}
        </p>
      </aside>
      <main className="auth-panel">
        <h1>{title}</h1>
        {intro ? <div className="muted">{intro}</div> : null}
        {children}
        <p className="switch">
          <LanguageSwitch />
        </p>
      </main>
    </div>
  );
}
