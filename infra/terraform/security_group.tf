resource "aws_security_group" "instance" {
  name        = local.resource_name_prefix
  description = "nibrun instance"
  vpc_id      = aws_vpc.app.id

  # Public HTTPS, terminated by the gateway. Port 80 is needed for the ACME
  # HTTP-01 challenge and to redirect to HTTPS.
  ingress {
    description      = "HTTP (ACME + redirect)"
    from_port        = 80
    to_port          = 80
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
  ingress {
    description      = "HTTPS"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  # No inbound SSH: shell access is via SSM Session Manager. The gateway's admin
  # API (:2019) is never exposed either — the api reaches it over the compose
  # network.

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
