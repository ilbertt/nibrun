# --- GitHub Actions OIDC: scoped role for the APP deploy workflow ---
#
# The OIDC provider itself and the privileged Terraform role are created by the
# one-time CloudFormation bootstrap (infra/bootstrap/), so here we only look the
# provider up and create the narrowly-scoped role the CD workflow uses.

data "aws_iam_openid_connect_provider" "github" {
  count = var.enable_github_deploy ? 1 : 0
  url   = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_assume" {
  count = var.enable_github_deploy ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github[0].arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:ref:refs/heads/${var.github_branch}"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  count = var.enable_github_deploy ? 1 : 0

  name               = "${local.resource_name_prefix}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_assume[0].json

  tags = {
    Name = "${local.resource_name_prefix}-github-deploy"
  }
}

data "aws_iam_policy_document" "github_deploy" {
  count = var.enable_github_deploy ? 1 : 0

  # Upload the runtime bundle.
  statement {
    sid       = "BundleWrite"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.deploy.arn, "${aws_s3_bucket.deploy.arn}/*"]
  }

  # Find the target instance behind the deploy tag.
  statement {
    sid       = "Ec2Describe"
    actions   = ["ec2:DescribeInstances"]
    resources = ["*"]
  }

  # Trigger the deploy on the instance and read command status.
  statement {
    sid       = "SsmSend"
    actions   = ["ssm:SendCommand"]
    resources = ["*"]
  }
  statement {
    sid       = "SsmStatus"
    actions   = ["ssm:DescribeInstanceInformation", "ssm:GetCommandInvocation", "ssm:ListCommandInvocations", "ssm:ListCommands"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  count = var.enable_github_deploy ? 1 : 0

  name   = "${local.resource_name_prefix}-github-deploy"
  role   = aws_iam_role.github_deploy[0].id
  policy = data.aws_iam_policy_document.github_deploy[0].json
}

# --- GitHub Actions OIDC: read-only role for the PLAN check on pull requests ---
#
# A separate role because a pull_request run presents a different subject than a
# push to main, so neither the bootstrap Terraform role nor the deploy role above
# can be assumed from a PR.

data "aws_iam_policy_document" "github_plan_assume" {
  count = var.enable_github_deploy ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github[0].arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Pull requests from forks get no token at all, so this is branches in this
    # repository only.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:pull_request"]
    }
  }
}

resource "aws_iam_role" "github_plan" {
  count = var.enable_github_deploy ? 1 : 0

  name               = "${local.resource_name_prefix}-github-plan"
  assume_role_policy = data.aws_iam_policy_document.github_plan_assume[0].json

  tags = {
    Name = "${local.resource_name_prefix}-github-plan"
  }
}

# A plan refreshes every resource, so it needs broad read and nothing else. It
# runs with -lock=false, which is why no write to the state bucket is granted.
resource "aws_iam_role_policy_attachment" "github_plan_read" {
  count = var.enable_github_deploy ? 1 : 0

  role       = aws_iam_role.github_plan[0].name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# ReadOnlyAccess deliberately omits kms:Decrypt, without which refreshing a
# SecureString parameter fails.
data "aws_iam_policy_document" "github_plan" {
  count = var.enable_github_deploy ? 1 : 0

  statement {
    sid       = "KmsDecryptViaSsm"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${data.aws_region.current.name}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "github_plan" {
  count = var.enable_github_deploy ? 1 : 0

  name   = "${local.resource_name_prefix}-github-plan"
  role   = aws_iam_role.github_plan[0].id
  policy = data.aws_iam_policy_document.github_plan[0].json
}
