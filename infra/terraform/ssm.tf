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

# 32 bytes of key material, carried as base64 so it survives an .env file intact.
# AES-256 is what the api seals a tenant's environment variables with, and the
# length is the cipher's, not a taste.
resource "random_bytes" "api_tenant_secrets_key" {
  length = 32
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

resource "aws_ssm_parameter" "api_tenant_secrets_key" {
  name  = "${var.ssm_secret_prefix}/api_tenant_secrets_key"
  type  = "SecureString"
  value = random_bytes.api_tenant_secrets_key.base64

  tags = {
    Name = "${local.resource_name_prefix}-api-tenant-secrets-key"
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

# The token the api registers custom hostnames with. Here rather than in the
# deploy's environment for the same reason the OAuth App secret is: RunCommand
# keeps its parameters in command history, in the clear, for 30 days.
#
# The zone id it is used against is not secret and rides through the workflow
# environment with the other non-secret config.
resource "aws_ssm_parameter" "api_cloudflare_api_token" {
  name  = "${var.ssm_secret_prefix}/api_cloudflare_api_token"
  type  = "SecureString"
  value = var.cloudflare_api_token

  tags = {
    Name = "${local.resource_name_prefix}-api-cloudflare-api-token"
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

# The password for the log dashboard, read back the same way as Dozzle's above
# and held here for the same reason: VictoriaLogs has no login of its own, so
# the proxy gates it, and Caddy wants a bcrypt hash. Salted, so the box hashes
# it once per deploy rather than Terraform rewriting the parameter every apply.
resource "random_password" "victorialogs_password" {
  length  = 32
  special = false
}

resource "aws_ssm_parameter" "victorialogs_password" {
  name  = "${var.ssm_secret_prefix}/victorialogs_password"
  type  = "SecureString"
  value = random_password.victorialogs_password.result

  tags = {
    Name = "${local.resource_name_prefix}-victorialogs-password"
  }
}

# pgweb's login, read back exactly like the two above. Both halves, unlike them:
# nothing publishes this console — an SSM port-forward is the only way to it — so
# the username is a second unguessable value rather than a name to remember, and
# an admin who is already looking up one parameter pays nothing to look up two.
#
# The credentials, not a hash. Dozzle and Caddy both want bcrypt and both re-salt,
# which is why the box does that hashing once per deploy; pgweb compares basic
# auth input directly, so what the box reads is what the container is given.
resource "random_password" "pgweb_auth_user" {
  length  = 16
  special = false
}

resource "random_password" "pgweb_auth_pass" {
  length  = 32
  special = false
}

resource "aws_ssm_parameter" "pgweb_auth_user" {
  name  = "${var.ssm_secret_prefix}/pgweb_auth_user"
  type  = "SecureString"
  value = random_password.pgweb_auth_user.result

  tags = {
    Name = "${local.resource_name_prefix}-pgweb-auth-user"
  }
}

resource "aws_ssm_parameter" "pgweb_auth_pass" {
  name  = "${var.ssm_secret_prefix}/pgweb_auth_pass"
  type  = "SecureString"
  value = random_password.pgweb_auth_pass.result

  tags = {
    Name = "${local.resource_name_prefix}-pgweb-auth-pass"
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
