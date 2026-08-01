variable "region" {
  type    = string
  default = "eu-west-2"
}

variable "environment" {
  type    = string
  default = "dev"
}

# --- Control plane (apps/api + apps/gateway + Postgres, one box) ---

variable "control_plane_instance_type" {
  type        = string
  default     = "t3.large"
  description = "Instance type for the control-plane box. Runs the api, gateway and Postgres containers."
}

variable "control_plane_data_volume_size" {
  type        = number
  default     = 50
  description = "Persistent data EBS volume for the control plane, in GB. Backs Postgres and the gateway's certificate store. Survives instance replacement."
}

# --- Compute hosts (apps/agent, one systemd unit per host) ---

variable "host_count" {
  type        = number
  default     = 1
  description = "Number of compute hosts running the agent. Each gets its own instance and its own persistent volume."
}

variable "host_instance_type" {
  type        = string
  default     = "c7i.large"
  description = "Instance type for compute hosts. Fine for the process and container runners; the Firecracker runner needs nested virtualisation, which on AWS means a bare-metal type (e.g. c7i.metal-24xl)."
}

variable "host_data_volume_size" {
  type        = number
  default     = 100
  description = "Persistent data EBS volume per compute host, in GB. Holds the per-app volumes the agent mounts into each guest at data/."
}

variable "root_volume_size" {
  type        = number
  default     = 50
  description = "Root EBS volume size in GB, for every instance. Holds the OS only; data lives on the data volumes."
}

variable "vpc_cidr_block" {
  type        = string
  default     = "10.43.0.0/16"
  description = "IPv4 CIDR block for the environment-owned VPC."
}

# The gateway is the only thing allowed to reach a guest, and only on this
# range. Keep it in step with whatever the agent publishes guest ports on.
variable "guest_port_min" {
  type    = number
  default = 30000
}

variable "guest_port_max" {
  type    = number
  default = 32767
}

# --- Public hostnames ---
#
# nibrun deliberately spans two registrable domains: the dashboard and control
# plane live on nibrun.com, customer apps on nibrun.app, so customer JS is never
# in the dashboard's cookie scope.

variable "api_hostname" {
  type        = string
  description = "Public hostname for the control plane and the dashboard it embeds. Also the origin compute hosts dial for the agent socket."
  default     = "app.nibrun.com"
}

variable "apps_domain" {
  type        = string
  description = "Registrable domain customer apps are served from. The gateway answers for *.<apps_domain>; point a wildcard A record at the control-plane IP."
  default     = "nibrun.app"
}

variable "www_hostname" {
  type        = string
  description = "Public hostname for the statically rendered landing/docs site (apps/www) behind CloudFront."
  default     = "nibrun.com"
}

variable "www_alternate_hostnames" {
  type        = list(string)
  description = "Extra names the CDN distribution answers for, e.g. the www. alias."
  default     = ["www.nibrun.com"]
}

variable "acme_email" {
  type        = string
  description = "Contact address Let's Encrypt is given when the gateway requests certificates."
  default     = "ops@nibrun.com"
}

variable "enable_www_cdn" {
  type        = bool
  description = "Create the S3 + CloudFront distribution for apps/www. Off by default: CloudFront will not come up until the ACM certificate is validated, which needs DNS records you add by hand. Turn on once www_hostname resolves to you."
  default     = false
}

# --- GitHub Actions deploy ---

variable "enable_github_deploy" {
  type        = bool
  description = "Create the GitHub Actions OIDC deploy role. Local AWS CLI deployments do not need it."
  default     = false
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
  default = "/nibrun/dev"
}
