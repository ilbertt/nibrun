data "aws_ssm_parameter" "ubuntu_2404_ami" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

# Commission separately: the legacy deploy starts the shared ZeroFS writer, and
# a second writer against that prefix fences the machine serving existing apps.
resource "aws_instance" "nibrunner_host" {
  ami                    = data.aws_ssm_parameter.ubuntu_2404_ami.value
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

resource "aws_iam_instance_profile" "nibrunner_host" {
  name = "${local.resource_name_prefix}-nibrunner-host"
  role = aws_iam_role.nibrunner_host.name
}

output "nibrunner_host_instance_id" {
  description = "SSM target for commissioning nibrunner before admitting app deployments."
  value       = aws_instance.nibrunner_host.id
}
