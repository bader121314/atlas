// Production uses the __Host- prefix: Secure, no Domain, Path=/, so the
// cookie cannot be set or overwritten by sibling subdomains.
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function sessionCookieName(): string {
  return isProduction() ? '__Host-atlas_session' : 'atlas_session';
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  const attributes = [
    `${sessionCookieName()}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isProduction()) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearedSessionCookie(): string {
  return sessionCookie('', 0);
}
