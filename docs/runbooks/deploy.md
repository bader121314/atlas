# Runbook: deploy a release

Atlas deploys as four images built from one commit (ADR-042, ADR-043).

## First time for an environment

1. Create the state bucket and lock table, then
   `terraform init -backend-config=environments/<env>.backend.hcl`.
2. `terraform apply -var-file=environments/<env>.tfvars` with a placeholder
   `image_tag`; services will not start until images exist.
3. Set every secret (never in a file that is committed):
   `aws secretsmanager put-secret-value --secret-id atlas-<env>/SESSION_SECRET --secret-string "$(openssl rand -base64 48)"`
   and likewise `WEBHOOK_SECRET_KEY`, `METRICS_TOKEN`, the storage keys,
   `DATABASE_URL` (built from the RDS master secret, with
   `sslmode=require`) and `REDIS_URL` (`rediss://:<token>@<endpoint>:6379`).
4. Point the domain at the `load_balancer_dns_name` output.

## Every release

1. CI is green on `main` for the commit.
2. Build and push the images tagged with the commit:
   `docker build -f infrastructure/docker/Dockerfile --target api -t <ecr>/atlas-<env>-api:<sha> .`
   (and `worker`, `migrate`, and `web` with `--build-arg API_ORIGIN=http://api:3001`), then `docker push`.
3. Run migrations and wait for success:
   `aws ecs run-task --cluster atlas-<env> --task-definition atlas-<env>-migrate --launch-type FARGATE --network-configuration ...`
   (subnets and security group from the outputs). Migrations are
   backward compatible with the running release, so this is safe first.
4. `terraform apply -var-file=environments/<env>.tfvars -var image_tag=<sha>`.
   ECS replaces tasks gradually; the circuit breaker rolls back if new
   tasks fail health checks.
5. Check: `/health/ready` through the domain, the 5xx alarm stays OK, and
   `atlas_outbox_lag_seconds` stays under a few seconds.

If anything fails, follow `rollback.md`.
