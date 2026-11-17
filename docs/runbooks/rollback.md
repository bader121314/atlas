# Runbook: roll back a release

1. **Automatic:** if new tasks fail their health checks, the ECS circuit
   breaker returns the service to the previous task definition. Confirm in
   the ECS console that the deployment shows "rolled back".
2. **Manual:** apply the previous image tag:
   `terraform apply -var-file=environments/<env>.tfvars -var image_tag=<previous sha>`.
3. **Schema:** migrations are additive and backward compatible, so the
   previous release runs against the new schema; do not reverse a
   migration during an incident. If a migration itself is wrong, write a new
   forward migration.
4. Record what happened, the request ids from the alarm window (logs are
   JSON with `requestId`), and the follow-up in the incident notes.
