# Literals only: a provider block cannot depend on a data source, and the
# locals in data.tf do.
locals {
  common_tags = {
    Project   = "nibrun"
    ManagedBy = "terraform"
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = local.common_tags
  }
}
