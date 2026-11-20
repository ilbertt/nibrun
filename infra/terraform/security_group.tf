resource "aws_security_group" "instance" {
  name        = local.resource_name_prefix
  description = "nibrun instance"
  vpc_id      = aws_vpc.app.id

  ingress {
    description     = "Agent control channel from nibrunner"
    from_port       = var.internal_port
    to_port         = var.internal_port
    protocol        = "tcp"
    security_groups = [aws_security_group.nibrunner_host.id]
  }

  ingress {
    description     = "Log ingest from nibrunner"
    from_port       = var.log_ingest_port
    to_port         = var.log_ingest_port
    protocol        = "tcp"
    security_groups = [aws_security_group.nibrunner_host.id]
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
    Name = local.resource_name_prefix
  }
}
