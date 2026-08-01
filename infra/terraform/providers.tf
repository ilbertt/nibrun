provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "nibrun"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# CloudFront only accepts ACM certificates issued in us-east-1, regardless of
# where the rest of the stack lives.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "nibrun"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
