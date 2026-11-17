# 18 — Case Study: Building Atlas

## The brief

Build a collaborative work-management service the way a small product team
would: multi-tenant from the first table, secure by default, tested against
real databases, documented as it goes, and honest about what is and is not
done. The scope came from a product and architecture specification
(`docs/01` to `docs/08`) split into ten milestones.

## Constraints that shaped it

- **Multi-tenancy is the core risk.** One bug that shows one customer's data
  to another ends the product. Every decision below starts there.
- **No new dependencies mid-build.** From M4 on, the build environment could
  not reach the package registry, so the lockfile was fixed. Signing S3
  requests, Prometheus metrics, Server-Sent Events and CSV export were
  written on Node's standard library instead of adding packages. That kept
  the dependency surface small, at the cost of owning more code, so each of
  those pieces has known-answer or protocol tests (the S3 signer reproduces
  the AWS documentation example exactly).
- **No cloud account.** Infrastructure is code validated in CI; rollback and
  restore are proven with the real images in a CI release drill.

## Key decisions

| Decision                                                                                | Why                                                                                       | Record           |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------- |
| Tenant checked in guards and again by composite foreign keys and triggers               | A forgotten `WHERE` clause should fail in the database, not leak                          | ADR-010, ADR-015 |
| Outsiders get the same 404 as missing resources                                         | Organizations and projects cannot be discovered by probing                                | ADR-015, ADR-018 |
| Transactional outbox for every change                                                   | History, live updates, notifications, webhooks and rules can never disagree with the data | ADR-020, ADR-028 |
| Server-Sent Events instead of WebSockets                                                | Updates are one-way; SSE reuses cookies, guards and the same-origin proxy                 | ADR-029          |
| Event payloads carry ids only                                                           | A routing mistake cannot leak content; clients refetch through the guarded API            | ADR-028, ADR-029 |
| Workers on PostgreSQL `SKIP LOCKED`                                                     | Exactly-once claims without a second queue system                                         | ADR-028, ADR-031 |
| Uploads quarantined until magic bytes and a scan pass, always downloaded as attachments | Uploaded files can never run as pages on our origins                                      | ADR-034          |
| Webhooks resolve DNS and pin the checked address                                        | Closes SSRF including DNS rebinding                                                       | ADR-036          |
| Rules carry a depth and ignore their own changes                                        | Two rules that undo each other stop after three steps                                     | ADR-038          |

## Problems found, and how

- **A starved job.** Exports never ran in the browser test. Two worker loops
  shared one "busy" flag on the same two-second timer; the first always won.
  Unit and integration tests called the loops directly and passed. Fix: one
  flag per job; lesson: test the scheduler, not just the functions.
- **A build setting silently dropped.** The content security policy blocked
  uploads in CI because Turborepo filters environment variables it does not
  know about, so the storage address never reached the Next.js build. The
  same filter would have broken the Docker web image's API address. Fix:
  declare build-time variables in `turbo.json`.
- **Type inference in SQL.** Reusing a parameter as both `uuid` and `text`
  makes PostgreSQL refuse the statement. Found by integration tests, then
  checked before pushing by preparing every new statement against a local
  PostgreSQL.
- **Accessibility regressions** (a calendar announced as an interactive grid,
  ambiguous labels) were caught by the axe audit added to the browser test
  in M3, not by review.

## Results

- 48 merged pull requests across eight milestones, each with CI green on
  five workflows: checks and tests, browser test, image builds, Terraform
  validation and the release drill.
- 187 unit and 134 integration tests; a browser test across three screen
  sizes with an accessibility audit and a load baseline (p95 19 ms at 747
  requests per second on a CI machine).
- 44 architecture decision records and seven exit reports, each listing
  what was deferred and why.

## What I would do next

Deploy staging and repeat the release drill there; replace the malware
scanner stub; move S3 signing to role credentials; nonce-based content
security policy; multiple assignees and mentions.
