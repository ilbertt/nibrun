# Secrets the instance reads at deploy time. Generated once and kept in state
# (the S3 backend is encrypted + access-controlled), so a deploy never carries a
# credential through CI. Each parameter is named exactly like the environment
# variable it becomes.

resource "random_password" "api_db_password" {
  length  = 32
  special = false # used inside a postgres:// URL, keep it URL-safe
}

resource "random_password" "api_better_auth_secret" {
  length  = 48
  special = false
}

resource "aws_ssm_parameter" "api_db_password" {
  name  = "${var.ssm_secret_prefix}/api_db_password"
  type  = "SecureString"
  value = random_password.api_db_password.result

  tags = {
    Name = "${local.resource_name_prefix}-api-db-password"
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

# Credentials of the api's own IAM user (iam_api.tf), not generated here.
resource "aws_ssm_parameter" "api_s3_access_key_id" {
  name  = "${var.ssm_secret_prefix}/api_s3_access_key_id"
  type  = "SecureString"
  value = aws_iam_access_key.api.id

  tags = {
    Name = "${local.resource_name_prefix}-api-s3-access-key-id"
  }
}

resource "aws_ssm_parameter" "api_s3_secret_access_key" {
  name  = "${var.ssm_secret_prefix}/api_s3_secret_access_key"
  type  = "SecureString"
  value = aws_iam_access_key.api.secret

  tags = {
    Name = "${local.resource_name_prefix}-api-s3-secret-access-key"
  }
}
