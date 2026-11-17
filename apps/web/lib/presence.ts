'use client';

import { useEffect, useState } from 'react';

export interface Viewer {
  userId: string;
  displayName: string;
}

const HEARTBEAT_MS = 20_000;

/**
 * Tells the server this task is open and returns who else has it open
 * (ADR-030). Refreshes every 20 seconds while the tab is visible and leaves
 * when the page closes.
 */
export function usePresence(path: string, selfId: string): Viewer[] {
  const [viewers, setViewers] = useState<Viewer[]>([]);

  useEffect(() => {
    let active = true;
    const beat = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const response = await fetch(`/api${path}`, { method: 'PUT' });
        if (!response.ok || !active) return;
        const body = (await response.json()) as { viewers: Viewer[] };
        setViewers(body.viewers.filter((v) => v.userId !== selfId));
      } catch {
        // Presence is best effort.
      }
    };
    const leave = () => {
      void fetch(`/api${path}`, { method: 'DELETE', keepalive: true }).catch(
        () => undefined,
      );
    };
    void beat();
    const timer = setInterval(() => void beat(), HEARTBEAT_MS);
    document.addEventListener('visibilitychange', beat);
    window.addEventListener('pagehide', leave);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', beat);
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [path, selfId]);

  return viewers;
}

/** "Bob Haddad is also here", "Bob and 2 others are also here". */
export function presenceText(viewers: Viewer[]): string {
  const [first, ...rest] = viewers;
  if (!first) return '';
  if (rest.length === 0) return `${first.displayName} is also here`;
  if (rest.length === 1)
    return `${first.displayName} and ${rest[0]?.displayName} are also here`;
  return `${first.displayName} and ${rest.length} others are also here`;
}
