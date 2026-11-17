# 17 — M7 Exit Report: Hardening, Staging and Observability

**Status:** complete for everything that can be shown without a cloud
account; the AWS-specific steps are written and validated but not yet
applied (see limitations).
**Date:** 2026-11-17.
**Scope reference:** `docs/08-milestones.md`, M7.

## Exit criteria and evidence

| Exit criterion                                      | Evidence                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staging rebuild from the repository is reproducible | The release drill (`.github/workflows/release-drill.yml`, ADR-044) builds every image from a clean checkout and brings up PostgreSQL, Redis, API, worker and web on each push to `main`. The Terraform stack (ADR-043) passes `fmt` and `validate` in CI. |
| Rollback demonstrated                               | The drill upgrades from the previous release, then runs the previous release against the new schema and checks it is ready. In AWS the ECS circuit breaker rolls back failed deployments (`docs/runbooks/rollback.md`).                                   |
| Restore exercised                                   | The drill dumps the database, restores it into a fresh database, runs migrations (nothing to apply), checks the rows and serves the release from it. The AWS procedure and a quarterly drill are in `docs/runbooks/backup-restore.md`.                    |
| Multi-tenant security test suite passes             | 134 integration tests against real PostgreSQL and Redis, including tenant isolation, private projects, tokens, uploads, SSRF and exports; mapped to threats in `docs/15-security-review.md`.                                                              |
| Performance report with limitations                 | `docs/16-load-baseline.md`: 747 requests per second, p95 19 ms, no errors, for ten concurrent readers on a CI machine, measured on every smoke run; it states what the numbers do not show.                                                               |

## Delivered

| Area            | Delivered                                                                               | Record    |
| --------------- | --------------------------------------------------------------------------------------- | --------- |
| Request tracing | Request ids in responses, errors, audit events and JSON logs; trusted proxies           | ADR-040   |
| Metrics         | Prometheus metrics for HTTP, outbox lag, worker backlogs and batches; alert definitions | ADR-041   |
| Containers      | API, worker, web and migrate images; full-stack compose; CI image builds                | ADR-042   |
| AWS             | Terraform for network, ECS, RDS, ElastiCache, S3, ALB, secrets and alarms               | ADR-043   |
| Operations      | Runbooks for deploy, rollback, backup and restore, outbox lag; release drill in CI      | ADR-044   |
| Security        | Review with evidence and open items; content security policy; change password           | `docs/15` |
| Performance     | Load test script and baseline                                                           | `docs/16` |

**Test totals at exit:** 187 unit tests and 134 integration tests, the
browser smoke test (accessibility, three viewports, live updates, uploads,
exports, load), the image builds, the Terraform validation and the release
drill.

## Limitations

- **No cloud environment yet.** Terraform has not been applied; DNS, TLS,
  CDN and alarms are untested against AWS. The first staging deployment
  must repeat the release drill there.
- **Dashboards.** Metrics and alert rules are defined, but no Grafana or
  CloudWatch dashboard is provisioned.
- **CDN.** Static assets are served by the web server behind the load
  balancer; CloudFront is not configured.
- **Image size.** Images are about 1.4 GB because they carry the pruned
  workspace (ADR-042).
- **Load numbers** come from a shared CI machine with the database on the
  same host and a small dataset.
- **Open security items** are listed in `docs/15-security-review.md`
  (nonce-based CSP, task-role storage credentials, a real malware scanner).

## Next: M8

Public portfolio release: a demo organization with seeded data, an updated
README with screenshots and diagrams, a walkthrough and a case study.
