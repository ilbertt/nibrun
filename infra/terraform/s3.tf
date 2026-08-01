# --- Deploy bucket ---
#
# Holds the runtime bundles the deploy workflow uploads and the instances
# download (compose files, on-box scripts, the compiled agent binary), plus the
# nightly Postgres dumps. Account-id suffix for a globally unique name.
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
    filter {
      prefix = "bundles/"
    }
    expiration {
      days = 30
    }
  }

  rule {
    id     = "expire-old-backups"
    status = "Enabled"
    filter {
      prefix = "backups/"
    }
    expiration {
      days = 90
    }
  }
}

# --- Artifacts bucket ---
#
# The binaries users upload, which the api writes and compute hosts read when
# they start a guest. Separate from the deploy bucket: this one holds customer
# data and outlives any single deploy, so it is versioned and never
# force-destroyed.
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
