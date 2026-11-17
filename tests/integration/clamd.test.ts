import { describe, expect, it } from 'vitest';
import { scannerFromEnv } from '../../packages/shared/src/malware';

const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

// Runs against the real ClamAV daemon when CI provides one (ADR-065).
describe.skipIf(!process.env.CLAMD_HOST)('ClamAV daemon', () => {
  const scanner = scannerFromEnv(process.env);

  it('is the scanner in use', () => {
    expect(scanner.name).toBe('clamd');
  });

  it('flags the EICAR test file and passes ordinary text', async () => {
    expect(await scanner.scan(Buffer.from(EICAR))).toBe('infected');
    expect(await scanner.scan(Buffer.from('meeting notes'))).toBe('clean');
  });
});
