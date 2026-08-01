terraform {
  required_version = ">= 1.11"

  # Inline rather than -backend-config: there is one stack, so there is nothing
  # to swap. The bucket is created by the bootstrap stack.
  backend "s3" {
    bucket       = "nibrun-tfstate-904233092606"
    key          = "nibrun/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.8"
    }
  }
}
