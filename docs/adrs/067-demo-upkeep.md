# ADR-067: Keeping the public demo fresh and watched (M10)

## Context

The free demo (ADR-062) is public and every visitor shares one account, so
its data drifts as people try things. It runs on one server with no managed
backups, and nobody would notice if it went down.

## Decisions

- **Nightly reset.** `setup.sh reset` backs up, then replaces only the
  database and file-store volumes and reruns the migrations and the seed.
  Certificates, ClamAV signatures and built images are kept, so a reset takes
  about a minute and never touches Let's Encrypt limits. Redis is flushed so
  old sessions end with the data they belonged to.
- **Daily backup.** `setup.sh backup` writes a compressed `pg_dump` to
  `~/atlas-backups`, keeps the newest seven, and stores a copy of `.env`
  beside them (mode 600): the dump's sealed values (webhook and SSO secrets)
  are only readable with those keys.
- **Scheduling** is a file in `/etc/cron.d` written by `setup.sh start` and
  `update`: backup at 23:30 UTC, reset at 00:00 UTC (02:30 and 03:00 in
  Riyadh, when traffic is lowest). Output goes to `~/atlas-demo.log`.
- **`update` re-executes the freshly pulled script**, so changes to
  `setup.sh` take effect in the same run.
- **Uptime** is a scheduled GitHub Actions workflow that requests the
  sign-in page and `/api/health/ready` every hour, retrying three times a
  minute apart. A failed scheduled run is emailed to the owner by GitHub;
  no monitoring service or cost is added.

## Consequences

Backups live on the same server, so they protect against mistakes and bad
updates, not against losing the server; the demo's data is synthetic, which
makes that acceptable. GitHub disables scheduled workflows in a repository
with no activity for 60 days; a push or a manual run re-enables it.
