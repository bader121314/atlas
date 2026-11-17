# ADR-041: Metrics

## Decisions

- **Prometheus text format without a library.** A small registry in
  `@atlas/shared` provides counters, histograms and gauges read at scrape
  time; no client package can be installed here, and the format is simple.
- **API:** `atlas_http_requests_total` and
  `atlas_http_request_duration_seconds` by method, route pattern (never the
  concrete path, so slugs and ids are not label values) and status class;
  gauges for outbox events not yet published and the age of the oldest
  (`atlas_outbox_lag_seconds`, the main real-time health signal), and the
  worker's backlogs (notifications, webhooks, attachment checks, exports).
- **Worker:** `atlas_worker_batches_total` by job and result, and batch
  duration, for every loop.
- **Protected.** `GET /v1/metrics` on the API and the worker answers only
  `Authorization: Bearer <METRICS_TOKEN>` (16+ characters, compared in
  constant time) and is a 404 otherwise, including when no token is set.

## Alerts these support (runbook)

- Outbox lag above 60 seconds for 5 minutes: dispatcher down or Redis
  unreachable.
- Webhook backlog growing for 30 minutes: an endpoint is slow or failing.
- Worker batch errors above 0 for 10 minutes for any job.
- API 5xx rate above 1% for 5 minutes.
