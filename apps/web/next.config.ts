import type { NextConfig } from 'next';

// The browser only ever talks to the web origin; /api/* is proxied to the API
// server. One origin keeps cookies first-party and makes the API's exact
// Origin check (ADR-011) work without CORS.
const apiOrigin = process.env.API_ORIGIN ?? 'http://127.0.0.1:3001';

const production = process.env.NODE_ENV === 'production';

// The content security policy is set per request with a nonce in proxy.ts
// (ADR-064).
const config: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          ...(production
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=31536000; includeSubDomains',
                },
              ]
            : []),
        ],
      },
      {
        // The service worker must always be revalidated so fixes ship at once.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache' },
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
        ],
      },
      {
        // Public share links carry their token in the path (ADR-050): never
        // leak it through Referer, and keep the pages out of search engines.
        source: '/share/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default config;
