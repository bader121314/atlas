# 16 — Load Baseline

`scripts/load-test.mjs` sends concurrent GET requests for a fixed time and
reports throughput, error rate and latency percentiles; it exits non-zero
when the error rate or p95 latency exceeds the given limits, so it can gate
a deployment.

The browser smoke test runs it at the end of every run: ten concurrent
readers for ten seconds against a project's task list, through the web
server's proxy, with a signed-in session, on a GitHub-hosted runner with
PostgreSQL and Redis on the same machine. The job fails if p95 exceeds one
second or more than 1% of requests fail. The latest numbers are printed in
the job log as a `LOAD-TEST` line.

| Run                   | Requests/s | p50   | p95   | p99   | Errors     |
| --------------------- | ---------- | ----- | ----- | ----- | ---------- |
| CI runner, 2026-11-17 | 747        | 13 ms | 19 ms | 25 ms | 0 of 7,474 |

These numbers describe a shared CI machine, not production capacity. A
staging run with production-sized data (ADR-043) sets the real baseline.

## Query timings with a large project (M10)

To find slow queries before real data does, `scripts/perf/large-dataset.sql`
fills an empty, migrated database with 50 organizations, 300 people and one
project of 20,000 tasks (plus 149 small projects), with assignees, labels,
comments, history, outbox events and notifications: 49,800 tasks in all.
Each hot query was then run with `EXPLAIN ANALYZE` on PostgreSQL 16 on a
development machine, using the same SQL the services send.

| Query (20,000-task project)                | Before     | After    |
| ------------------------------------------ | ---------- | -------- |
| Task list, one page of 100 (any filter)    | 2–8 ms     | same     |
| Notification inbox, one page               | 0.1 ms     | same     |
| Search across the organization             | 0.5 ms     | same     |
| Task history                               | 0.1 ms     | same     |
| Event stream catch-up                      | 0.1 ms     | same     |
| Project numbers: created/completed by week | 260–320 ms | 20 ms    |
| Project numbers: the other four queries    | 8–14 ms    | same     |
| Team workload (whole organization)         | 90–120 ms  | 47–57 ms |

Two queries changed, with identical results checked row for row:

- **Created and completed per week** counted each of the 12 weeks with two
  correlated subqueries, scanning the project 24 times. It now groups the
  project's tasks by week once per measure.
- **Workload** divided each estimate by its number of assignees with a
  subquery per task-assignee row (13,600 of them). A window count over the
  same join gives the number in one pass.

Indexes already covered every filtered path; no new ones were needed. The
board loads at most 2,000 tasks in pages of 100, so very large projects rely
on filters and the table view.

These are single-query timings on an idle machine, not a capacity figure.
