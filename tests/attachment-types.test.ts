import { describe, expect, it } from 'vitest';
import { attachmentTypes } from '../packages/contracts/src';
import { ALLOWED_TYPES } from '../packages/shared/src';

describe('attachment types', () => {
  it('are the same in the API contract and the file checks', () => {
    expect([...attachmentTypes]).toEqual([...ALLOWED_TYPES]);
  });
});
