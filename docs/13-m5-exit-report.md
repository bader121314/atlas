# 13 — M5 Exit Report: Attachments, Search and Analytics

**Status:** complete, with the deferrals listed below.
**Date:** 2026-11-17.
**Scope reference:** `docs/08-milestones.md`, M5.

## Exit criteria and evidence

| Exit criterion                                | Evidence                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unsupported or bad files rejected             | `tests/integration/attachments.test.ts`: unsupported types and files over 10 MB are refused; an executable named `.png` and the EICAR test file are rejected by the checks and deleted from storage; a size mismatch is rejected; the upload URL only accepts the declared type. |
| Quarantined files cannot be fetched           | The same test: downloads answer 409 until the worker marks the file clean, and stay 409 for rejected files. The browser smoke test uploads a PNG, waits for the check and downloads it.                                                                                          |
| Search does not reveal private projects       | `tests/integration/search.test.ts`: a member searching finds organization-wide tasks but nothing from a private project, even by exact key; other organizations' tasks never appear.                                                                                             |
| Dashboard numbers reconcile with the database | `tests/integration/analytics.test.ts` builds a known project and checks totals, per-status counts, overdue, unassigned, weekly counts and median lead time against the rows.                                                                                                     |
| Export respects policy and expires            | `tests/integration/exports.test.ts`: viewers cannot export; only the requester can download; an export queued before access was lost fails without a file; expired exports answer 410 and their files are deleted. The smoke test exports and downloads a CSV.                   |

## Delivered

| Area        | Delivered                                                                                             | Decision record |
| ----------- | ----------------------------------------------------------------------------------------------------- | --------------- |
| Search      | Full-text search over tasks and comments in any script, task keys, access inside the query            | ADR-032         |
| Analytics   | Project numbers from SQL and a dashboard section                                                      | ADR-033         |
| Attachments | Presigned uploads (SigV4 on node:crypto), quarantine, magic-byte and malware checks, signed downloads | ADR-034         |
| Exports     | Background CSV exports with a `task.export` permission and 24-hour expiry                             | ADR-035         |

**Test totals at exit:** 145 unit tests and 114 integration tests, plus the
browser smoke test, which now also uploads and downloads an attachment,
searches from the keyboard and exports a CSV.

## Deferred, with reasons

| Item                              | Status and reason                                                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Real malware scanner              | The scan step and quarantine are real; the scanner is a stub that detects EICAR. ClamAV or a provider scan is deployment work (M7).             |
| Real object storage in CI         | Tests use an S3 stand-in that verifies SigV4 signatures; the signer matches the AWS documentation example. A MinIO run belongs with deployment. |
| Tenant-partitioned search indexes | Queries filter by organization and readable projects; composite or partitioned indexes wait for real data volumes.                              |
| Cycle time                        | Atlas reports lead time (creation to completion); cycle time needs work-started history.                                                        |
| Image previews and inline viewing | Files always download as attachments, which keeps uploaded content off our origins.                                                             |

## Next: M6

Automation and integrations: rules with conditions and actions, recurring
tasks, scoped API tokens, and signed outbound webhooks with SSRF protection,
retries and delivery history.
