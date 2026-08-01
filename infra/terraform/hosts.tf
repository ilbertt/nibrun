resource "aws_instance" "host" {
  count = var.host_count

  ami                    = data.aws_ssm_parameter.al2023_ami.value
  instance_type          = var.host_instance_type
  subnet_id              = aws_subnet.app.id
  vpc_security_group_ids = [aws_security_group.host.id]
  iam_instance_profile   = aws_iam_instance_profile.host.name

  depends_on = [aws_route_table_association.app]

  # Prerequisites only. The agent binary, its unit and its env file are
  # delivered by the deploy, so a change here must never silently recreate a
  # host that is running customer workloads.
  user_data                   = templatefile("${path.module}/user_data_host.sh.tftpl", {})
  user_data_replace_on_change = false

  root_block_device {
    volume_size = var.root_volume_size
    volume_type = "gp3"
    encrypted   = true

    tags = {
      Name = "${local.resource_name_prefix}-host-${count.index}-root"
    }
  }

  metadata_options {
    http_tokens                 = "required" # IMDSv2 only
    http_endpoint               = "enabled"
    http_put_response_hop_limit = 2
  }

  lifecycle {
    ignore_changes = [ami]
  }

  tags = {
    Name = "${local.resource_name_prefix}-host-${count.index}"
    # The deploy workflow fans the agent rollout out across every instance
    # carrying this tag.
    DeployGroup = local.host_deploy_group
  }
}

# One persistent volume per host, holding the per-app directories the agent
# mounts into each guest at data/. Detached from the instance lifecycle so
# replacing a host does not destroy the apps' data.
resource "aws_ebs_volume" "host_data" {
  count = var.host_count

  availability_zone = local.availability_zone
  size              = var.host_data_volume_size
  type              = "gp3"
  encrypted         = true

  tags = {
    Name   = "${local.resource_name_prefix}-host-${count.index}-data"
    Backup = local.resource_name_prefix
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "host_data" {
  count = var.host_count

  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.host_data[count.index].id
  instance_id = aws_instance.host[count.index].id
}
