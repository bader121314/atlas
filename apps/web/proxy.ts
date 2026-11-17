import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, createNonce, storageOrigin } from './lib/csp';

// Runs before every page (ADR-064): a new nonce per response. The policy goes
// on the request too, which is where Next.js looks for the nonce to put on
// its own scripts.
export function proxy(request: NextRequest) {
  const policy = contentSecurityPolicy({
    nonce: createNonce(),
    storageOrigin: storageOrigin(process.env),
    development: process.env.NODE_ENV !== 'production',
  });
  const headers = new Headers(request.headers);
  headers.set('content-security-policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', policy);
  return response;
}

export const config = {
  // Pages only: the API proxy, build output and static files need no policy.
  matcher: [
    {
      source:
        '/((?!api/|_next/static|_next/image|icons/|favicon|sw.js|manifest|offline.html).*)',
      missing: [{ type: 'header', key: 'next-router-prefetch' }],
    },
  ],
};
