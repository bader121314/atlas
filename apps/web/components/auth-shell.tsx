import Link from 'next/link';
import type { ReactNode } from 'react';
import { ContourMap } from './contour-map';

export function AuthShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="auth">
      <aside className="auth-map">
        <ContourMap />
        <Link className="wordmark" href="/">
          Atlas
        </Link>
        <p className="caption">
          Every team, every project, mapped in one place.
        </p>
      </aside>
      <main className="auth-panel">
        <h1>{title}</h1>
        {intro ? <div className="muted">{intro}</div> : null}
        {children}
      </main>
    </div>
  );
}
