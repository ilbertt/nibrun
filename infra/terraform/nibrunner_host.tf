data "aws_ssm_parameter" "ubuntu_2604_ami" {
  name = "/aws/service/canonical/ubuntu/server/26.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

data "aws_ec2_instance_type" "nibrunner_host" {
  instance_type = "r8id.xlarge"
}

# Keep this engine separate: the legacy deploy starts the shared ZeroFS writer,
# and a second writer against that prefix fences the machine serving existing apps.
resource "aws_instance" "nibrunner_host" {
  ami                    = data.aws_ssm_parameter.ubuntu_2604_ami.value
  instance_type          = data.aws_ec2_instance_type.nibrunner_host.instance_type
  subnet_id              = aws_subnet.app.id
  vpc_security_group_ids = [aws_security_group.nibrunner_host.id]
  iam_instance_profile   = aws_iam_instance_profile.nibrunner_host.name

  associate_public_ip_address = true
  ipv6_address_count          = 1

  cpu_options {
    core_count            = data.aws_ec2_instance_type.nibrunner_host.default_cores
    threads_per_core      = 1
    nested_virtualization = "enabled"
  }

  root_block_device {
    volume_size = 50
    volume_type = "gp3"
    encrypted   = true

    tags = merge(local.common_tags, {
      Name = "${local.resource_name_prefix}-nibrunner-host-root"
    })
  }

  metadata_options {
    http_tokens                 = "required"
    http_endpoint               = "enabled"
    http_put_response_hop_limit = 1
  }

  lifecycle {
    ignore_changes = [ami]
  }

  depends_on = [
    aws_route_table_association.app,
    aws_iam_role_policy_attachment.nibrunner_host_ssm_core,
  ]

  tags = {
    Name = "${local.resource_name_prefix}-nibrunner-host"
  }
}

resource "aws_security_group" "nibrunner_host" {
  name = "${local.resource_name_prefix}-nibrunner-host"
  # Changing this deployed description would replace the security group.
  description = "nibrunner commissioning host; SSM access only"
  vpc_id      = aws_vpc.app.id

  ingress = []

  egress {
    description      = "All outbound"
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name = "${local.resource_name_prefix}-nibrunner-host"
  }
}

resource "aws_iam_role" "nibrunner_host" {
  name               = "${local.resource_name_prefix}-nibrunner-host"
  assume_role_policy = data.aws_iam_policy_document.instance_assume.json
}

resource "aws_iam_role_policy_attachment" "nibrunner_host_ssm_core" {
  role       = aws_iam_role.nibrunner_host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "nibrunner_host" {
  statement {
    sid       = "TunnelTokenRead"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.nibrunner_cloudflared_token.arn]
  }

  statement {
    sid       = "TunnelTokenDecryptViaSsm"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${data.aws_region.current.region}.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:PARAMETER_ARN"
      values   = [aws_ssm_parameter.nibrunner_cloudflared_token.arn]
    }
  }

  statement {
    sid       = "AgentBinaryRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.deploy.arn}/agent/*"]
  }

  statement {
    sid       = "GuestImageRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.deploy.arn}/nibrunner-guest/*"]
  }

  statement {
    sid       = "ArtifactsRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/*"]
  }

  statement {
    sid       = "ImportsRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.imports.arn}/*"]
  }
}

resource "aws_iam_role_policy" "nibrunner_host" {
  name   = "${local.resource_name_prefix}-nibrunner-host"
  role   = aws_iam_role.nibrunner_host.id
  policy = data.aws_iam_policy_document.nibrunner_host.json
}

resource "aws_iam_instance_profile" "nibrunner_host" {
  name = "${local.resource_name_prefix}-nibrunner-host"
  role = aws_iam_role.nibrunner_host.name
}

output "nibrunner_host_instance_id" {
  description = "SSM deployment target for the nibrunner engine and its control-plane bridge."
  value       = aws_instance.nibrunner_host.id
}
