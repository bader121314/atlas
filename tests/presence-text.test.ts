import { describe, expect, it } from 'vitest';
import { presenceText } from '../apps/web/lib/presence';

const v = (displayName: string) => ({ userId: displayName, displayName });

describe('presence text', () => {
  it('names one or two viewers and counts the rest', () => {
    expect(presenceText([])).toBe('');
    expect(presenceText([v('Bob')])).toBe('Bob is also here');
    expect(presenceText([v('Bob'), v('Carol')])).toBe(
      'Bob and Carol are also here',
    );
    expect(presenceText([v('Bob'), v('Carol'), v('Dan')])).toBe(
      'Bob and 2 others are also here',
    );
  });
});
