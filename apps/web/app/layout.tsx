import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: { default: 'Atlas', template: '%s – Atlas' },
  description: 'A shared workspace for teams to plan and track their work.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
