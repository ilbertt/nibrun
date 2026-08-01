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
  # Scoped to the artifacts bucket and nothing else — this credential lives in a
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
}

resource "aws_iam_user_policy" "api" {
  name   = "${local.resource_name_prefix}-api-s3"
  user   = aws_iam_user.api.name
  policy = data.aws_iam_policy_document.api_s3.json
}
