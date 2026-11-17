# ADR-043: AWS infrastructure as code

## Decisions

- **Terraform, one root module, one state per environment.** Files are
  grouped by concern (`network`, `data`, `storage`, `ecs`, `alb`,
  `secrets`, `observability`); environments differ only in a tfvars file
  and a backend file. State lives in S3 with DynamoDB locking. CI runs
  `terraform fmt -check` and `terraform validate` on every change; nothing
  is applied from CI yet because there is no AWS account for this project.
- **Shape.** A VPC across two zones: public subnets hold only the load
  balancer and NAT gateways; the application (ECS Fargate services for
  web, API and worker), PostgreSQL 17 (RDS, encrypted, TLS required,
  14 days of backups, deletion protection, optional Multi-AZ) and Redis
  (ElastiCache, encrypted in transit and at rest, auth token, failover) run
  in private subnets. Security groups allow only load balancer → web,
  web → API and application → data.
- **One public origin.** The HTTPS load balancer (TLS 1.2+) forwards to the
  web server only; the web server proxies `/api` to the API over ECS
  Service Connect (`http://api:3001`, the same name compose uses). The
  metrics routes are blocked at the load balancer.
- **Files:** a private, encrypted, versioned S3 bucket with public access
  blocked, TLS-only policy, old versions expiring after 30 days, and CORS
  that allows only `PUT` from the web origin (presigned uploads).
- **Secrets** are Secrets Manager entries injected into tasks; their values
  are set outside Terraform so they never enter state. The RDS master
  password is generated and stored by RDS itself.
- **Deployments** use immutable image tags (the commit) in ECR with scan on
  push, a one-off migrate task before services update, and the ECS
  deployment circuit breaker to roll back failed releases automatically.
- **Alarms** (SNS email): load balancer 5xx above 1%, database CPU and free
  storage, and the worker not running. Application metrics from ADR-041
  are scraped inside the VPC.

## Consequences

- Storage access uses an IAM user's keys because Atlas signs S3 requests
  itself (ADR-034); moving the signer to task-role credentials (session
  token header) removes the long-lived key.
- Costs are dominated by NAT gateways, RDS and ElastiCache; staging uses a
  single-zone database.
