data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

# Latest Amazon Linux 2023 x86_64 AMI (SSM agent preinstalled).
data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

# Read to answer one question about the type an app host is given: whether it comes
# with an instance store. `nibrun-data.service` mounts /data from it and fails when
# there is none, deliberately — falling back would put a 70 GB ZeroFS cache on a 50 GB
# root volume. The precondition in app_host.tf is what turns that into a plan error
# naming the variable, rather than a host that deploys and then never starts ZeroFS.
data "aws_ec2_instance_type" "app_host" {
  instance_type = var.app_host_instance_type
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  availability_zone    = data.aws_availability_zones.available.names[0]
  resource_name_prefix = "nibrun"
  github_owner         = split("/", var.github_repo)[0]
  github_name          = split("/", var.github_repo)[1]

  ssm_param_arn_prefix = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_secret_prefix}"
}
