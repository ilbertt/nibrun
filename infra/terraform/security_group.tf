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

# No ingress at all, and that is the design rather than an omission: nothing
# needs to reach an app host. The agent dials out for control, so the control
# channel is never inbound and the control plane never initiates a connection
# here; export reads a tenant's data from S3 rather than from the host; and
# shell access is SSM Session Manager, whose agent connects outbound too.
#
# Exactly one rule is ever added, when the user-app proxy lands: 443 from
# Cloudflare's published ranges, with Authenticated Origin Pulls. Pinned to the
# ranges rather than opened to the world as the control plane's 443 is, because
# what answers there is a proxy in front of tenant applications — the cost of a
# directly-reachable origin is somebody else's app, not ours, so it is worth
# carrying a list that changes underneath us.
#
# Written as an explicit empty set rather than an omitted block so a rule added
# out of band is a diff Terraform removes, not drift it adopts.
resource "aws_security_group" "app_host" {
  name        = "${local.resource_name_prefix}-app-host"
  description = "nibrun app host"
  vpc_id      = aws_vpc.app.id

  ingress = []

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
