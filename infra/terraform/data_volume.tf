# Persistent data volume, mounted at /data and holding Docker's data-root
# (Postgres). Lives independently of the instance so instance replacement can't
# take the data with it — unlike the root volume, which AWS deletes on
# termination.
resource "aws_ebs_volume" "data" {
  availability_zone = local.availability_zone
  size              = var.data_volume_size
  type              = "gp3"
  encrypted         = true

  tags = {
    Name = "${local.resource_name_prefix}-data"
    # The DLM snapshot policy targets volumes by this tag.
    Backup = local.resource_name_prefix
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.app.id
}
