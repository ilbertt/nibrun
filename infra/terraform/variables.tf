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

# The GitHub OAuth App users sign in with. Its callback URL is tied to
# api_hostname, so an app is per-deployment — GitHub allows one callback URL per
# OAuth App. Both halves are created by hand, so unlike every other credential
# here they enter from outside rather than being generated.
variable "api_github_client_id" {
  type        = string
  description = "Client ID of the GitHub OAuth App. CI passes the API_GITHUB_CLIENT_ID repository variable through."

  # Empty arrives as "" from an unset repository variable, and an api booted
  # without it crashes on startup — fail the plan instead.
  validation {
    condition     = trimspace(var.api_github_client_id) != ""
    error_message = "api_github_client_id must not be empty."
  }
}

variable "api_github_client_secret" {
  type        = string
  sensitive   = true
  description = "Client secret of the GitHub OAuth App. CI passes the API_GITHUB_CLIENT_SECRET repository secret through."

  validation {
    condition     = trimspace(var.api_github_client_secret) != ""
    error_message = "api_github_client_secret must not be empty."
  }
}

# The Cloudflare Origin Certificate the proxy serves, and its key. Issued by
# hand like the OAuth App credentials, and split the same way: the certificate
# is handed to every client that connects, so it enters from a repository
# variable, while the key enters from a repository secret. Both are the PEM
# exactly as Cloudflare issues it; the base64 the box decodes is applied on the
# way into SSM, in ssm.tf, so nobody has to encode anything by hand.
variable "caddy_tls_cert" {
  type        = string
  description = "PEM of the Cloudflare Origin Certificate. CI passes the CADDY_TLS_CERT repository variable through."

  # An unset repository variable arrives as an empty string, and the failure
  # would otherwise surface as a broken handshake on the box, not a failed plan.
  validation {
    condition     = strcontains(var.caddy_tls_cert, "BEGIN CERTIFICATE")
    error_message = "caddy_tls_cert must be a PEM certificate."
  }
}

variable "caddy_tls_key" {
  type        = string
  sensitive   = true
  description = "PEM of the Cloudflare Origin Certificate's private key. CI passes the CADDY_TLS_KEY repository secret through."

  # Matches both the PKCS#8 and SEC1 headers, so an ECC key is as acceptable as
  # an RSA one.
  validation {
    condition     = strcontains(var.caddy_tls_key, "PRIVATE KEY")
    error_message = "caddy_tls_key must be a PEM private key."
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
