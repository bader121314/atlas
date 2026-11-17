import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../apps/worker/src/exports/exporter';

describe('CSV export', () => {
  it('quotes separators, quotes and line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12)).toBe('12');
  });

  it('neutralizes spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("http://x","click")')).toBe(
      '"\'=HYPERLINK(""http://x"",""click"")"',
    );
    for (const start of ['+', '-', '@', '\t', '\r']) {
      expect(
        csvCell(`${start}1`).replace(/^"/, '').startsWith(`'${start}`),
      ).toBe(true);
    }
  });

  it('starts with a byte order mark and ends lines with CRLF', () => {
    const csv = toCsv([
      ['Key', 'Title'],
      ['NW-1', 'مسح الخليج'],
    ]);
    expect(csv).toBe('﻿Key,Title\r\nNW-1,مسح الخليج\r\n');
  });
});
