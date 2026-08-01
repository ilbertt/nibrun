# Secrets the instances read at deploy time. Generated once and kept in state
# (the S3 backend is encrypted + access-controlled), so a deploy never carries
# a credential through CI.

resource "random_password" "db" {
  length  = 32
  special = false # used inside a postgres:// URL, keep it URL-safe
}

resource "random_password" "better_auth_secret" {
  length  = 48
  special = false
}

# Presented by the agent when it dials the control plane's socket. Both fleets
# read the same parameter, so rotating it means redeploying the control plane
# and every host — do the control plane first, or hosts will be rejected.
resource "random_password" "host_token" {
  length  = 48
  special = false
}

resource "aws_ssm_parameter" "db_password" {
  name  = "${var.ssm_secret_prefix}/db_password"
  type  = "SecureString"
  value = random_password.db.result

  tags = {
    Name = "${local.resource_name_prefix}-db-password"
  }
}

resource "aws_ssm_parameter" "better_auth_secret" {
  name  = "${var.ssm_secret_prefix}/better_auth_secret"
  type  = "SecureString"
  value = random_password.better_auth_secret.result

  tags = {
    Name = "${local.resource_name_prefix}-better-auth-secret"
  }
}

resource "aws_ssm_parameter" "host_token" {
  name  = "${var.ssm_secret_prefix}/host_token"
  type  = "SecureString"
  value = random_password.host_token.result

  tags = {
    Name = "${local.resource_name_prefix}-host-token"
  }
}
