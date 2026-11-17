import { describe, expect, it } from 'vitest';
import { coerceFieldValue } from '../apps/api/src/projects/fields.service';

const select = { type: 'select' as const, options: ['North', 'South'] };

describe('custom field values', () => {
  it.each([
    [
      { type: 'text' as const, options: [] },
      '  Notes  ',
      { text: 'Notes', number: null, date: null },
    ],
    [
      { type: 'number' as const, options: [] },
      12.5,
      { text: null, number: 12.5, date: null },
    ],
    [
      { type: 'date' as const, options: [] },
      '2027-02-28',
      { text: null, number: null, date: '2027-02-28' },
    ],
    [select, 'South', { text: 'South', number: null, date: null }],
  ])('accepts valid %o values', (field, value, expected) => {
    expect(coerceFieldValue(field, value)).toEqual(expected);
  });

  it.each([
    [{ type: 'text' as const, options: [] }, '   '],
    [{ type: 'text' as const, options: [] }, 5],
    [{ type: 'number' as const, options: [] }, '5'],
    [{ type: 'number' as const, options: [] }, Number.POSITIVE_INFINITY],
    [{ type: 'date' as const, options: [] }, '2027-02-30'],
    [{ type: 'date' as const, options: [] }, '27-02-01'],
    [select, 'East'],
    [select, 'south'],
  ])('rejects invalid values (%o, %o)', (field, value) => {
    expect(coerceFieldValue(field, value)).toBeUndefined();
  });
});
