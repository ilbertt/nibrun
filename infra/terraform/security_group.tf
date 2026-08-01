# Rules are standalone resources rather than inline ingress/egress blocks. The
# host group needs a security-group-referencing rule, and the AWS provider does
# not allow inline and standalone rules on the same group — so both groups use
# the standalone form to keep one style.

resource "aws_security_group" "control_plane" {
  name        = "${local.resource_name_prefix}-control-plane"
  description = "nibrun ${var.environment} control plane (api + gateway)"
  vpc_id      = aws_vpc.app.id

  tags = {
    Name = "${local.resource_name_prefix}-control-plane"
  }
}

# Public HTTPS, terminated by the gateway. Port 80 is needed for the ACME
# HTTP-01 challenge and to redirect to HTTPS.
#
# No inbound SSH: shell access is via SSM Session Manager. The gateway's admin
# API (:2019) is never exposed either — the api reaches it over the compose
# network.
resource "aws_vpc_security_group_ingress_rule" "control_plane_http_ipv4" {
  security_group_id = aws_security_group.control_plane.id
  description       = "HTTP (ACME + redirect)"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "control_plane_http_ipv6" {
  security_group_id = aws_security_group.control_plane.id
  description       = "HTTP (ACME + redirect)"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv6         = "::/0"
}

resource "aws_vpc_security_group_ingress_rule" "control_plane_https_ipv4" {
  security_group_id = aws_security_group.control_plane.id
  description       = "HTTPS"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "control_plane_https_ipv6" {
  security_group_id = aws_security_group.control_plane.id
  description       = "HTTPS"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv6         = "::/0"
}

resource "aws_vpc_security_group_egress_rule" "control_plane_all_ipv4" {
  security_group_id = aws_security_group.control_plane.id
  description       = "All outbound"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "control_plane_all_ipv6" {
  security_group_id = aws_security_group.control_plane.id
  description       = "All outbound"
  ip_protocol       = "-1"
  cidr_ipv6         = "::/0"
}

# Compute hosts take no inbound traffic from the internet at all. The agent
# dials out to the control plane and work arrives down that socket, so nothing
# has to reach a host to schedule onto it.
resource "aws_security_group" "host" {
  name        = "${local.resource_name_prefix}-host"
  description = "nibrun ${var.environment} compute host (agent + guests)"
  vpc_id      = aws_vpc.app.id

  tags = {
    Name = "${local.resource_name_prefix}-host"
  }
}

resource "aws_vpc_security_group_egress_rule" "host_all_ipv4" {
  security_group_id = aws_security_group.host.id
  description       = "All outbound"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "host_all_ipv6" {
  security_group_id = aws_security_group.host.id
  description       = "All outbound"
  ip_protocol       = "-1"
  cidr_ipv6         = "::/0"
}

# The one exception to "nothing reaches a host": the gateway proxies visitor
# requests to whichever host currently runs that app, so it needs the guest port
# range. Source is the control-plane security group, never a CIDR — guests stay
# unreachable from the internet even if a host picks up a public IP.
resource "aws_vpc_security_group_ingress_rule" "host_from_gateway" {
  security_group_id            = aws_security_group.host.id
  description                  = "Gateway to guests"
  ip_protocol                  = "tcp"
  from_port                    = var.guest_port_min
  to_port                      = var.guest_port_max
  referenced_security_group_id = aws_security_group.control_plane.id
}
