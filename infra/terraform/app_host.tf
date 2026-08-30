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
  # An address in each family, but only the elastic one below is ever published:
  # Cloudflare is the origin's only client and serves visitors over IPv6 from its
  # own edge, so nothing here needs a stable IPv6. This one is for egress, and it
  # is drawn fresh on every launch, which is fine because nothing points at it.
  associate_public_ip_address = true
  ipv6_address_count          = 1

  # Without this the CPU exposes no VMX, kvm_intel refuses to load, and the
  # bootstrap deliberately dies before writing its marker. It is a launch-time
  # option, so turning it on replaces the instance — which is why it has to be
  # right here rather than fixed on a running host.
  cpu_options {
    nested_virtualization = "enabled"
  }

  # A persistent request rather than the default one-time one: a one-time request
  # is not re-placed after an interruption, so the host would stop and simply stay
  # stopped. There is no max_price, which means the on-demand price is the cap —
  # bidding under it buys nothing but a second way to be interrupted.
  #
  # Adding or removing this block replaces the instance. A running on-demand host
  # cannot be converted to a spot one, so turning var.app_host_spot on or off is a
  # rebuild, with every tenant microVM on it going down for the length of one boot.
  dynamic "instance_market_options" {
    for_each = var.app_host_spot ? [1] : []

    content {
      market_type = "spot"

      spot_options {
        instance_interruption_behavior = "stop"
        spot_instance_type             = "persistent"
      }
    }
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

    # Checked here rather than in a variable validation, which cannot read a data
    # source and so cannot ask AWS what a type actually has.
    precondition {
      condition     = data.aws_ec2_instance_type.app_host.instance_storage_supported
      error_message = "app_host_instance_type must name a type with an instance store: /data is mounted from it and ZeroFS does not start without it. The `d` families — m8id, r8id, c8id — have one; m7i and m8i do not."
    }
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
