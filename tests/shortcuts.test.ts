import { describe, expect, it, vi } from 'vitest';
import { ignoresShortcuts, resolveKey } from '../apps/web/lib/shortcuts';
import type { Shortcut } from '../apps/web/lib/shortcuts';

const bind = (keys: string): Shortcut => ({
  keys,
  description: keys,
  run: vi.fn(),
});
const bindings = [bind('n'), bind('g o'), bind('g a')];

describe('keyboard shortcuts', () => {
  it('runs single keys at once', () => {
    expect(resolveKey(bindings, '', 'n')).toEqual({
      match: bindings[0],
      pending: '',
    });
  });

  it('waits for the second key of a sequence', () => {
    expect(resolveKey(bindings, '', 'g')).toEqual({ pending: 'g' });
    expect(resolveKey(bindings, 'g', 'a')).toEqual({
      match: bindings[2],
      pending: '',
    });
  });

  it('starts over after an unknown key', () => {
    expect(resolveKey(bindings, 'g', 'x')).toEqual({ pending: '' });
    expect(resolveKey(bindings, 'g', 'n')).toEqual({
      match: bindings[0],
      pending: '',
    });
    expect(resolveKey(bindings, '', 'q')).toEqual({ pending: '' });
  });

  it('stays out of the way while typing or with modifier keys', () => {
    const plain = { altKey: false, ctrlKey: false, metaKey: false };
    expect(ignoresShortcuts({ ...plain, target: null })).toBe(false);
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(
        ignoresShortcuts({
          ...plain,
          target: { tagName } as unknown as EventTarget,
        }),
      ).toBe(true);
    }
    expect(
      ignoresShortcuts({
        ...plain,
        target: {
          tagName: 'DIV',
          isContentEditable: true,
        } as unknown as EventTarget,
      }),
    ).toBe(true);
    expect(ignoresShortcuts({ ...plain, ctrlKey: true, target: null })).toBe(
      true,
    );
  });
});
