'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type State = 'unsupported' | 'unavailable' | 'off' | 'on' | 'blocked';

function keyBytes(base64url: string): Uint8Array {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Turns browser notifications on or off for this device (ADR-060). */
export function PushToggle() {
  const [state, setState] = useState<State>();
  const [publicKey, setPublicKey] = useState<string>();

  useEffect(() => {
    void (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setState('unsupported');
        return;
      }
      const config = await api<{ publicKey: string | null }>('/push/config');
      if (!config.data?.publicKey) {
        setState('unavailable');
        return;
      }
      setPublicKey(config.data.publicKey);
      if (Notification.permission === 'denied') {
        setState('blocked');
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration();
      const existing = await registration?.pushManager.getSubscription();
      setState(existing ? 'on' : 'off');
    })();
  }, []);

  async function enable() {
    if (!publicKey) return;
    const registration = await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setState(permission === 'denied' ? 'blocked' : 'off');
      return;
    }
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    });
    const result = await api('/push/subscriptions', {
      method: 'POST',
      body: subscription.toJSON(),
    });
    setState(result.ok ? 'on' : 'off');
  }

  async function disable() {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await api('/push/subscriptions', {
        method: 'DELETE',
        body: { endpoint: subscription.endpoint },
      });
      await subscription.unsubscribe();
    }
    setState('off');
  }

  if (state === undefined || state === 'unsupported') return null;
  return (
    <fieldset className="checks plain section">
      <legend>This device</legend>
      {state === 'unavailable' ? (
        <p className="muted">
          Browser notifications are not set up on this server.
        </p>
      ) : state === 'blocked' ? (
        <p className="muted">
          Notifications are blocked for Atlas in this browser&apos;s settings.
        </p>
      ) : (
        <>
          <p className="muted">
            {state === 'on'
              ? 'This browser shows a notification as soon as something needs you.'
              : 'Get a notification on this device as soon as something needs you.'}
          </p>
          <button
            className="button secondary small"
            type="button"
            onClick={() => void (state === 'on' ? disable() : enable())}
          >
            {state === 'on'
              ? 'Turn off notifications on this device'
              : 'Turn on notifications on this device'}
          </button>
        </>
      )}
    </fieldset>
  );
}
