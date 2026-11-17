resource "aws_ecr_repository" "atlas" {
  for_each             = toset(["api", "worker", "web", "migrate"])
  name                 = "${local.name}-${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

# The web server reaches the API by name (http://api:3001), as in compose.
resource "aws_service_discovery_http_namespace" "main" {
  name = "${local.name}.internal"
}

resource "aws_ecs_cluster" "main" {
  name = local.name
  service_connect_defaults {
    namespace = aws_service_discovery_http_namespace.main.arn
  }
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["api", "worker", "web", "migrate"])
  name              = "/atlas/${var.environment}/${each.key}"
  retention_in_days = 30
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Pulls images and reads secrets at start.
resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "read_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [for s in aws_secretsmanager_secret.app : s.arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.read_secrets.json
}

# What the running application may do: only its own bucket.
resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "files" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.files.arn}/*"]
  }
}

resource "aws_iam_role_policy" "task_files" {
  name   = "files"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.files.json
}

locals {
  plain_env = [
    { name = "NODE_ENV", value = "production" },
    { name = "LISTEN_HOST", value = "0.0.0.0" },
    { name = "WEB_ORIGIN", value = "https://${var.domain_name}" },
    { name = "TRUST_PROXY", value = "1" },
    { name = "STORAGE_ENDPOINT", value = "https://s3.${var.region}.amazonaws.com" },
    { name = "STORAGE_BUCKET", value = aws_s3_bucket.files.bucket },
    { name = "STORAGE_REGION", value = var.region },
  ]
  secret_env = [for name, s in aws_secretsmanager_secret.app : { name = name, valueFrom = s.arn }]
  processes = {
    api    = { port = 3001, cpu = 512, memory = 1024, count = var.api_count, command = null }
    worker = { port = 3002, cpu = 512, memory = 1024, count = var.worker_count, command = null }
    web    = { port = 3000, cpu = 512, memory = 1024, count = var.web_count, command = null }
  }
}

resource "aws_ecs_task_definition" "app" {
  for_each                 = local.processes
  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name                   = each.key
    image                  = "${aws_ecr_repository.atlas[each.key].repository_url}:${var.image_tag}"
    essential              = true
    # Next.js writes its cache at run time; the API and worker need no disk.
    readonlyRootFilesystem = each.key != "web"
    portMappings           = [{ name = each.key, containerPort = each.value.port, protocol = "tcp" }]
    environment            = local.plain_env
    secrets                = local.secret_env
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app[each.key].name
        awslogs-region        = var.region
        awslogs-stream-prefix = each.key
      }
    }
  }])
}

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name        = "migrate"
    image       = "${aws_ecr_repository.atlas["migrate"].repository_url}:${var.image_tag}"
    essential   = true
    environment = local.plain_env
    secrets     = local.secret_env
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app["migrate"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "migrate"
      }
    }
  }])
}

resource "aws_ecs_service" "app" {
  for_each               = local.processes
  name                   = each.key
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.app[each.key].arn
  desired_count          = each.value.count
  launch_type            = "FARGATE"
  enable_execute_command = false
  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.app.id]
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  # Only the web server faces the load balancer; it proxies /api to the API.
  dynamic "load_balancer" {
    for_each = each.key == "web" ? [each.key] : []
    content {
      target_group_arn = aws_lb_target_group.web.arn
      container_name   = load_balancer.value
      container_port   = each.value.port
    }
  }
  service_connect_configuration {
    enabled = true
    dynamic "service" {
      for_each = each.key == "api" ? [each.key] : []
      content {
        port_name = "api"
        client_alias {
          port     = 3001
          dns_name = "api"
        }
      }
    }
  }
}
