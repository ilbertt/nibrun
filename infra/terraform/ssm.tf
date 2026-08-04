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

# The one secret Terraform cannot generate: it belongs to a GitHub OAuth App
# created by hand, so it enters from the repository secret of the same name.
# Landing it here rather than in the deploy's environment is deliberate — SSM
# RunCommand keeps its parameters in command history, in the clear, for 30 days.
resource "aws_ssm_parameter" "api_github_client_secret" {
  name  = "${var.ssm_secret_prefix}/api_github_client_secret"
  type  = "SecureString"
  value = var.api_github_client_secret

  tags = {
    Name = "${local.resource_name_prefix}-api-github-client-secret"
  }
}

# The proxy's TLS material. Both halves land here rather than in the deploy's
# own environment, for the same reason the OAuth App secret does — and the
# certificate rides along even though it is public, so the box has one way to
# read both.
#
# Encoded rather than stored as-is because a PEM is multi-line: the box reads
# parameters with `aws ssm get-parameter --output text`, which mangles that, and
# has no jq to read the JSON form instead. base64encode emits a single line, so
# on_box_deploy.sh only has to decode.
resource "aws_ssm_parameter" "caddy_tls_cert" {
  name  = "${var.ssm_secret_prefix}/caddy_tls_cert"
  type  = "SecureString"
  value = base64encode(var.caddy_tls_cert)

  tags = {
    Name = "${local.resource_name_prefix}-caddy-tls-cert"
  }
}

resource "aws_ssm_parameter" "caddy_tls_key" {
  name  = "${var.ssm_secret_prefix}/caddy_tls_key"
  type  = "SecureString"
  value = base64encode(var.caddy_tls_key)

  tags = {
    Name = "${local.resource_name_prefix}-caddy-tls-key"
  }
}

# The password for Dozzle's one login. Generated like every other secret here,
# and read back the same way when you need it:
#
#   aws ssm get-parameter --name <ssm_secret_prefix>/dozzle_password \
#     --with-decryption --query Parameter.Value --output text
#
# Only the password lives here, not the user list Dozzle actually reads. That
# file holds a bcrypt hash, and bcrypt is salted — hashing it here would produce
# a different value on every plan and rewrite the parameter on every apply. The
# box hashes this into the file instead, once per deploy, so rotating the
# password is just changing it here.
resource "random_password" "dozzle_password" {
  length  = 32
  special = false
}

resource "aws_ssm_parameter" "dozzle_password" {
  name  = "${var.ssm_secret_prefix}/dozzle_password"
  type  = "SecureString"
  value = random_password.dozzle_password.result

  tags = {
    Name = "${local.resource_name_prefix}-dozzle-password"
  }
}

# --- App hosts ---

# The user-app proxy's TLS material, carried exactly like the control plane
# proxy's above — base64 for the same reason, and both halves through SSM so
# neither reaches the deploy's own environment. A different certificate, because
# it is issued for a different zone.
resource "aws_ssm_parameter" "app_host_caddy_tls_cert" {
  name  = "${var.ssm_secret_prefix}/app_host_caddy_tls_cert"
  type  = "SecureString"
  value = base64encode(var.app_host_caddy_tls_cert)

  tags = {
    Name = "${local.resource_name_prefix}-app-host-caddy-tls-cert"
  }
}

resource "aws_ssm_parameter" "app_host_caddy_tls_key" {
  name  = "${var.ssm_secret_prefix}/app_host_caddy_tls_key"
  type  = "SecureString"
  value = base64encode(var.app_host_caddy_tls_key)

  tags = {
    Name = "${local.resource_name_prefix}-app-host-caddy-tls-key"
  }
}

# ZeroFS encrypts everything it writes to the filesystems bucket under this. It
# is generated once and never rotated in place: changing it does not re-encrypt
# anything, it makes every existing tenant filesystem unreadable. Treat it as
# permanent for the life of the bucket.
resource "random_password" "filesystems_encryption_password" {
  length  = 48
  special = false
}

resource "aws_ssm_parameter" "filesystems_encryption_password" {
  name  = "${var.ssm_secret_prefix}/filesystems_encryption_password"
  type  = "SecureString"
  value = random_password.filesystems_encryption_password.result

  tags = {
    Name = "${local.resource_name_prefix}-filesystems-encryption-password"
  }

  lifecycle {
    prevent_destroy = true
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
