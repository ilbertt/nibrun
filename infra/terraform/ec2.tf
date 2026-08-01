resource "aws_instance" "app" {
  ami                    = data.aws_ssm_parameter.al2023_ami.value
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.app.id
  vpc_security_group_ids = [aws_security_group.instance.id]
  iam_instance_profile   = aws_iam_instance_profile.instance.name
  ipv6_address_count     = 1

  depends_on = [aws_route_table_association.app]

  user_data                   = templatefile("${path.module}/user_data.sh.tftpl", {})
  user_data_replace_on_change = false

  root_block_device {
    volume_size = var.root_volume_size
    volume_type = "gp3"
    encrypted   = true

    # Nested block tags are the one place default_tags has historically not
    # reached, so merge them in rather than rely on provider behaviour.
    tags = merge(local.common_tags, {
      Name = "${local.resource_name_prefix}-root"
    })
  }

  metadata_options {
    http_tokens   = "required" # IMDSv2 only
    http_endpoint = "enabled"
    # Two hops so containers on the bridge network can reach IMDS: the api uses
    # the instance role for the artifacts bucket, and pg-backup uses it to
    # upload dumps.
    http_put_response_hop_limit = 2
  }

  lifecycle {
    ignore_changes = [ami]
  }

  tags = {
    Name = local.resource_name_prefix
    # The deploy workflow targets the instance by this tag.
    DeployGroup = local.resource_name_prefix
  }
}

# Stable public IP — point the hostname's A record at this.
resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"

  tags = {
    Name = "${local.resource_name_prefix}-public-ip"
  }
}
