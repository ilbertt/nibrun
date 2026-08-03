locals {
  # Its own group, because an app host runs none of the control plane's software
  # and the deploy has to be able to target the two classes separately.
  app_host_deploy_group = "${local.resource_name_prefix}-app-host"
}

# The second machine class: no compose stack, and no Docker at all. The agent
# manipulates host networking and spawns microVMs, so containerising it would
# hand back every privilege the container removes.
#
# Terraform does not provision these dynamically — the fleet size is
# var.app_host_count and scaling is changing it. The api holds no EC2
# permissions on purpose: ec2:RunInstances plus iam:PassRole on a public-facing
# service is not an acceptable risk at this stage.
resource "aws_instance" "app_host" {
  count = var.app_host_count

  ami                    = data.aws_ssm_parameter.al2023_ami.value
  instance_type          = var.app_host_instance_type
  subnet_id              = aws_subnet.app.id
  vpc_security_group_ids = [aws_security_group.app_host.id]
  iam_instance_profile   = aws_iam_instance_profile.app_host.name

  # A public address with no inbound rule costs nothing in exposure and buys
  # outbound reach through the internet gateway, so bootstrap installs packages
  # and fetches binaries the ordinary way instead of everything being mirrored
  # into S3 first. No NAT gateway: NAT is for tenant egress, and no tenant app
  # runs in this phase.
  #
  # Both families, because the wildcard record the user-app proxy needs carries an
  # A and an AAAA — and both have to survive a replacement, which happens whenever
  # the bootstrap changes. A specific address rather than a count: an auto-assigned
  # one is drawn fresh each time and would leave the AAAA pointing at a host that
  # no longer exists. The elastic IP below does the same job for v4, which has no
  # equivalent because an elastic address is IPv4-only.
  associate_public_ip_address = true
  ipv6_addresses              = [cidrhost(aws_subnet.app.ipv6_cidr_block, count.index + 1)]

  # Without this the CPU exposes no VMX, kvm_intel refuses to load, and the
  # bootstrap deliberately dies before writing its marker. It is a launch-time
  # option, so turning it on replaces the instance — which is why it has to be
  # right here rather than fixed on a running host.
  cpu_options {
    nested_virtualization = "enabled"
  }

  depends_on = [aws_route_table_association.app]

  # cloud-init runs user_data once per instance and records it in sem/, so a
  # stop/start never re-runs it. Editing the bootstrap therefore reaches an
  # existing host only by replacing it — and a host whose bootstrap failed can
  # be fixed no other way, because the marker it never wrote is the thing the
  # deploy waits for.
  user_data                   = templatefile("${path.module}/app_host_user_data.sh.tftpl", {})
  user_data_replace_on_change = true

  root_block_device {
    volume_size = var.app_host_root_volume_size
    volume_type = "gp3"
    encrypted   = true

    tags = merge(local.common_tags, {
      Name = "${local.resource_name_prefix}-app-host-${count.index}-root"
    })
  }

  metadata_options {
    http_tokens   = "required" # IMDSv2 only
    http_endpoint = "enabled"
    # One hop, unlike the control plane. A tenant microVM sits behind a tap
    # device, so its packets reach IMDS forwarded by the host kernel with the
    # hop already spent — which is what stops a guest minting this role's
    # credentials. Nothing here runs in a container, so no workload of ours
    # needs the second hop.
    http_put_response_hop_limit = 1
  }

  lifecycle {
    ignore_changes = [ami]
  }

  tags = {
    Name        = "${local.resource_name_prefix}-app-host-${count.index}"
    DeployGroup = local.app_host_deploy_group
  }
}

# What the app domain's wildcard A record points at. Unlike the instance's own
# public address it outlives a replacement, so the record is written once rather
# than chased every time the bootstrap changes.
resource "aws_eip" "app_host" {
  count = var.app_host_count

  instance = aws_instance.app_host[count.index].id
  domain   = "vpc"

  tags = {
    Name = "${local.resource_name_prefix}-app-host-${count.index}-public-ip"
  }
}

# ZeroFS's local cache, mounted at /data. Not where tenant data lives — S3 is
# the source of truth and a host can be rebuilt from it — so the snapshots this
# picks up are about bringing a replacement host back warm rather than about
# durability, and prevent_destroy is about a plan never pulling a disk out from
# under running microVMs.
#
# prevent_destroy under count applies to every element, which makes scaling
# *down* a two-step operation rather than a decrement: lowering
# var.app_host_count makes Terraform plan a destroy of the highest-index volume,
# and prevent_destroy turns that into a hard plan error rather than a warning.
# Drain the host, remove its volume and attachment from state (and delete the
# volume by hand), then lower the count.
resource "aws_ebs_volume" "app_host_data" {
  count = var.app_host_count

  availability_zone = local.availability_zone
  size              = var.app_host_data_volume_size
  type              = "gp3"
  encrypted         = true

  tags = {
    Name = "${local.resource_name_prefix}-app-host-${count.index}-data"
    # The DLM snapshot policy targets volumes by this tag.
    Backup = local.resource_name_prefix
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "app_host_data" {
  count = var.app_host_count

  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.app_host_data[count.index].id
  instance_id = aws_instance.app_host[count.index].id
}
