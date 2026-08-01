# Secrets the instance reads at deploy time. Generated once and kept in state
# (the S3 backend is encrypted + access-controlled), so a deploy never carries a
# credential through CI.

resource "random_password" "postgres" {
  length  = 32
  special = false # used inside a postgres:// URL, keep it URL-safe
}

resource "random_password" "api_better_auth_secret" {
  length  = 48
  special = false
}

resource "aws_ssm_parameter" "postgres_password" {
  name  = "${var.ssm_secret_prefix}/postgres_password"
  type  = "SecureString"
  value = random_password.postgres.result

  tags = {
    Name = "${local.resource_name_prefix}-postgres-password"
  }
}

resource "aws_ssm_parameter" "api_better_auth_secret" {
  name  = "${var.ssm_secret_prefix}/api_better_auth_secret"
  type  = "SecureString"
  value = random_password.api_better_auth_secret.result

  tags = {
    Name = "${local.resource_name_prefix}-api-better-auth-secret"
  }
}
