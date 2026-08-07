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

# A binary is uploaded straight here over a URL the api signs, landing under
# uploads/ until the api has read it back, hashed it and copied it to the key its
# digest names. The staging copy is deleted the moment that is done — this is for
# the ones where it never happens: an upload nobody registers is bytes no row will
# ever name, and without a rule they would sit here at full size forever.
#
# Scoped to the prefix, because everything outside it is what users deployed.
#
# Noncurrent versions too: the bucket is versioned, so deleting a staging object
# leaves the object behind under a delete marker, and expiring only the current
# version would keep exactly what this is meant to remove.
resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "expire-staged-uploads"
    status = "Enabled"
    filter {
      prefix = "uploads/"
    }
    expiration {
      days = 1
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  # Every key, not just the staged ones: the api copies a verified binary to the key its digest
  # names, in parts, and a copy that fails part way leaves those parts holding storage under a
  # key that lists nothing. Unfiltered so that a prefix added later cannot be the one this was
  # forgotten on.
  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# --- Tenant filesystems ---
#
# ZeroFS's backing store. Deliberately not a prefix inside artifacts.
#
# **A prefix here is one host, not one app.** v1 runs a single ZeroFS per app
# host, so every tenant placed on that host shares its prefix — see the topology
# note in `apps/agent/src/volumes/topology.ts`. Deleting one app is removing its
# device file from inside that filesystem, which is what the agent's volume
# teardown does. Deleting the prefix destroys every tenant on the host.
#
# Versioning is why it cannot share with artifacts: artifacts has it enabled,
# and ZeroFS's GC deletes dead segments continuously, so on a versioned bucket
# every delete would become a delete marker with the object retained — storage
# growing without bound while the GC reports reclaiming space. Never enable
# versioning here.
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

# --- Exports ---
#
# The downloadable copies of an app, written by the host that owns the volume and
# read only through a presigned URL the api signs.
#
# The expiry is a security requirement rather than housekeeping: a bundle carries
# the tenant's environment variables and their entire dataset, so it must stop
# existing rather than sit here indefinitely. It is a bucket rule and not a
# per-object one on purpose — a rule cannot be forgotten on the one object that
# mattered.
#
# No versioning, for the same reason. A version of an expired export is an
# expired export that still exists.
resource "aws_s3_bucket" "exports" {
  bucket = "${local.resource_name_prefix}-exports-${var.region}"

  tags = {
    Name = "${local.resource_name_prefix}-exports"
  }
}

resource "aws_s3_bucket_public_access_block" "exports" {
  bucket                  = aws_s3_bucket.exports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "exports" {
  bucket = aws_s3_bucket.exports.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "exports" {
  bucket = aws_s3_bucket.exports.id

  rule {
    id     = "expire-exports"
    status = "Enabled"
    filter {}
    expiration {
      days = var.export_retention_days
    }

    # A bundle abandoned part-way through still holds tenant data, and an
    # incomplete upload is invisible to the expiry rule above.
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}
