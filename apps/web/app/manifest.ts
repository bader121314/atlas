import type { MetadataRoute } from 'next';

/** Installable app metadata (ADR-053). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Atlas',
    short_name: 'Atlas',
    description: 'A shared workspace for teams to plan and track their work.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f3f6f4',
    theme_color: '#1f5068',
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
