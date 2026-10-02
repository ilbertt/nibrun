resource "random_password" "umami_db_password" {
  length  = 32
  special = false # embedded in DATABASE_URL
}

resource "random_password" "umami_app_secret" {
  length  = 48
  special = false
}

resource "random_bytes" "umami_two_factor_encryption_key" {
  length = 32
}

resource "random_password" "umami_admin_password" {
  length  = 32
  special = false
}

resource "aws_ssm_parameter" "umami_admin_username" {
  name  = "${var.ssm_secret_prefix}/umami_admin_username"
  type  = "String"
  value = var.umami_admin_username

  tags = {
    Name = "${local.resource_name_prefix}-umami-admin-username"
  }
}

resource "aws_ssm_parameter" "umami_admin_password" {
  name  = "${var.ssm_secret_prefix}/umami_admin_password"
  type  = "SecureString"
  value = random_password.umami_admin_password.result

  tags = {
    Name = "${local.resource_name_prefix}-umami-admin-password"
  }
}

resource "aws_ssm_parameter" "umami_db_password" {
  name  = "${var.ssm_secret_prefix}/umami_db_password"
  type  = "SecureString"
  value = random_password.umami_db_password.result

  tags = {
    Name = "${local.resource_name_prefix}-umami-db-password"
  }
}

resource "aws_ssm_parameter" "umami_app_secret" {
  name  = "${var.ssm_secret_prefix}/umami_app_secret"
  type  = "SecureString"
  value = random_password.umami_app_secret.result

  tags = {
    Name = "${local.resource_name_prefix}-umami-app-secret"
  }
}

resource "aws_ssm_parameter" "umami_two_factor_encryption_key" {
  name  = "${var.ssm_secret_prefix}/umami_two_factor_encryption_key"
  type  = "SecureString"
  value = random_bytes.umami_two_factor_encryption_key.hex

  tags = {
    Name = "${local.resource_name_prefix}-umami-two-factor-encryption-key"
  }
}
