/**
 * One CSV cell. Text that a spreadsheet would run as a formula (starting
 * with = + - @, tab or carriage return) gets a leading apostrophe, so an
 * exported value can never execute in Excel or Sheets.
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV with a UTF-8 byte order mark so spreadsheets read Arabic correctly. */
export function toCsv(rows: (string | number | null)[][]): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
