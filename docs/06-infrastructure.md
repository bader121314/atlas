# 06 — Infrastructure, CI/CD, SRE and Operations

## Environments

- **Local:** Docker Compose PostgreSQL, Redis, MinIO, Mailpit, optional Jaeger/OTel collector; development web/API/worker; deterministic seed script.
- **CI ephemeral:** isolated Postgres/Redis, migrations and integration tests; mocked external providers; Playwright ephemeral deployment or containers.
- **Staging:** same deployment topology as prod at smaller scale, isolated secrets and data, representative synthetic workloads.
- **Production:** AWS primary region selected for latency, residency and budget; separate AWS accounts/projects or equivalent isolation, not shared credentials.

## AWS reference design

Route 53 + ACM TLS; CloudFront/WAF in front of Next.js runtime and static assets; Application Load Balancer forwarding web and API/WS to ECS Fargate services in private subnets. Managed RDS PostgreSQL in private subnet with encryption, PITR backups and connection pooling/proxy as appropriate. ElastiCache Redis within private network with authentication/TLS. S3 for private attachments and CDN only for public assets; Secrets Manager and KMS, scoped IAM task roles. NAT/egress strategy includes monitoring and SSRF mitigations. CloudWatch and OTel collector export logs, traces and metrics; alert endpoints integrate with chosen incident channel.

## Terraform stacks

`network` (VPC, subnets, routes, security groups), `dns-tls`, `compute` (ECS cluster/services/task defs, ALB), `data` (RDS/Redis), `storage` (S3/KMS), `observability`, `secrets`, `budgets`, `iam`. State encrypted with locking, separated per environment. PR plan reviewed and policy scanned; applies restricted to authorized workflows. Never commit tfstate, secrets, provider credentials or sensitive outputs.

## CI workflow

PR: `pnpm install --frozen-lockfile` -> format/lint -> typecheck -> unit tests -> integration tests (Postgres/Redis) -> build -> OpenAPI breaking-change check -> dependency/secret/IaC scanning -> Playwright smoke E2E -> artifact build and image scan. Mainline: immutable image by digest -> staging deploy -> migration validation -> smoke + contract + security checks -> gated production deploy (manual approval) -> canary or rolling deployment -> verify health/metrics -> post-deployment smoke.

## Database migrations and rollback

Migrations run once as controlled release job; establish migration lock, dry-run in staging, backup verification, backward-compatible expand-contract and explicit approval for destructive changes. Application rollback uses image digest and compatible schema. Database rollback may require forward fix, backup restore and data-loss assessment; never promise automatic reversal of irreversible schema/data changes.

## Monitoring and SLOs

Track request rate, error rate, p50/p95/p99 latency, queue depth, worker retry/DLQ, outbox publish lag, WebSocket connected clients, database pool saturation, slow queries, storage consumption, login failures and audit anomalies. Service SLO target 99.9% availability after baseline; define error budget and maintenance policy. Instrument trace IDs across HTTP, worker jobs and events, with safe sampling and PII redaction. OpenTelemetry for application metrics/traces; logs may use structured logger with trace correlation pending SDK stability.

## Alerting and runbooks

Critical alerts: sustained elevated 5xx, DB unavailable, high outbox lag, queue DLQ growth, login abuse, backup failure, high storage, budget anomaly. Runbooks: deploy rollback, database restore, stalled worker, redis outage, websocket disruption, failed external email, compromised token, upload malware, emergency access revocation. Document on-call escalation even if solo maintainer.

## Backup, disaster recovery and security

RDS automated backup PITR, daily snapshot policies, restore drills; S3 versioning/lifecycle policies and recovery plan; secret backup/recovery and rotation; infra recreation from Terraform. Initial recovery planning targets RPO <= 1h, RTO <= 4h **aspirational until tested**. Availability zone strategy and backups chosen against actual cost and budget. Do not claim multi-region resilience unless built and validated.

## Cost safety

Tag all resources, cost budgets and alerts, automatic non-prod shutdown, rate limits for uploads/jobs and external API consumption. Prefer managed services but compare estimated fixed monthly expenses before deployment. No placeholder cost estimates advertised as actual.

## Local developer commands (targets; implement them)

`pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm build`, `pnpm infra:plan`. A command is not 'available' until scripts actually exist and pass.
