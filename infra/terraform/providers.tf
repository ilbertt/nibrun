provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "nibrun"
      ManagedBy = "terraform"
    }
  }
}
