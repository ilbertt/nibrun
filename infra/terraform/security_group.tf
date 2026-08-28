resource "aws_security_group" "instance" {
  name        = local.resource_name_prefix
  description = "nibrun instance"
  vpc_id      = aws_vpc.app.id

  # The entire public surface: Caddy, terminating TLS. No port 80 — the zone is
  # Full (strict), so Cloudflare always reaches the origin over 443, and there is
  # no ACME challenge to answer because the certificate is a Cloudflare Origin
  # Certificate.
  #
  # Open to the world rather than pinned to Cloudflare's published ranges
  # because the origin authenticates the edge itself: Authenticated Origin Pulls
  # means a connection without Cloudflare's client certificate is refused during
  # the handshake, wherever it comes from. That holds without tracking a list
  # that changes underneath us, and it fails closed rather than locking us out.
  ingress {
    description      = "HTTPS"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

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
# asks the internet what to allow can widen the only inbound rule on the fleet
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

# One inbound rule, and it is the whole list: the user-app proxy. Nothing else
# needs to reach an app host — the agent dials out for control, so the control
# channel is never inbound and the control plane never initiates a connection
# here; export reads a tenant's data from S3 rather than from the host; and
# shell access is SSM Session Manager, whose agent connects outbound too.
resource "aws_security_group" "app_host" {
  name        = "${local.resource_name_prefix}-app-host"
  description = "nibrun app host"
  vpc_id      = aws_vpc.app.id

  # Pinned to Cloudflare's ranges rather than opened to the world as the control
  # plane's 443 is. Authenticated Origin Pulls is what actually refuses a
  # connection that did not come through the edge, and it holds on its own; this
  # sits in front of it because what answers here is a proxy for third-party
  # code, so the cost of a reachable origin is somebody else's app rather than
  # ours — worth carrying a list that changes underneath us.
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
