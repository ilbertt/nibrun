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

  # No access to tenant filesystems at all, deliberately. The host that owns a
  # volume writes the export itself — it has the device attached already, so it
  # reads one tenant's filesystem and no other, in userspace and without mounting
  # it. Anything here would be access to tenant data that nothing needs.
  #
  # Read on the exports bucket is what lets the api sign a download URL: a
  # presigned URL carries the signer's own permissions, so it cannot grant a read
  # this policy does not.
  statement {
    sid       = "ExportsRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.exports.arn}/*"]
  }
}

resource "aws_iam_user_policy" "api" {
  name   = "${local.resource_name_prefix}-api-s3"
  user   = aws_iam_user.api.name
  policy = data.aws_iam_policy_document.api_s3.json
}
