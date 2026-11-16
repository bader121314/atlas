import { describe, expect, it } from 'vitest';
import { summarizeIp } from '../apps/api/src/audit/ip-summary';

describe('summarizeIp', () => {
  it.each([
    ['203.0.113.77', '203.0.113.0/24'],
    ['::ffff:198.51.100.9', '198.51.100.0/24'],
    ['2001:db8:abcd:12::1', '2001:db8:abcd::/48'],
    ['2001:0DB8:0001:0002:0003:0004:0005:0006', '2001:db8:1::/48'],
    ['::1', '0:0:0::/48'],
  ])('coarsens %s to %s', (input, expected) => {
    expect(summarizeIp(input)).toBe(expected);
  });

  it.each([undefined, '', 'not-an-ip'])('returns null for %s', (input) => {
    expect(summarizeIp(input)).toBeNull();
  });
});
