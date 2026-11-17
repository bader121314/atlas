# ADR-062: Free public demo on one server (M9)

## Context

The owner wants a public demo for the portfolio at no cost. Atlas runs six
parts at once (web, API, worker, PostgreSQL, Redis, object storage), and the
worker polls every second. Free platform tiers checked in November 2026
either have no background workers (Render), have no free compute any more
(Koyeb), or meter usage that a polling worker exhausts in days (free
serverless PostgreSQL and Redis). A free virtual machine runs everything as
CI does.

## Decisions

- **Target: Oracle Cloud Always Free, one Arm VM** (about 2 OCPUs and 12 GB
  of memory), Ubuntu, Docker Compose. No Atlas code is specific to Oracle;
  any Linux server with Docker works.
- **`infrastructure/demo`:** a Compose file (PostgreSQL, Redis, MinIO,
  migrate, API, worker, web, a one-shot seed, and Caddy), a Caddyfile and
  `setup.sh`. Images build on the server from the same Dockerfile as CI
  (ADR-042), so no registry is needed. Caddy obtains Let's Encrypt
  certificates for two names under the free `sslip.io` wildcard DNS
  (`atlas.<ip>.sslip.io` and `files.<ip>.sslip.io`); storage gets its own
  name because presigned URLs are signed for their host (ADR-034).
- **Secrets are generated on the server** by `setup.sh` into a private
  `.env`; nothing is committed.
- **Demo mode, by configuration:**
  - `MAIL_DISABLED=true`: the server sends no email (there is no free mail
    service in this setup); messages are dropped, never queued forever.
  - `SIGNUPS_CLOSED=true`: sign-up returns 403, since new accounts could not
    be verified without email; the page says so.
  - `DEMO_EMAIL` and `DEMO_PASSWORD`: `GET /v1/auth/demo` returns them so the
    sign-in page can show the shared account. The password is generated per
    deployment, never hardcoded (AGENTS.md); elsewhere the route is 404.
  - The seed creates the fictional Harbour Works organization (M8) and sets
    the demo password; MinIO's bucket is created by
    `scripts/ensure-bucket.mjs` through the shared SigV4 code.
- **Codespaces as the no-server alternative:** `.devcontainer` starts the
  dependencies and installs everything, so a reviewer can run Atlas in their
  own Codespace.
- **CI checks** the demo Compose file, the Caddyfile, the scripts' syntax
  and that the migrate image carries the seed and bucket scripts.

## Risks

- Images are only built for amd64 in CI; the server builds arm64 itself.
  All base images are multi-arch, but the arm64 build is first exercised on
  the server.
- Oracle may reclaim Always Free VMs that stay nearly idle for a long time,
  and Arm capacity is sometimes unavailable at creation.
- The demo is shared: anyone can change its data. Re-running the seed resets
  only the password; resetting data means removing the volumes.
- `sslip.io` certificates count against Let's Encrypt limits shared by all
  its users; a free DuckDNS name is the fallback (set `APP_HOST` and
  `FILES_HOST` before running `setup.sh`).
- This records how to deploy; it is not a claim that Atlas is deployed.
