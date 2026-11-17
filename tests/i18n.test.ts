import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ar } from '../apps/web/lib/locales/ar';

// Text that is the same in both languages: examples, codes and addresses.
const UNTRANSLATED = new Set([
  '1h 30m',
  'example.com',
  'https://login.example.com',
]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('Arabic interface text (ADR-063)', () => {
  const root = join(__dirname, '../apps/web');
  const used = new Set<string>();
  for (const file of [
    ...sources(join(root, 'app')),
    ...sources(join(root, 'components')),
    join(root, 'lib/api.ts'),
  ]) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bt[r]?\(\s*'((?:[^'\\]|\\.)*)'/g))
      used.add((match[1] ?? '').replace(/\\'/g, "'"));
  }

  it('translates every text the interface uses', () => {
    const missing = [...used].filter(
      (key) => !(key in ar) && !UNTRANSLATED.has(key),
    );
    expect(missing).toEqual([]);
  });

  it('keeps the same placeholders in every translation', () => {
    for (const [english, arabic] of Object.entries(ar))
      expect([english, placeholders(arabic)]).toEqual([
        english,
        placeholders(english),
      ]);
  });

  it('has no translations left over from removed text', () => {
    const roles = [
      'owner',
      'admin',
      'member',
      'guest',
      'None',
      'Low',
      'Medium',
      'High',
      'Urgent',
      'No priority',
      // Field types, translated through a variable as well.
      'Text',
      'Number',
      'Date',
      'Choice list',
    ];
    const unused = Object.keys(ar).filter(
      (key) => !used.has(key) && !roles.includes(key),
    );
    expect(unused).toEqual([]);
  });
});
