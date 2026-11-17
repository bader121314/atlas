import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ServiceWorker } from '../components/service-worker';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Atlas', template: '%s – Atlas' },
  description: 'A shared workspace for teams to plan and track their work.',
  icons: {
    icon: '/icons/icon.svg',
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: { capable: true, title: 'Atlas', statusBarStyle: 'default' },
};

export const viewport: Viewport = { themeColor: '#1f5068' };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
