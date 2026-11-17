# Runbook: backups and restore

## What is backed up

- **PostgreSQL:** automated RDS snapshots and point-in-time recovery for 14
  days; a final snapshot on deletion (deletion protection is on).
- **Files:** S3 versioning keeps overwritten or deleted objects for 30
  days. Exports are temporary by design and are not restored.
- **Redis** holds only rate-limit windows, presence and pub/sub; it is not
  backed up and starts empty safely.

## Restore the database to a point in time

1. Pick the time just before the problem (UTC).
2. `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier atlas-<env> --target-db-instance-identifier atlas-<env>-restore --restore-time <ISO time>`
   with the same subnet group, security group and parameter group.
3. Check the restored instance: row counts for `organizations`, `tasks`,
   and the newest `audit_events` timestamps.
4. Either switch `DATABASE_URL` to the restored endpoint and redeploy, or
   copy the affected rows back with SQL, depending on the damage.
5. Outbox rows restored as unpublished are published again; consumers
   deduplicate by event id (ADR-028, ADR-036), so this is safe.

## Restore drill (quarterly)

Restore the latest staging snapshot to a new instance, run the migrate
image against it (it must report nothing to apply), point a temporary API
task at it, sign in, open a project, then delete the instance. Record the
time taken; the target is under one hour.
