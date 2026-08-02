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
