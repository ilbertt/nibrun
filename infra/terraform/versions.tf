terraform {
  required_version = ">= 1.11"

  # Inline rather than -backend-config: there is one stack, so there is nothing
  # to swap. The bucket is created by the bootstrap stack.
  backend "s3" {
    bucket       = "nibrun-infra-tfstate"
    key          = "nibrun/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      # 6.x for cpu_options.nested_virtualization, which 5.x cannot express and
      # without which an app host boots no microVM.
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.8"
    }
  }
}
