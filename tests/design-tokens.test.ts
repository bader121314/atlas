import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Checks the colour tokens in globals.css against WCAG 2.2 contrast minimums:
// 4.5:1 for text and 3:1 for control boundaries (1.4.3 and 1.4.11).
// Vitest runs from the repository root.
const css = readFileSync('apps/web/app/globals.css', 'utf8');
const root = /:root\s*{([^}]*)}/.exec(css)?.[1] ?? '';
const tokens = Object.fromEntries(
  [...root.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
);

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(tokens[foreground] ?? '');
  const b = luminance(tokens[background] ?? '');
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const TEXT: [string, string][] = [
  ['ink', 'paper'],
  ['ink', 'surface'],
  ['ink', 'column'],
  ['ink-soft', 'paper'],
  ['ink-soft', 'surface'],
  ['ink-soft', 'column'],
  ['ink-soft', 'ok-soft'],
  ['ink-soft', 'danger-soft'],
  ['sea', 'surface'],
  ['sea', 'paper'],
  ['sea-deep', 'surface'],
  ['sea-deep', 'ok-soft'],
  ['on-sea', 'sea'],
  ['on-sea', 'sea-deep'],
  ['on-map', 'sea-deep'],
  ['danger', 'surface'],
  ['danger', 'danger-soft'],
  ['danger', 'column'],
  ['label-slate', 'surface'],
  ['label-sage', 'surface'],
  ['label-sand', 'column'],
  ['label-rose', 'surface'],
  ['label-violet', 'column'],
];

const BOUNDARIES: [string, string][] = [
  ['line-strong', 'surface'],
  ['line-strong', 'paper'],
  ['sea', 'surface'],
];

describe('design tokens', () => {
  it('defines every token the checks use', () => {
    for (const [a, b] of [...TEXT, ...BOUNDARIES]) {
      expect(tokens[a], a).toMatch(/^#/);
      expect(tokens[b], b).toMatch(/^#/);
    }
  });

  it.each(TEXT)('%s text on %s meets 4.5:1', (foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(BOUNDARIES)(
    '%s boundary on %s meets 3:1',
    (foreground, background) => {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(3);
    },
  );
});
