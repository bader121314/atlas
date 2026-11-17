'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { ignoresShortcuts, resolveKey } from '../lib/shortcuts';
import type { Shortcut } from '../lib/shortcuts';
import { useT } from '../lib/i18n';

interface Registry {
  register: (id: string, shortcuts: Shortcut[]) => () => void;
}

const ShortcutContext = createContext<Registry | undefined>(undefined);

/**
 * Listens for keyboard shortcuts across the signed-in app. Pages add their
 * own with `useShortcuts`; "?" opens the list of what is available here.
 */
export function ShortcutProvider({
  global,
  children,
}: {
  global: Shortcut[];
  children: ReactNode;
}) {
  const t = useT();
  const [groups, setGroups] = useState<Record<string, Shortcut[]>>({});
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const bindings = useMemo(() => {
    const leave: Shortcut = {
      keys: 'Esc',
      description: 'Leave a text field so shortcuts work again',
      run: () => undefined,
    };
    const help: Shortcut = {
      keys: '?',
      description: 'Show keyboard shortcuts',
      run: () => dialog.current?.showModal(),
    };
    return [help, leave, ...global, ...Object.values(groups).flat()];
  }, [global, groups]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (dialog.current?.open) return;
      // Escape leaves a text field so shortcuts work again.
      if (event.key === 'Escape' && event.target instanceof HTMLElement) {
        if (ignoresShortcuts(event)) event.target.blur();
        return;
      }
      if (ignoresShortcuts(event)) return;
      const result = resolveKey(bindings, pending.current, event.key);
      pending.current = result.pending;
      clearTimeout(timer.current);
      if (result.pending) {
        timer.current = setTimeout(() => (pending.current = ''), 1200);
      }
      if (result.match) {
        event.preventDefault();
        result.match.run();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bindings]);

  const registry = useMemo<Registry>(
    () => ({
      register(id, shortcuts) {
        setGroups((current) => ({ ...current, [id]: shortcuts }));
        return () =>
          setGroups((current) => {
            const next = { ...current };
            delete next[id];
            return next;
          });
      },
    }),
    [],
  );

  return (
    <ShortcutContext.Provider value={registry}>
      {children}
      <dialog
        ref={dialog}
        className="shortcut-dialog"
        aria-labelledby="shortcuts-heading"
      >
        <h2 id="shortcuts-heading">{t('Keyboard shortcuts')}</h2>
        <dl className="shortcut-list">
          {bindings.map((b) => (
            <div key={b.keys}>
              <dt>
                {b.keys.split(' ').map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </dt>
              <dd>{b.description}</dd>
            </div>
          ))}
        </dl>
        <form method="dialog">
          <button className="button secondary" type="submit">
            {t('Close')}
          </button>
        </form>
      </dialog>
    </ShortcutContext.Provider>
  );
}

/** Adds page shortcuts while the page is shown. */
export function useShortcuts(id: string, shortcuts: Shortcut[]): void {
  const registry = useContext(ShortcutContext);
  useEffect(() => registry?.register(id, shortcuts), [registry, id, shortcuts]);
}

/** Opens the shortcut list, for people who do not know about "?". */
export function ShortcutHint() {
  const t = useT();
  return (
    <button
      className="button secondary small"
      type="button"
      aria-keyshortcuts="?"
      onClick={() =>
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))
      }
    >
      {t('Shortcuts')}
    </button>
  );
}
