resource "aws_security_group" "instance" {
  name        = local.resource_name_prefix
  description = "nibrun instance"
  vpc_id      = aws_vpc.app.id

  # The agents' channel. Scoped to the app hosts' security group rather than a
  # CIDR, so it admits the fleet and widens by itself as the fleet grows, while
  # admitting nothing else in the subnet. The paths behind it are the ones the
  # public listener answers 404 for.
  ingress {
    description     = "Agent control channel from app hosts"
    from_port       = var.internal_port
    to_port         = var.internal_port
    protocol        = "tcp"
    security_groups = [aws_security_group.app_host.id]
  }

  ingress {
    description     = "Agent control channel from nibrunner"
    from_port       = var.internal_port
    to_port         = var.internal_port
    protocol        = "tcp"
    security_groups = [aws_security_group.nibrunner_host.id]
  }

  # The fleet's log writes. Scoped to the app hosts' group like the control
  # channel above, and a rule of its own so that widening one path does not
  # silently widen the other. What answers here proxies /insert and nothing else.
  ingress {
    description     = "Log ingest from app hosts"
    from_port       = var.log_ingest_port
    to_port         = var.log_ingest_port
    protocol        = "tcp"
    security_groups = [aws_security_group.app_host.id]
  }

  ingress {
    description     = "Log ingest from nibrunner"
    from_port       = var.log_ingest_port
    to_port         = var.log_ingest_port
    protocol        = "tcp"
    security_groups = [aws_security_group.nibrunner_host.id]
  }

  # The relay's journal, which is the only thing that machine emits and the only
  # way anything would notice it stop. Its own rule rather than widening the app
  # hosts' above: the relay is the one machine here reachable from the internet,
  # so the two write paths should widen independently.
  ingress {
    description     = "Log ingest from the port relay"
    from_port       = var.log_ingest_port
    to_port         = var.log_ingest_port
    protocol        = "tcp"
    security_groups = [aws_security_group.port_relay.id]
  }

  # No inbound SSH: shell access is via SSM Session Manager.

  egress {
    description      = "All outbound"
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name = local.resource_name_prefix
  }
}

# Cloudflare's published edge ranges, from https://www.cloudflare.com/ips-v4
# and /ips-v6. Pinned in git rather than fetched by a data source: a plan that
# asks the internet what to allow can widen HTTPS ingress across the fleet
# with nothing for a reviewer to look at. Refresh it deliberately, in its own
# commit.
locals {
  cloudflare_ipv4_cidrs = [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
  ]

  cloudflare_ipv6_cidrs = [
    "2400:cb00::/32",
    "2606:4700::/32",
    "2803:f800::/32",
    "2405:b500::/32",
    "2405:8100::/32",
    "2a06:98c0::/29",
    "2c0f:f248::/32",
  ]
}

# The agent and SSM dial out, and exports read S3, so only the Cloudflare proxy
# and the tenant-port relay need inbound access to an app host.
resource "aws_security_group" "app_host" {
  name        = "${local.resource_name_prefix}-app-host"
  description = "nibrun app host"
  vpc_id      = aws_vpc.app.id

  ingress {
    description      = "HTTPS from Cloudflare"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = local.cloudflare_ipv4_cidrs
    ipv6_cidr_blocks = local.cloudflare_ipv6_cidrs
  }

  # Only ever from the relay, and pinned to its group rather than an address so it
  # survives the relay being replaced. This is what a load balancer could not do:
  # a UDP target group preserves the client's address, so its targets have to
  # admit the whole internet.
  ingress {
    description     = "Tenant ports, UDP, from the port relay"
    from_port       = var.tenant_port_first
    to_port         = var.tenant_port_last
    protocol        = "udp"
    security_groups = [aws_security_group.port_relay.id]
  }

  ingress {
    description     = "Tenant ports, TCP, from the port relay"
    from_port       = var.tenant_port_first
    to_port         = var.tenant_port_last
    protocol        = "tcp"
    security_groups = [aws_security_group.port_relay.id]
  }

  egress {
    description      = "All outbound"
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name = "${local.resource_name_prefix}-app-host"
  }
}
