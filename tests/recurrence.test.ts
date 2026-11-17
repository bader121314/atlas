import { describe, expect, it } from 'vitest';
import { nextOccurrence } from '../packages/contracts/src';

const at = (s: string) => new Date(s);

describe('recurring task schedule', () => {
  it('steps by days, weeks or months', () => {
    expect(
      nextOccurrence(
        at('2026-11-17T09:00:00Z'),
        'daily',
        1,
        at('2026-11-17T09:00:00Z'),
      ).toISOString(),
    ).toBe('2026-11-18T09:00:00.000Z');
    expect(
      nextOccurrence(
        at('2026-11-17T09:00:00Z'),
        'weekly',
        2,
        at('2026-11-17T10:00:00Z'),
      ).toISOString(),
    ).toBe('2026-12-01T09:00:00.000Z');
    expect(
      nextOccurrence(
        at('2026-11-17T09:00:00Z'),
        'monthly',
        3,
        at('2026-11-17T10:00:00Z'),
      ).toISOString(),
    ).toBe('2027-02-17T09:00:00.000Z');
  });

  it('keeps the day of the month, clamped to short months', () => {
    expect(
      nextOccurrence(
        at('2026-01-31T09:00:00Z'),
        'monthly',
        1,
        at('2026-01-31T10:00:00Z'),
      ).toISOString(),
    ).toBe('2026-02-28T09:00:00.000Z');
    expect(
      nextOccurrence(
        at('2026-01-31T09:00:00Z'),
        'monthly',
        1,
        at('2026-03-01T00:00:00Z'),
      ).toISOString(),
    ).toBe('2026-03-31T09:00:00.000Z');
  });

  it('skips missed occurrences instead of catching up', () => {
    expect(
      nextOccurrence(
        at('2026-11-01T09:00:00Z'),
        'daily',
        1,
        at('2026-11-17T12:00:00Z'),
      ).toISOString(),
    ).toBe('2026-11-18T09:00:00.000Z');
  });
});
