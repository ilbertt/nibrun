# The public address for a tenant port that is not the HTTPS edge. A machine of
# its own because an address a tenant hands to its own users is published by
# definition, and publishing the app host's would put every app on it in front of
# one tenant's users.
#
# It forwards a range and is never told which app owns a port within it — that is
# already resolved by the agent's ruleset on the app host.

resource "aws_instance" "port_relay" {
  ami                    = data.aws_ssm_parameter.al2023_ami.value
  instance_type          = var.port_relay_instance_type
  subnet_id              = aws_subnet.app.id
  vpc_security_group_ids = [aws_security_group.port_relay.id]
  iam_instance_profile   = aws_iam_instance_profile.port_relay.name

  associate_public_ip_address = true

  # EC2 drops a forwarded packet whose source is not the instance. Postrouting
  # re-sources everything today, so this is for whatever is added later.
  source_dest_check = false

  # Replacing on change is why the port range is sized once for every slot:
  # widening it later takes this machine, and every connection on it, with it.
  user_data = templatefile("${path.module}/port_relay_user_data.sh.tftpl", {
    app_host_private_ip = aws_instance.app_host[0].private_ip
    tenant_port_first   = var.tenant_port_first
    tenant_port_last    = var.tenant_port_last
    log_ingest_url      = "http://${aws_instance.app.private_ip}:${var.log_ingest_port}"
  })
  user_data_replace_on_change = true

  root_block_device {
    volume_size = 8
    volume_type = "gp3"
    encrypted   = true
  }

  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  lifecycle {
    ignore_changes = [ami]

    # One, not "at least one": the range is forwarded to a single host, and a tenant's port is
    # 22000 + its slot, which every host numbers from 0 — so two hosts both hold 22005 and the
    # port carries nothing to tell them apart. A second host would take no tenant traffic at all
    # and nothing would say so, which is why this refuses the plan rather than a comment saying
    # not to. Widening the fleet means giving the ports a number unique across it first, and
    # editing this in the same change.
    precondition {
      condition     = var.app_host_count == 1
      error_message = "The port relay forwards the whole tenant port range to app_host[0], and a slot's port is host-local, so a second app host would hold ports nothing routes to. Give tenant ports a fleet-wide number before raising app_host_count."
    }
  }

  tags = {
    Name = "${local.resource_name_prefix}-port-relay"
  }
}

# Outlives the instance behind it, which is what makes moving the relay elsewhere
# invisible to the clients already using it.
resource "aws_eip" "port_relay" {
  instance = aws_instance.port_relay.id
  domain   = "vpc"

  tags = {
    Name = "${local.resource_name_prefix}-port-relay-public-ip"
  }
}

# The only group in this VPC open to the world, and the machine behind it holds
# nothing. Both protocols, because which one a tenant's port speaks is not
# nibrun's to know. IPv4 only: there is no address family translation between
# here and a guest, which has an IPv4 address and nothing else.
resource "aws_security_group" "port_relay" {
  name        = "${local.resource_name_prefix}-port-relay"
  description = "nibrun tenant port relay"
  vpc_id      = aws_vpc.app.id

  ingress {
    description = "Tenant ports, UDP"
    from_port   = var.tenant_port_first
    to_port     = var.tenant_port_last
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Tenant ports, TCP"
    from_port   = var.tenant_port_first
    to_port     = var.tenant_port_last
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # No inbound SSH: shell access is via SSM Session Manager.

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.resource_name_prefix}-port-relay"
  }
}

resource "aws_iam_role" "port_relay" {
  name               = "${local.resource_name_prefix}-port-relay"
  assume_role_policy = data.aws_iam_policy_document.instance_assume.json

  tags = {
    Name = "${local.resource_name_prefix}-port-relay"
  }
}

# SSM only: no bucket to read, no secret to hold. It is how there is a way in
# without an inbound rule for one.
resource "aws_iam_role_policy_attachment" "port_relay_ssm_core" {
  role       = aws_iam_role.port_relay.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "port_relay" {
  name = "${local.resource_name_prefix}-port-relay"
  role = aws_iam_role.port_relay.name
}
