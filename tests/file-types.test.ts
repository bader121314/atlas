import { describe, expect, it } from 'vitest';
import {
  isAllowedType,
  safeFilename,
  scanForMalware,
  sniffType,
} from '../packages/shared/src';

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p)] : p)),
  );

describe('attachment file checks', () => {
  it('recognizes allowed types by their first bytes', () => {
    expect(
      sniffType(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a, 0]), 'image/png'),
    ).toBe('image/png');
    expect(sniffType(bytes([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg')).toBe(
      'image/jpeg',
    );
    expect(sniffType(bytes('GIF89a'), 'image/gif')).toBe('image/gif');
    expect(
      sniffType(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8'), 'image/webp'),
    ).toBe('image/webp');
    expect(sniffType(bytes('%PDF-1.7'), 'application/pdf')).toBe(
      'application/pdf',
    );
    expect(sniffType(bytes('name,count\nبحر,3\n'), 'text/csv')).toBe(
      'text/csv',
    );
  });

  it('rejects content that does not match an allowed type', () => {
    // An executable renamed to .png is reported as what it is: nothing allowed.
    expect(sniffType(bytes('MZ', [0x90, 0, 3]), 'image/png')).toBeUndefined();
    expect(
      sniffType(bytes('hello', [0], 'world'), 'text/plain'),
    ).toBeUndefined();
    expect(sniffType(bytes([0xc3, 0x28]), 'text/plain')).toBeUndefined();
    // A PDF declared as an image is detected as a PDF; the caller compares.
    expect(sniffType(bytes('%PDF-1.4'), 'image/png')).toBe('application/pdf');
    expect(isAllowedType('application/x-msdownload')).toBe(false);
  });

  it('flags the EICAR test file', () => {
    const eicar =
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    expect(scanForMalware(bytes(eicar))).toBe('infected');
    expect(scanForMalware(bytes('plain notes'))).toBe('clean');
  });

  it('strips paths and control characters from names', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('C:\\Users\\a\\report "final".pdf')).toBe(
      'report final.pdf',
    );
    expect(safeFilename('\u0000\u0007')).toBe('file');
  });
});
