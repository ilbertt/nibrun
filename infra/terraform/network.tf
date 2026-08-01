resource "aws_vpc" "app" {
  cidr_block                       = var.vpc_cidr_block
  assign_generated_ipv6_cidr_block = true
  enable_dns_hostnames             = true
  enable_dns_support               = true

  tags = {
    Name = local.resource_name_prefix
  }
}

resource "aws_subnet" "app" {
  vpc_id                          = aws_vpc.app.id
  availability_zone               = local.availability_zone
  cidr_block                      = cidrsubnet(var.vpc_cidr_block, 8, 0)
  ipv6_cidr_block                 = cidrsubnet(aws_vpc.app.ipv6_cidr_block, 8, 0)
  map_public_ip_on_launch         = true
  assign_ipv6_address_on_creation = true

  tags = {
    Name = "${local.resource_name_prefix}-public"
  }
}

resource "aws_internet_gateway" "app" {
  vpc_id = aws_vpc.app.id

  tags = {
    Name = "${local.resource_name_prefix}-internet"
  }
}

resource "aws_route_table" "app" {
  vpc_id = aws_vpc.app.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.app.id
  }

  route {
    ipv6_cidr_block = "::/0"
    gateway_id      = aws_internet_gateway.app.id
  }

  tags = {
    Name = "${local.resource_name_prefix}-public"
  }
}

resource "aws_route_table_association" "app" {
  subnet_id      = aws_subnet.app.id
  route_table_id = aws_route_table.app.id
}
