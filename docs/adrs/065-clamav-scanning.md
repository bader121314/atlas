# ADR-065: ClamAV scans every upload (M10)

## Context

ADR-034 quarantines uploads until a type check and a malware scan pass, but
the scanner was a stand-in that only recognised the EICAR test file. The
security review listed a real scanner as an open item before accepting
untrusted uploads.

## Decisions

- **ClamAV's daemon, spoken to directly.** `packages/shared/src/malware.ts`
  implements clamd's `INSTREAM` command on `node:net`: the file is sent in
  64 KB length-prefixed chunks and clamd answers `OK` or `<signature> FOUND`.
  No client package is added, in line with the small-dependency rule.
- **The whole file is scanned,** not a sample: uploads are capped at 10 MB,
  so the worker reads the object once and uses it for both the type check
  and the scan.
- **Fail closed.** An error reply, a dropped connection or a 30-second
  timeout throws; the batch rolls back and the files stay quarantined until
  the next run. A scanner outage delays uploads but never lets one through.
- **Configured by `CLAMD_HOST`** (and `CLAMD_PORT`, default 3310). Without
  it the EICAR stand-in remains, for development and unit tests, and the
  worker warns at start-up in production.
- **Where it runs:** the free demo kit runs `clamav/clamav-debian` (amd64 and
  arm64) next to the worker; local development has it behind the `scan`
  Compose profile because it needs about 1.5 GB of memory; CI runs it as a
  service so the integration tests scan with real signatures.
- **AWS is not wired yet.** A ClamAV task would add memory, and so cost, to
  the ECS stack; that needs the owner's approval first (AGENTS.md).

## Verification

Unit tests drive the client against a fake clamd: chunking and reassembly
of a 200 KB file, a signature past the first chunk, error replies, a hung
daemon and a refused connection. In CI the integration tests check the
EICAR file against the real daemon, and the attachment tests run their
whole flow through it.

## Consequences

The worker needs network access to clamd and clamd needs its signature
updates (its image runs `freshclam`). New uploads in a fresh demo wait a
minute or two while signatures load.
