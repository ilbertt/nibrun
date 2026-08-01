data "aws_iam_policy_document" "dlm_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["dlm.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "dlm" {
  name               = "${local.resource_name_prefix}-dlm"
  assume_role_policy = data.aws_iam_policy_document.dlm_assume.json

  tags = {
    Name = "${local.resource_name_prefix}-dlm"
  }
}

resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/AWSDataLifecycleManagerServiceRole"
}

# Covers the control-plane volume and every host volume — they all carry the
# same Backup tag. Postgres also gets a nightly logical dump to S3 (pg-backup);
# these snapshots are the block-level counterpart and the only backup customer
# app data has.
resource "aws_dlm_lifecycle_policy" "data" {
  description        = "Daily snapshots of the nibrun data volumes"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  tags = {
    Name = "${local.resource_name_prefix}-data-snapshots"
  }

  policy_details {
    resource_types = ["VOLUME"]
    target_tags = {
      Backup = local.resource_name_prefix
    }

    schedule {
      name      = "daily-keep-14"
      copy_tags = true

      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["03:00"]
      }

      retain_rule {
        count = 14
      }
    }
  }
}
