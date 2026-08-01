variable "region" {
  type    = string
  default = "eu-central-1"
}

variable "instance_type" {
  type        = string
  default     = "t3.large"
  description = "Runs the whole compose stack: api and Postgres."
}

variable "root_volume_size" {
  type        = number
  default     = 50
  description = "Root EBS volume size in GB. Holds the OS only; data lives on the data volume."
}

variable "data_volume_size" {
  type        = number
  default     = 50
  description = "Persistent data EBS volume size in GB. Backs Postgres. Survives instance replacement."
}

variable "vpc_cidr_block" {
  type        = string
  default     = "10.43.0.0/16"
  description = "IPv4 CIDR block for the VPC."
}

# No default, deliberately: the domain is not bought yet, and a placeholder
# would silently become what everything points at.
variable "api_hostname" {
  type        = string
  description = "Public hostname the api is served on. Point an A record at the elastic IP."

  # CI passes the API_HOSTNAME repository variable straight through, and an unset
  # variable arrives as an empty string. Fail the plan rather than deploy an api
  # whose BASE_URL is "https://".
  validation {
    condition     = trimspace(var.api_hostname) != ""
    error_message = "api_hostname must not be empty."
  }
}

variable "enable_github_deploy" {
  type        = bool
  description = "Create the GitHub Actions OIDC deploy role. Set false to apply before the bootstrap stack exists, since the role looks up the OIDC provider it creates."
  default     = true
}

variable "github_repo" {
  type        = string
  description = "owner/repo allowed to assume the deploy role via OIDC."
  default     = "ilbertt/nibrun"
}

variable "github_branch" {
  type        = string
  description = "Branch allowed to deploy."
  default     = "main"
}

variable "ssm_secret_prefix" {
  type    = string
  default = "/nibrun"
}
