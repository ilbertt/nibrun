# The app host's own role, separate from the control plane's (iam_instance.tf)
# because the two machine classes want opposite grants on the same buckets: this
# one writes tenant filesystems and only reads artifacts, and the control plane
# is the other way round.
#
# ZeroFS resolves AWS credentials through the default chain, so this role is all
# it needs — no static keys are provisioned for it, unlike the api (iam_api.tf).
resource "aws_iam_role" "app_host" {
  name               = "${local.resource_name_prefix}-app-host"
  assume_role_policy = data.aws_iam_policy_document.instance_assume.json

  tags = {
    Name = "${local.resource_name_prefix}-app-host"
  }
}

# SSM Session Manager + SSM RunCommand agent connectivity. Both are outbound
# from the host, which is why the security group needs no inbound rule for
# shell access or for deploys.
resource "aws_iam_role_policy_attachment" "app_host_ssm_core" {
  role       = aws_iam_role.app_host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "app_host" {
  # ZeroFS's backing store, and the only bucket this role writes. Multipart is
  # explicit because ZeroFS uploads segments that way and cannot clean up after
  # a failed upload without the abort.
  statement {
    sid = "FilesystemsWrite"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
    ]
    resources = ["${aws_s3_bucket.filesystems.arn}/*"]
  }

  statement {
    sid       = "FilesystemsList"
    actions   = ["s3:ListBucket", "s3:ListBucketMultipartUploads"]
    resources = [aws_s3_bucket.filesystems.arn]
  }

  # Tenant binaries, read-only: the host boots them, the api is what uploads
  # them, so a compromised host cannot rewrite the artifact another host runs.
  statement {
    sid       = "ArtifactsRead"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.artifacts.arn, "${aws_s3_bucket.artifacts.arn}/*"]
  }

  # The pinned guest image, and this host's own deploy bundle.
  statement {
    sid       = "GuestImagesRead"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.guest_images.arn, "${aws_s3_bucket.guest_images.arn}/*"]
  }

  statement {
    sid       = "DeployRead"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.deploy.arn, "${aws_s3_bucket.deploy.arn}/*"]
  }

  # The host writes the export itself, because it is the only party with the
  # tenant's device attached. Write-only: a host has no reason to read back a
  # bundle it produced, and the api is what serves them.
  statement {
    sid       = "ExportsWrite"
    actions   = ["s3:PutObject", "s3:AbortMultipartUpload"]
    resources = ["${aws_s3_bucket.exports.arn}/*"]
  }

  # Read deployment secrets.
  statement {
    sid       = "SsmRead"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["${local.ssm_param_arn_prefix}/*"]
  }

  # Decrypt SecureString parameters (default aws/ssm KMS key) — scoped to SSM.
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

resource "aws_iam_role_policy" "app_host" {
  name   = "${local.resource_name_prefix}-app-host"
  role   = aws_iam_role.app_host.id
  policy = data.aws_iam_policy_document.app_host.json
}

resource "aws_iam_instance_profile" "app_host" {
  name = "${local.resource_name_prefix}-app-host"
  role = aws_iam_role.app_host.name

  tags = {
    Name = "${local.resource_name_prefix}-app-host"
  }
}
