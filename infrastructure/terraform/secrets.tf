# Application secrets. Values are set outside Terraform (aws secretsmanager
# put-secret-value) so they never enter state or the repository; see
# docs/runbooks/deploy.md.
locals {
  secret_names = [
    "SESSION_SECRET",
    "WEBHOOK_SECRET_KEY",
    "METRICS_TOKEN",
    "STORAGE_ACCESS_KEY",
    "STORAGE_SECRET_KEY",
    "DATABASE_URL",
    "REDIS_URL",
  ]
}

resource "aws_secretsmanager_secret" "app" {
  for_each                = toset(local.secret_names)
  name                    = "${local.name}/${each.key}"
  recovery_window_in_days = 7
}
