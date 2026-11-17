import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration } from '../apps/web/lib/duration';

describe('durations', () => {
  it.each([
    ['90', 90],
    ['45m', 45],
    ['2h', 120],
    ['1h 30m', 90],
    ['1.5h', 90],
    ['1:05', 65],
    [' 2H15M ', 135],
  ])('reads %s', (text, minutes) => {
    expect(parseDuration(text)).toBe(minutes);
  });

  it.each(['', 'soon', '0', '25h', '1:75', 'h', '-5'])('refuses %j', (text) => {
    expect(parseDuration(text)).toBeUndefined();
  });

  it('accepts larger values when allowed', () => {
    expect(parseDuration('40h', 60000)).toBe(2400);
    expect(parseDuration('40h')).toBeUndefined();
  });

  it('formats', () => {
    expect([0, 45, 120, 135].map(formatDuration)).toEqual([
      '0m',
      '45m',
      '2h',
      '2h 15m',
    ]);
  });
});
