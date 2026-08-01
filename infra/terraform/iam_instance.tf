data "aws_iam_policy_document" "instance_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

# Shared by both fleets: read the runtime bundle and decrypt the SecureString
# parameters the deploy needs.
data "aws_iam_policy_document" "deploy_common" {
  statement {
    sid       = "BundleRead"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.deploy.arn, "${aws_s3_bucket.deploy.arn}/*"]
  }

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

# --- Control plane ---

resource "aws_iam_role" "control_plane" {
  name               = "${local.resource_name_prefix}-control-plane"
  assume_role_policy = data.aws_iam_policy_document.instance_assume.json

  tags = {
    Name = "${local.resource_name_prefix}-control-plane"
  }
}

# SSM Session Manager + SSM RunCommand agent connectivity.
resource "aws_iam_role_policy_attachment" "control_plane_ssm_core" {
  role       = aws_iam_role.control_plane.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "control_plane" {
  source_policy_documents = [data.aws_iam_policy_document.deploy_common.json]

  # The api owns the artifact lifecycle: it takes the upload and deletes it when
  # the app goes away. Hosts only ever read.
  statement {
    sid       = "ArtifactsReadWrite"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.artifacts.arn, "${aws_s3_bucket.artifacts.arn}/*"]
  }

  # Nightly pg_dumpall.
  statement {
    sid       = "BackupsWrite"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.deploy.arn}/backups/*"]
  }
}

resource "aws_iam_role_policy" "control_plane" {
  name   = "${local.resource_name_prefix}-control-plane"
  role   = aws_iam_role.control_plane.id
  policy = data.aws_iam_policy_document.control_plane.json
}

resource "aws_iam_instance_profile" "control_plane" {
  name = "${local.resource_name_prefix}-control-plane"
  role = aws_iam_role.control_plane.name

  tags = {
    Name = "${local.resource_name_prefix}-control-plane"
  }
}

# --- Compute hosts ---

resource "aws_iam_role" "host" {
  name               = "${local.resource_name_prefix}-host"
  assume_role_policy = data.aws_iam_policy_document.instance_assume.json

  tags = {
    Name = "${local.resource_name_prefix}-host"
  }
}

resource "aws_iam_role_policy_attachment" "host_ssm_core" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "host" {
  source_policy_documents = [data.aws_iam_policy_document.deploy_common.json]

  # Pull the uploaded binary for an app the control plane has scheduled here.
  # Read-only: a compromised guest must not be able to rewrite another
  # customer's artifact.
  statement {
    sid       = "ArtifactsRead"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.artifacts.arn, "${aws_s3_bucket.artifacts.arn}/*"]
  }
}

resource "aws_iam_role_policy" "host" {
  name   = "${local.resource_name_prefix}-host"
  role   = aws_iam_role.host.id
  policy = data.aws_iam_policy_document.host.json
}

resource "aws_iam_instance_profile" "host" {
  name = "${local.resource_name_prefix}-host"
  role = aws_iam_role.host.name

  tags = {
    Name = "${local.resource_name_prefix}-host"
  }
}
