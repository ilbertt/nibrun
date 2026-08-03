# Static credentials rather than the instance role, because apps/api requires
# S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY outright (src/lib/env.ts) and throws
# on an empty value. Delete this user once the api falls back to the default AWS
# credential chain.

resource "aws_iam_user" "api" {
  name = "${local.resource_name_prefix}-api"

  tags = {
    Name = "${local.resource_name_prefix}-api"
  }
}

resource "aws_iam_access_key" "api" {
  user = aws_iam_user.api.name
}

data "aws_iam_policy_document" "api_s3" {
  # Kept as tight as the api can function with — this credential lives in a
  # container serving public traffic.
  statement {
    sid       = "ArtifactsObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/*"]
  }

  statement {
    sid       = "ArtifactsList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.artifacts.arn]
  }

  # Read-only on tenant filesystems, for export: it runs in the control plane and
  # pulls a copy of the app's data out of the disk image ZeroFS wrote.
  #
  # This is the tightest grant that works today, and today nothing reads it. It
  # will not be enough when export is built: a ZeroFS reader registers and renews
  # its own ephemeral checkpoint so the writer's GC cannot delete what it is
  # reading, so a strictly read-only grant fails at startup. Do not widen this to
  # a blanket write when that happens — either add an explicit Deny on the keys
  # holding tenant data, which keeps the guarantee structural, or copy the prefix
  # elsewhere and read the copy, which keeps this grant at nothing.
  #
  # On this user rather than on the instance role because export runs inside the
  # api, and the api reaches S3 with these static keys — which is the whole
  # reason the user exists. When the api falls back to the default credential
  # chain and this file goes away, the grant moves to aws_iam_role.instance.
  statement {
    sid       = "FilesystemsObjects"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.filesystems.arn}/*"]
  }

  statement {
    sid       = "FilesystemsList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.filesystems.arn]
  }
}

resource "aws_iam_user_policy" "api" {
  name   = "${local.resource_name_prefix}-api-s3"
  user   = aws_iam_user.api.name
  policy = data.aws_iam_policy_document.api_s3.json
}
