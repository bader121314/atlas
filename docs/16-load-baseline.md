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
