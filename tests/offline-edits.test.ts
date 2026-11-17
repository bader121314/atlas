import { describe, expect, it } from 'vitest';
import { mergeEdit } from '../apps/web/lib/offline-edits';

describe('offline edits', () => {
  it('keeps the first version and the latest value of each field', () => {
    const first = mergeEdit(undefined, 4, { priority: 'high' });
    const second = mergeEdit(first, 5, { priority: 'urgent', dueAt: null });
    expect(second).toEqual({
      version: 4,
      changes: { priority: 'urgent', dueAt: null },
    });
  });
});
