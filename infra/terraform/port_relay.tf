# The public address for a tenant port that is not the HTTPS edge, and the only
# reason it is a machine of its own: an address a tenant hands to its own users
# is published by definition, so publishing the app host's would put every app on
# that host in front of one tenant's users. A flood aimed here ends here.
#
# What a tenant does with its port is not modelled and is not this machine's
# business. It forwards a range, and which app a port within it belongs to is
# resolved by the agent's ruleset on the app host — so nothing here is ever told
# about an app, and adding one changes nothing on this box.
#
# Counted rather than conditional, and zero by default: there is nothing to
# forward until an app can ask for a port, so this creates no machine until
# somebody turns it on.

resource "aws_instance" "port_relay" {
  count = var.port_relay_count

  ami                    = data.aws_ssm_parameter.al2023_ami.value
  instance_type          = var.port_relay_instance_type
  subnet_id              = aws_subnet.app.id
  vpc_security_group_ids = [aws_security_group.port_relay[0].id]
  iam_instance_profile   = aws_iam_instance_profile.port_relay[0].name

  # Sized by network baseline rather than by CPU: forwarding is kernel work and
  # costs a fraction of a vCPU, while what crosses it is whatever the tenants
  # behind it send. Burstable is deliberate — a flood exhausting the network
  # credits degrades this box to its baseline, which is the behaviour wanted from
  # the machine whose job is to be the one attacked.
  associate_public_ip_address = true

  # Every packet leaving here is re-sourced onto this instance by the postrouting
  # rule, so the check would pass as things stand. Off regardless: a rule added
  # later that forwards without re-sourcing would be dropped by EC2 rather than by
  # anything in the ruleset, and a silent drop is the worst way to find that out.
  source_dest_check = false

  user_data = templatefile("${path.module}/port_relay_user_data.sh.tftpl", {
    app_host_private_ip = aws_instance.app_host[0].private_ip
    tenant_port_first   = var.tenant_port_first
    tenant_port_last    = var.tenant_port_last
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
    # Nothing here runs in a container and no tenant code runs here at all, so
    # one hop is all this needs.
    http_put_response_hop_limit = 1
  }

  lifecycle {
    ignore_changes = [ami]

    # Without this the fleet being empty is an index error naming neither
    # variable, several resources away from the one that is actually wrong.
    precondition {
      condition     = var.app_host_count > 0
      error_message = "port_relay_count needs an app host to forward to: app_host_count is 0."
    }
  }

  tags = {
    Name = "${local.resource_name_prefix}-port-relay-${count.index}"
  }
}

# The address a tenant hands to its users, so it outlives the instance behind it.
# That is also what makes this the seam: moving the relay elsewhere later is
# re-associating this, with nothing to tell the clients already using it.
resource "aws_eip" "port_relay" {
  count = var.port_relay_count

  instance = aws_instance.port_relay[count.index].id
  domain   = "vpc"

  tags = {
    Name = "${local.resource_name_prefix}-port-relay-${count.index}-public-ip"
  }
}

# Open to the world, which is the point: this is the address tenants hand out,
# and who may reach a tenant's port is the tenant's own business. It is the only
# group in this VPC that is, and the machine behind it holds nothing — no tenant
# data, no credentials, no state worth keeping.
resource "aws_security_group" "port_relay" {
  count = var.port_relay_count

  name        = "${local.resource_name_prefix}-port-relay"
  description = "nibrun tenant port relay"
  vpc_id      = aws_vpc.app.id

  # Both protocols, because which one a tenant's port speaks is not nibrun's to
  # know. A range opened for one of them would work for some binaries and
  # silently not for others, which is worse than not offering the port at all.
  ingress {
    description      = "Tenant ports, UDP"
    from_port        = var.tenant_port_first
    to_port          = var.tenant_port_last
    protocol         = "udp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  ingress {
    description      = "Tenant ports, TCP"
    from_port        = var.tenant_port_first
    to_port          = var.tenant_port_last
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  # No inbound SSH: shell access is via SSM Session Manager, which connects out.

  egress {
    description      = "All outbound"
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name = "${local.resource_name_prefix}-port-relay"
  }
}

# Nothing but SSM: this box reads no bucket and holds no secret. The role exists
# so there is a way in without an inbound rule for it.
resource "aws_iam_role" "port_relay" {
  count = var.port_relay_count

  name               = "${local.resource_name_prefix}-port-relay"
  assume_role_policy = data.aws_iam_policy_document.instance_assume.json

  tags = {
    Name = "${local.resource_name_prefix}-port-relay"
  }
}

resource "aws_iam_role_policy_attachment" "port_relay_ssm_core" {
  count = var.port_relay_count

  role       = aws_iam_role.port_relay[count.index].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "port_relay" {
  count = var.port_relay_count

  name = "${local.resource_name_prefix}-port-relay"
  role = aws_iam_role.port_relay[count.index].name
}
