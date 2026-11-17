import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { ServiceWorker } from '../components/service-worker';
import { LocaleProvider } from '../lib/i18n';
import { LOCALE_COOKIE } from '../lib/locale';
import type { Locale } from '../lib/locale';
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

export default async function Layout({ children }: { children: ReactNode }) {
  // The language is a cookie so the first paint already has the right
  // direction (ADR-063).
  const locale: Locale =
    (await cookies()).get(LOCALE_COOKIE)?.value === 'ar' ? 'ar' : 'en';
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
