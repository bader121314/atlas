/**
 * File type rules for attachments (ADR-034): an allowlist of types, checked
 * against the file's first bytes rather than its name or declared type.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
] as const;
export type AllowedType = (typeof ALLOWED_TYPES)[number];

export function isAllowedType(value: string): value is AllowedType {
  return (ALLOWED_TYPES as readonly string[]).includes(value);
}

function startsWith(bytes: Uint8Array, prefix: number[], offset = 0): boolean {
  return prefix.every((b, i) => bytes[offset + i] === b);
}

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/**
 * The type the content really has, judged from its first bytes, or
 * undefined when it matches nothing allowed. Text must be valid UTF-8
 * without NUL bytes; it is reported as the declared text type.
 */
export function sniffType(
  bytes: Uint8Array,
  declared: AllowedType,
): AllowedType | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a')))
    return 'image/gif';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8))
    return 'image/webp';
  if (startsWith(bytes, ascii('%PDF-'))) return 'application/pdf';
  if (declared === 'text/plain' || declared === 'text/csv') {
    if (bytes.includes(0)) return undefined;
    try {
      // A cut multi-byte character at the end of the sample is allowed.
      new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.length >= 4096 ? bytes.slice(0, trimPartial(bytes)) : bytes,
      );
      return declared;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function trimPartial(bytes: Uint8Array): number {
  const end = bytes.length;
  for (let i = 1; i <= 3 && end - i >= 0; i += 1) {
    const b = bytes[end - i] ?? 0;
    if ((b & 0xc0) === 0xc0) return end - i;
    if ((b & 0x80) === 0) break;
  }
  return end;
}

const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/**
 * Stand-in malware scanner: flags the industry EICAR test file. A real
 * scanner (ClamAV) replaces it in deployment behind the same function.
 */
export function scanForMalware(bytes: Uint8Array): 'clean' | 'infected' {
  const text = Buffer.from(bytes).toString('latin1');
  return text.includes(EICAR) ? 'infected' : 'clean';
}

/** Keeps a display name safe for headers and storage: no paths or controls. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = [...base.normalize('NFC')]
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code > 0x1f && code !== 0x7f && c !== '"';
    })
    .join('')
    .trim()
    .slice(0, 200);
  return cleaned || 'file';
}
