# Runbook: outbox lag alarm

`atlas_outbox_lag_seconds` above 60 for five minutes means live updates,
notifications, webhooks and rules are delayed. Data is safe: events wait in
PostgreSQL.

1. Is the worker running? ECS service `worker`, and the "worker not
   running" alarm. Restart the service if tasks are crash-looping and read
   the last log lines (`/atlas/<env>/worker`).
2. Is Redis reachable? Worker logs say "outbox dispatch failed; retrying"
   when publishing fails. Check the ElastiCache primary and failover events.
3. Is the database slow? RDS CPU and Performance Insights; the dispatcher
   query uses the partial index on unpublished events.
4. Is one job failing? `atlas_worker_batches_total{result="error"}` by job.
5. Once fixed, lag drains on its own; more worker tasks drain it faster
   (all loops are safe to run in parallel).
