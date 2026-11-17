// Atlas service worker (ADR-053). It keeps only the offline page, icons and
// content-hashed static assets. Pages and API responses hold tenant data and
// are never cached, so nothing private is left on a shared device.
const VERSION = 'atlas-v2';
const PRECACHE = ['/offline.html', '/icons/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: always from the network; the offline page when there is none.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/offline.html').then((page) => page ?? Response.error()),
      ),
    );
    return;
  }

  // Build output is content-hashed and immutable, so a cached copy is safe.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches
                .open(VERSION)
                .then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
  // Everything else, including /api, goes straight to the network.
});

// Push notifications (ADR-060): the payload is decrypted by the browser and
// holds only a title, a task title and a link into Atlas.
self.addEventListener('push', (event) => {
  let message = { title: 'Atlas', body: '', url: '/', tag: undefined };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    // Show a generic notice for anything unreadable.
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: message.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url ?? '/',
    self.location.origin,
  );
  // Only ever open pages of this site.
  const url =
    target.origin === self.location.origin ? target.href : self.location.origin;
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        const open = windows.find((w) => w.url === url);
        return open ? open.focus() : self.clients.openWindow(url);
      }),
  );
});
