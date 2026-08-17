terraform {
  required_version = ">= 1.11"

  # Partial configuration: `bucket` is passed at init time by
  # shared/terraform.ts, everything else is fixed here. A backend is resolved
  # before any provider exists, so this is the one bucket name that cannot
  # derive itself from aws_caller_identity the way s3.tf does — and writing it
  # in would put the account id in a public repo and pin every future account
  # to the names its predecessor still holds. The bootstrap stack builds the
  # same name from AWS::AccountId.
  backend "s3" {
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
