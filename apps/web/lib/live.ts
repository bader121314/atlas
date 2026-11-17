'use client';

import { useEffect, useRef, useState } from 'react';

export interface LiveEvent {
  id: string;
  type: string;
  taskId: string;
  version: number;
  actorUserId: string | null;
}

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'off';

interface Handlers {
  /** A task changed; refetch what you show of it. */
  onEvent: (event: LiveEvent) => void;
  /** Events were missed and cannot be replayed; refetch everything. */
  onResync: () => void;
  /** The caller lost access to the project. */
  onRevoked: () => void;
}

/**
 * Subscribes to a project's event stream (ADR-029). The browser reconnects
 * by itself and sends the last event id, so the server replays what was
 * missed or asks for a resync.
 */
export function useProjectEvents(base: string, handlers: Handlers): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      setStatus('off');
      return;
    }
    const source = new EventSource(`/api${base}/events`);
    setStatus('connecting');
    let wasLive = false;
    source.addEventListener('ready', () => {
      // After a reconnect the server has replayed or asked for a resync.
      wasLive = true;
      setStatus('live');
    });
    source.addEventListener('task', (message) => {
      try {
        latest.current.onEvent(JSON.parse(message.data) as LiveEvent);
      } catch {
        // Ignore malformed frames.
      }
    });
    source.addEventListener('resync', () => latest.current.onResync());
    source.addEventListener('revoked', () => {
      source.close();
      setStatus('off');
      latest.current.onRevoked();
    });
    source.onerror = () => {
      setStatus(
        source.readyState === EventSource.CLOSED
          ? 'off'
          : wasLive
            ? 'reconnecting'
            : 'connecting',
      );
    };
    return () => source.close();
  }, [base]);

  return status;
}

const STATUS_TEXT: Record<LiveStatus, string> = {
  connecting: 'Connecting to live updates…',
  live: 'Live: changes by others appear here',
  reconnecting: 'Reconnecting…',
  off: 'Live updates are off; reload to see changes',
};

export function liveStatusText(status: LiveStatus): string {
  return STATUS_TEXT[status];
}
