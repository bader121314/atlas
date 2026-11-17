import type { NextConfig } from 'next';

// The browser only ever talks to the web origin; /api/* is proxied to the API
// server. One origin keeps cookies first-party and makes the API's exact
// Origin check (ADR-011) work without CORS.
const apiOrigin = process.env.API_ORIGIN ?? 'http://127.0.0.1:3001';

// Browsers upload attachments straight to storage (ADR-034), so the content
// security policy must allow connections to that origin and no other.
function storageOrigin(): string {
  try {
    return (
      process.env.STORAGE_PUBLIC_ORIGIN ??
      new URL(process.env.STORAGE_ENDPOINT ?? '').origin
    );
  } catch {
    return '';
  }
}

const production = process.env.NODE_ENV === 'production';

// Next.js needs inline scripts for hydration; nothing else is allowed in.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${production ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${storageOrigin()}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

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
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
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
    ];
  },
};

export default config;
