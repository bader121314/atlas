import { Injectable } from '@nestjs/common';
import { resolveTxt } from 'node:dns/promises';

/** DNS TXT lookups, replaceable in tests (ADR-057). */
@Injectable()
export class DomainResolver {
  async txt(name: string): Promise<string[]> {
    try {
      const records = await resolveTxt(name);
      return records.map((parts) => parts.join(''));
    } catch {
      return [];
    }
  }
}
