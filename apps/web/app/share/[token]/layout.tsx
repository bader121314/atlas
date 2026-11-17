import type { ReactNode } from 'react';

export const metadata = {
  title: 'Shared project',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ShareLayout({ children }: { children: ReactNode }) {
  return <main className="public">{children}</main>;
}
