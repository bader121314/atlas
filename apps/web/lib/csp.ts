// Content security policy (ADR-064). Every page response gets a fresh nonce;
// only scripts carrying it, and scripts those load, may run. Next.js reads the
// nonce from the request's policy header and stamps it on its own scripts.

export interface PolicyOptions {
  nonce: string;
  /** Browsers upload attachments straight to storage (ADR-034). */
  storageOrigin?: string;
  /** Development needs eval for fast refresh. */
  development?: boolean;
}

export function contentSecurityPolicy(options: PolicyOptions): string {
  const scripts = [
    "'self'",
    `'nonce-${options.nonce}'`,
    "'strict-dynamic'",
    ...(options.development ? ["'unsafe-eval'"] : []),
  ];
  return [
    "default-src 'self'",
    `script-src ${scripts.join(' ')}`,
    // React sets style attributes; styles cannot run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${options.storageOrigin ?? ''}`.trim(),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

/** 128 random bits, base64 encoded. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

export function storageOrigin(env: Record<string, string | undefined>): string {
  try {
    return (
      env.STORAGE_PUBLIC_ORIGIN ?? new URL(env.STORAGE_ENDPOINT ?? '').origin
    );
  } catch {
    return '';
  }
}
