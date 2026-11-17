import { describe, expect, it } from 'vitest';
import {
  parseTaskKey,
  toPrefixQuery,
} from '../apps/api/src/search/search.service';

describe('search query', () => {
  it('keeps words in any script and makes each a required prefix', () => {
    expect(toPrefixQuery('Survey  the BAY')).toBe('survey:* & the:* & bay:*');
    expect(toPrefixQuery('مسح الخليج')).toBe('مسح:* & الخليج:*');
  });

  it('drops operators and punctuation so input cannot change the query', () => {
    expect(toPrefixQuery("bay' | !cliff & (x) <-> y:*")).toBe(
      'bay:* & cliff:* & x:* & y:*',
    );
    expect(toPrefixQuery('!!! ---')).toBeUndefined();
  });

  it('removes repeats and limits the number of words', () => {
    expect(toPrefixQuery('a a b')).toBe('a:* & b:*');
    expect(toPrefixQuery('1 2 3 4 5 6 7 8 9 10')?.split(' & ')).toHaveLength(8);
  });

  it('recognizes task keys', () => {
    expect(parseTaskKey(' nw-12 ')).toEqual({ projectKey: 'NW', number: 12 });
    expect(parseTaskKey('NW12')).toBeUndefined();
    expect(parseTaskKey('survey NW-12')).toBeUndefined();
  });
});
