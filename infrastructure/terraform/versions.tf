# Atlas on AWS (ADR-043). One root module per environment, selected with a
# tfvars file: terraform plan -var-file=environments/staging.tfvars
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  # State lives in S3 with locking; configure per environment with
  # terraform init -backend-config=environments/staging.backend.hcl
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Application = "atlas"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
