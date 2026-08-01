# Three buckets rather than one with prefix-scoped rules: each has a different
# lifecycle, and each feeds exactly one config value, so no name is ever
# rewritten on the way to the box. Account-id suffix for globally unique names.

# --- Deploy bundles ---
#
# The runtime bundle CI uploads and the instance downloads (compose files,
# on-box scripts). Disposable — every deploy writes a new one.
resource "aws_s3_bucket" "deploy" {
  bucket        = "nibrun-deploy-${data.aws_caller_identity.current.account_id}"
  force_destroy = true

  tags = {
    Name = "${local.resource_name_prefix}-deploy"
  }
}

resource "aws_s3_bucket_public_access_block" "deploy" {
  bucket                  = aws_s3_bucket.deploy.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "deploy" {
  bucket = aws_s3_bucket.deploy.id

  rule {
    id     = "expire-old-bundles"
    status = "Enabled"
    filter {}
    expiration {
      days = 30
    }
  }
}

# --- Postgres dumps ---
#
# Written nightly by the pg-backup sidecar. Longer retention than the bundles,
# and never force-destroyed.
resource "aws_s3_bucket" "backups" {
  bucket = "nibrun-backups-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "${local.resource_name_prefix}-backups"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "expire-old-backups"
    status = "Enabled"
    filter {}
    expiration {
      days = 90
    }
  }
}

# --- Artifacts ---
#
# The binaries users upload. Holds customer data and outlives any single deploy,
# so it is versioned and never force-destroyed.
resource "aws_s3_bucket" "artifacts" {
  bucket = "nibrun-artifacts-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "${local.resource_name_prefix}-artifacts"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
