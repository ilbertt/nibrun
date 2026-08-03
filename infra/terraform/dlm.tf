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
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

# Block-level counterpart to pg-backup's nightly logical dump, and the only
# backup anything on the control plane's volume other than Postgres has. Tag-
# driven, so an app host's cache volume opts in by carrying the same tag.
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
