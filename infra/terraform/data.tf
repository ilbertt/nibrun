data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

# Latest Amazon Linux 2023 x86_64 AMI (SSM agent preinstalled).
data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  availability_zone    = data.aws_availability_zones.available.names[0]
  resource_name_prefix = "nibrun-${var.environment}"

  # SSM RunCommand targets each fleet by these tags; the deploy scripts take
  # them as DEPLOY_GROUP.
  control_plane_deploy_group = "nibrun-${var.environment}-control-plane"
  host_deploy_group          = "nibrun-${var.environment}-host"

  ssm_param_arn_prefix = "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_secret_prefix}"
}
