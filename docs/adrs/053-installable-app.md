# ADR-053: Installable app basics (M9)

## Context

The M9 backlog lists mobile and PWA features. Atlas already works at phone
widths (the browser test audits three sizes). Installing it to a home
screen and failing gracefully without a connection are the next steps.

## Decisions

- **Manifest and icons.** `app/manifest.ts` declares a standalone app with
  the brand colours; icons are an SVG contour mark with 192 and 512 pixel
  PNGs (one marked maskable, its artwork inside the safe zone) and an Apple
  touch icon.
- **Service worker, deliberately small.** It precaches only an offline page
  and icons, caches content-hashed `/_next/static/` files on first use, and
  sends every other request straight to the network. Pages, `/api` and
  share links are never cached: they hold tenant data, and a shared or lost
  device must not keep it. Navigations without a connection get the offline
  page. Old caches are deleted on activation; `sw.js` is served with
  `Cache-Control: no-cache` so fixes reach browsers at once.
- **Production only.** The worker is registered only in production builds so
  development never serves stale code.
- **Content security policy** is unchanged: `default-src 'self'` already
  covers the worker and the manifest.

## Not included

Offline editing, background sync and push notifications. Each needs a data
model for queued changes and conflicts (or a push service and consent flow)
and its own threat model; they stay on the backlog.

## Gates

The browser test fetches the manifest, waits for the worker, goes offline
and expects the offline page, with an axe audit of it.
