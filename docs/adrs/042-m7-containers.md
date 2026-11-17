# ADR-042: Container images

## Decisions

- **One Dockerfile, four targets.** `infrastructure/docker/Dockerfile`
  builds the workspace once and produces `api`, `worker`, `web` and
  `migrate` images. The runtime stage keeps production dependencies only
  (`pnpm install --prod --offline` from the build's store), runs as the
  unprivileged `node` user, listens on `0.0.0.0` (`LISTEN_HOST`; the
  default outside containers stays loopback) and declares a health check
  against the live endpoint.
- **Migrations are a separate one-shot image.** Deployments run `migrate`
  to completion before starting new API and worker versions, so schema
  changes never race application starts. Migrations are written to be
  backward compatible with the previous release (add, backfill, then use).
- **The web image's API address is a build argument.** Next.js fixes
  rewrites when it builds, so `API_ORIGIN` is passed at build time.
- **Full stack locally.** `compose.app.yml` adds the four services on top
  of `docker-compose.yml`'s infrastructure, with `TRUST_PROXY=1` for the
  web server in front of the API.
- **CI builds every image** from a clean checkout and checks the user and
  entry points. Images are not pushed until a registry exists (M7 infra).

## Consequences

- The runtime image carries the whole pruned workspace rather than traced
  files; Next.js standalone output and per-app deploys can shrink it later.
