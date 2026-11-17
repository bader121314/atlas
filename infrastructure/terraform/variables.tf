variable "environment" {
  description = "Environment name, e.g. staging or production."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,15}$", var.environment))
    error_message = "Use lowercase letters, digits and hyphens."
  }
}

variable "region" {
  description = "AWS region."
  type        = string
  default     = "me-central-1"
}

variable "domain_name" {
  description = "Public host name of the web app, e.g. atlas.example.com."
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate for domain_name, in this region."
  type        = string
}

variable "image_tag" {
  description = "Container image tag to deploy (the git commit)."
  type        = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "db_multi_az" {
  description = "Standby database in a second zone. On for production."
  type        = bool
  default     = true
}

variable "cache_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "api_count" {
  type    = number
  default = 2
}

variable "web_count" {
  type    = number
  default = 2
}

variable "worker_count" {
  description = "Worker tasks; every loop is safe to run in parallel (SKIP LOCKED)."
  type        = number
  default     = 1
}

variable "alarm_email" {
  description = "Where alarms are sent."
  type        = string
}
