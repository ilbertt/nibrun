data "aws_iam_policy_document" "instance_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "instance" {
  name               = "${local.resource_name_prefix}-instance"
  assume_role_policy = data.aws_iam_policy_document.instance_assume.json

  tags = {
    Name = "${local.resource_name_prefix}-instance"
  }
}

# SSM Session Manager + SSM RunCommand agent connectivity.
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "instance" {
  # Download the runtime bundle.
  statement {
    sid       = "DeployRead"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.deploy.arn, "${aws_s3_bucket.deploy.arn}/*"]
  }

  # Upload nightly pg_dump backups. Write-only: a compromised box must not be
  # able to read or delete the history it is appending to.
  statement {
    sid       = "BackupsWrite"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.backups.arn}/*"]
  }

  # The api owns the artifact lifecycle: it takes the upload and deletes it when
  # the app goes away.
  statement {
    sid       = "ArtifactsReadWrite"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.artifacts.arn, "${aws_s3_bucket.artifacts.arn}/*"]
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

resource "aws_iam_role_policy" "instance" {
  name   = "${local.resource_name_prefix}-instance"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.instance.json
}

resource "aws_iam_instance_profile" "instance" {
  name = "${local.resource_name_prefix}-instance"
  role = aws_iam_role.instance.name

  tags = {
    Name = "${local.resource_name_prefix}-instance"
  }
}
