import type { NextConfig } from 'next';

// The browser only ever talks to the web origin; /api/* is proxied to the API
// server. One origin keeps cookies first-party and makes the API's exact
// Origin check (ADR-011) work without CORS.
const apiOrigin = process.env.API_ORIGIN ?? 'http://127.0.0.1:3001';

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
        ],
      },
    ];
  },
};

export default config;
