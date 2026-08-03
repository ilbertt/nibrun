# A bucket per lifecycle rather than one with prefix-scoped rules: each has its
# own retention, its own access pattern and its own set of principals, and each
# feeds exactly one config value, so no name is ever rewritten on the way to the
# box.
#
# Region suffix because the S3 namespace is global while a bucket is not: AWS
# holds a deleted name for up to hours, so an unqualified name collides with the
# one the previous region just released.

# --- Deploy bundles ---
#
# The runtime bundle CI uploads and the instance downloads (compose files,
# on-box scripts). Disposable — every deploy writes a new one.
resource "aws_s3_bucket" "deploy" {
  bucket        = "${local.resource_name_prefix}-deploy-${var.region}"
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
  bucket = "${local.resource_name_prefix}-backups-${var.region}"

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
# The binaries users upload. Customer data that outlives any single deploy, so
# it is versioned and never force-destroyed.
resource "aws_s3_bucket" "artifacts" {
  bucket = "${local.resource_name_prefix}-artifacts-${var.region}"

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

# --- Tenant filesystems ---
#
# ZeroFS's backing store: one prefix per app, holding the segments that make up
# that app's disk. Deliberately not a prefix inside artifacts.
#
# Versioning is why it cannot share: artifacts has it enabled, and ZeroFS's GC
# deletes dead segments continuously, so on a versioned bucket every delete
# would become a delete marker with the object retained — storage growing
# without bound while the GC reports reclaiming space. Never enable versioning
# here. The access patterns are opposite too, and deleting an app means
# bulk-deleting a prefix, which should happen nowhere near users' binaries.
#
# Never put a lifecycle expiry on this bucket either. It holds live data: the
# host's local disk is the cache, and this is what it is a cache of.
resource "aws_s3_bucket" "filesystems" {
  bucket = "${local.resource_name_prefix}-filesystems-${var.region}"

  tags = {
    Name = "${local.resource_name_prefix}-filesystems"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "filesystems" {
  bucket                  = aws_s3_bucket.filesystems.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "filesystems" {
  bucket = aws_s3_bucket.filesystems.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# --- Guest images ---
#
# The kernel and rootfs app hosts boot microVMs from, pinned by version and
# fetched once per host. Not the deploy bucket, which carries a 30-day expiry
# and force_destroy — right for a bundle regenerated on every push, and actively
# wrong for an image a fleet stays pinned to for months. Not a prefix inside
# artifacts either: CI writes here, and CI must never hold write access to the
# bucket holding users' binaries.
resource "aws_s3_bucket" "guest_images" {
  bucket = "${local.resource_name_prefix}-guest-images-${var.region}"

  tags = {
    Name = "${local.resource_name_prefix}-guest-images"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "guest_images" {
  bucket                  = aws_s3_bucket.guest_images.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "guest_images" {
  bucket = aws_s3_bucket.guest_images.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
