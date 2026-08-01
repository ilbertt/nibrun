resource "aws_instance" "control_plane" {
  ami                    = data.aws_ssm_parameter.al2023_ami.value
  instance_type          = var.control_plane_instance_type
  subnet_id              = aws_subnet.app.id
  vpc_security_group_ids = [aws_security_group.control_plane.id]
  iam_instance_profile   = aws_iam_instance_profile.control_plane.name
  ipv6_address_count     = 1

  depends_on = [aws_route_table_association.app]

  user_data                   = templatefile("${path.module}/user_data_control_plane.sh.tftpl", {})
  user_data_replace_on_change = false

  root_block_device {
    volume_size = var.root_volume_size
    volume_type = "gp3"
    encrypted   = true

    tags = {
      Name = "${local.resource_name_prefix}-control-plane-root"
    }
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
    Name = "${local.resource_name_prefix}-control-plane"
    # The deploy workflow targets the instance by this tag.
    DeployGroup = local.control_plane_deploy_group
  }
}

# Stable public IP. Both the api hostname and the customer-app wildcard point
# here — see infra/README.md for the DNS records to create.
resource "aws_eip" "control_plane" {
  instance = aws_instance.control_plane.id
  domain   = "vpc"

  tags = {
    Name = "${local.resource_name_prefix}-control-plane-ip"
  }
}

# Persistent data volume, mounted at /data and holding Docker's data-root
# (Postgres and the gateway's certificate store). Lives independently of the
# instance so instance replacement can't take the data with it — unlike the root
# volume, which AWS deletes on termination.
resource "aws_ebs_volume" "control_plane_data" {
  availability_zone = local.availability_zone
  size              = var.control_plane_data_volume_size
  type              = "gp3"
  encrypted         = true

  tags = {
    Name = "${local.resource_name_prefix}-control-plane-data"
    # The DLM snapshot policy targets volumes by this tag.
    Backup = local.resource_name_prefix
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "control_plane_data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.control_plane_data.id
  instance_id = aws_instance.control_plane.id
}
