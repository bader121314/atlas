import { describe, expect, it } from 'vitest';
import { median } from '../apps/api/src/projects/analytics.service';

describe('median', () => {
  it('handles empty, odd and even lists', () => {
    expect(median([])).toBeUndefined();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});
