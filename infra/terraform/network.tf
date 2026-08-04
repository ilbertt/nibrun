resource "aws_vpc" "app" {
  cidr_block                       = var.vpc_ipv4_cidr_block
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
  cidr_block                      = cidrsubnet(var.vpc_ipv4_cidr_block, 8, 0)
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

# Free, and it keeps the highest-volume traffic in the system — ZeroFS reading
# and writing segments — off any metered path if egress ever stops going
# straight out of the internet gateway. Nothing has to be reconfigured to use
# it: the endpoint routes the region's S3 prefix list, so the existing endpoint
# hostname keeps working and the control plane's S3 traffic moves onto it too.
#
# It adds a route to the table above, but a prefix-list one, which the route
# table resource leaves alone rather than planning away on the next refresh.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.app.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.app.id]

  tags = {
    Name = "${local.resource_name_prefix}-s3"
  }
}
