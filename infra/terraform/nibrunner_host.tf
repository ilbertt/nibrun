data "aws_ssm_parameter" "ubuntu_2604_ami" {
  name = "/aws/service/canonical/ubuntu/server/26.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

# Commission separately: the legacy deploy starts the shared ZeroFS writer, and
# a second writer against that prefix fences the machine serving existing apps.
resource "aws_instance" "nibrunner_host" {
  ami                    = data.aws_ssm_parameter.ubuntu_2604_ami.value
  instance_type          = "r8id.xlarge"
  subnet_id              = aws_subnet.app.id
  vpc_security_group_ids = [aws_security_group.nibrunner_host.id]
  iam_instance_profile   = aws_iam_instance_profile.nibrunner_host.name

  associate_public_ip_address = true
  ipv6_address_count          = 1

  cpu_options {
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
  name        = "${local.resource_name_prefix}-nibrunner-host"
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

resource "aws_ssm_parameter" "nibrunner_origin_tls_cert" {
  name  = "${var.ssm_secret_prefix}/nibrunner_origin_tls_cert"
  type  = "SecureString"
  value = base64encode(cloudflare_origin_ca_certificate.nibrunner.certificate)

  tags = {
    Name = "${local.resource_name_prefix}-nibrunner-origin-tls-cert"
  }
}

resource "aws_ssm_parameter" "nibrunner_origin_tls_key" {
  name  = "${var.ssm_secret_prefix}/nibrunner_origin_tls_key"
  type  = "SecureString"
  value = base64encode(tls_private_key.nibrunner.private_key_pem_pkcs8)

  # Failed issuance must leave the existing certificate/key pair in SSM intact.
  depends_on = [cloudflare_origin_ca_certificate.nibrunner]

  tags = {
    Name = "${local.resource_name_prefix}-nibrunner-origin-tls-key"
  }
}

output "nibrunner_origin_tls_cert_parameter" {
  value = aws_ssm_parameter.nibrunner_origin_tls_cert.name
}

output "nibrunner_origin_tls_key_parameter" {
  value = aws_ssm_parameter.nibrunner_origin_tls_key.name
}

output "nibrunner_host_instance_id" {
  description = "SSM target for commissioning nibrunner before admitting app deployments."
  value       = aws_instance.nibrunner_host.id
}
