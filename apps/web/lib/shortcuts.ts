/** A key binding: one key ("n") or a two-key sequence ("g o"). */
export interface Shortcut {
  keys: string;
  description: string;
  run: () => void;
}

export interface KeyResult {
  /** The binding to run, if the key completed one. */
  match?: Shortcut;
  /** First key of a sequence still waiting for its second key. */
  pending: string;
}

/**
 * Resolves one key press against the bindings, given any pending first key.
 * A key that starts a sequence waits; an unknown second key starts over.
 */
export function resolveKey(
  bindings: readonly Shortcut[],
  pending: string,
  key: string,
): KeyResult {
  if (pending) {
    const match = bindings.find((b) => b.keys === `${pending} ${key}`);
    if (match) return { match, pending: '' };
  }
  const single = bindings.find((b) => b.keys === key);
  if (single) return { match: single, pending: '' };
  const starts = bindings.some((b) => b.keys.startsWith(`${key} `));
  return { pending: starts ? key : '' };
}

/** Shortcuts never fire while someone is typing or using modifier keys. */
export function ignoresShortcuts(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: EventTarget | null;
}): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) return true;
  const target = event.target as {
    tagName?: string;
    isContentEditable?: boolean;
  } | null;
  if (!target) return false;
  return (
    target.isContentEditable === true ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName ?? '')
  );
}
