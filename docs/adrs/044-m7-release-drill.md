# ADR-044: Release drill in CI

## Context

M7 asks for a reproducible staging rebuild, a demonstrated rollback and an
exercised restore. There is no AWS account for this project, so these are
shown with the same images on a CI machine instead of in a cloud staging
environment.

## Decisions

- **A scripted drill** (`scripts/release-drill.sh`, workflow
  `release-drill.yml`) runs on every push to `main`, on infrastructure and
  migration changes, and on demand. It:
  1. builds all four images for the current commit and the previous one
     from a clean checkout;
  2. starts PostgreSQL and Redis, deploys the previous release (migrate,
     then API, worker and web), and upgrades to the current one;
  3. signs up a user through the web server's proxy;
  4. rolls back: runs the previous release against the current schema and
     checks it is ready, which proves migrations stay backward compatible;
  5. dumps the database, restores it into a fresh database, runs the
     current migrations against it (nothing to apply), checks the data and
     serves the current release from it.
- **Load is measured on every smoke run** (`docs/16-load-baseline.md`).

## Consequences

- The drill proves the release process and backward compatibility, not
  AWS specifics (IAM, networking, managed failover). The runbooks describe
  the AWS steps; the first staging deployment must repeat the drill there.
