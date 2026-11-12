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

# Local NVMe storage backs /data. ensure_ephemeral_data.sh fails without it,
# so changing the host size must retain an instance store.
variable "app_host_instance_type" {
  type        = string
  default     = "m8id.large"
  description = "Runs Firecracker microVMs and ZeroFS. Nested virtualisation works on ordinary Intel instances, so this is not a metal type and does not need to be — but it must be a type whose ProcessorInfo.SupportedFeatures lists nested-virtualization, or the host boots no microVM."
}

# Spot for the app host, and only ever the stopping kind. A reclaimed on-demand
# request is terminated, which would put a replacement host on the same ZeroFS
# prefix while the old one still held the writer epoch — and infra/app-host/AGENTS.md
# is explicit that two read-write `zerofs run` against one prefix is an outage
# rather than an error message. Stopping keeps the instance id and the elastic ip,
# so what comes back is the same host rather than a rival to it — with a cold /data,
# which is an instance store and blank on every start.
#
# What this does not buy: `ignore_fsync = true` puts the entire durability
# guarantee in ZeroFS's five-second flush, so a reclaim loses 5-15 s of writes the
# guest was told were durable. Cheap capacity is a decision about cost; that window
# is a decision about tenants, and it is the one to revisit before launch.
variable "app_host_spot" {
  type        = bool
  default     = true
  description = "Buy app host capacity on the spot market. An interruption stops the instance rather than terminating it, and AWS starts it again when capacity returns."
}

variable "app_host_count" {
  type        = number
  default     = 1
  description = "Size of the app host fleet. Terraform does not provision hosts dynamically, so scaling is changing this."
}

variable "port_relay_instance_type" {
  type        = string
  default     = "t3.micro"
  description = "Sized by network baseline rather than CPU: forwarding is kernel work. t3.micro sustains 64 Mbps and bursts above it."
}

# Restated from the agent's own base, because a security group is the other half
# of opening a port and nothing compares the two numbers. One per slot, so it
# cannot run out: `tenant_port_last` is the base plus the last slot, which is
# `SLOT_COUNT - 1` in apps/agent/src/lib/network/slot.ts.
variable "tenant_port_first" {
  type        = number
  default     = 22000
  description = "First port a tenant can be given. Must match the agent's own base, and must not overlap the loopback range the proxy reaches an app's HTTP on — those ports are reachable only from the host and must stay that way."
}

variable "tenant_port_last" {
  type        = number
  default     = 22126
  description = "Last port a tenant can be given, inclusive. Headroom runs to about 32767, where this would meet the kernel's own ephemeral range."
}

variable "app_host_root_volume_size" {
  type        = number
  default     = 50
  description = "Root EBS volume size in GB for an app host. Holds the OS, the versioned binaries under /opt/nibrun and the artifact cache under /var/lib/nibrun."
}

variable "export_retention_days" {
  type        = number
  default     = 1
  description = "How long a downloadable export survives. A security bound rather than a retention policy: the bundle carries the tenant's environment variables and their whole dataset. S3 lifecycle expiry runs daily, so 1 is the smallest meaningful value."
}

variable "import_retention_days" {
  type        = number
  default     = 30
  description = "How long an uploaded import archive survives. Longer than an export's, because this is bytes an owner sent rather than bytes nibrun produced: the archive has to outlive whatever delay there is between uploading it and deploying the app it seeds. A security bound all the same — it is one owner's dataset in the clear — so it expires rather than being kept."
}

variable "internal_port" {
  type        = number
  default     = 19080
  description = "Port the control plane serves /internal on over plain HTTP, reachable only from app hosts and nibrunner through their VPC security groups."

  # Not 8080, which Dozzle already publishes in the same compose stack — the
  # edge could not bind it and the deploy died on `compose up`. Chosen against
  # the collision recurring rather than for the number: unregistered in
  # /etc/services, outside the 3000/8000/9000 band anything added to the stack
  # reaches for by default, and below the 32768 ephemeral floor so no outbound
  # socket can be holding it when the edge starts.
}

variable "log_ingest_port" {
  type        = number
  default     = 19081
  description = "Port the control plane accepts log writes on, reachable from app hosts over the VPC and from nowhere else. Separate from internal_port so the fleet's write path and its control channel widen independently."

  # Adjacent to internal_port and chosen on the same grounds: unregistered in
  # /etc/services, outside the 3000/8000/9000 band anything added to the stack
  # reaches for by default, and below the 32768 ephemeral floor so no outbound
  # socket can be holding it when the edge starts.
}

variable "vpc_ipv4_cidr_block" {
  type        = string
  default     = "10.43.0.0/16"
  description = "IPv4 CIDR block for the VPC."
}

variable "api_hostname" {
  type        = string
  description = "Public hostname the api is served on. Terraform routes it through Cloudflare Tunnel."

  # CI passes the API_HOSTNAME repository variable straight through, and an unset
  # variable arrives as an empty string. Fail the plan rather than deploy an api
  # whose BASE_URL is "https://".
  validation {
    condition     = trimspace(var.api_hostname) != ""
    error_message = "api_hostname must not be empty."
  }
}

variable "dozzle_hostname" {
  type        = string
  description = "Public hostname the container logs are served on. Terraform routes it through Cloudflare Tunnel."

  # An unset repository variable arrives empty, and Caddy reads an empty site
  # address as a catch-all — which would put the logs on the api's hostname.
  validation {
    condition     = trimspace(var.dozzle_hostname) != ""
    error_message = "dozzle_hostname must not be empty."
  }
}

variable "victorialogs_hostname" {
  type        = string
  description = "Public hostname the fleet's logs are queried on. Terraform routes it through Cloudflare Tunnel."

  validation {
    condition     = trimspace(var.victorialogs_hostname) != ""
    error_message = "victorialogs_hostname must not be empty."
  }
}

# No default for the same reason api_hostname has none, and read the validation
# below before choosing a value: user apps must not share a registrable domain
# with the dashboard.
variable "app_host_domain" {
  type        = string
  description = "Registrable domain user apps are served under, as <slug>.<app_host_domain>. Its wildcard routes to the nibrunner Tunnel."

  validation {
    condition     = trimspace(var.app_host_domain) != ""
    error_message = "app_host_domain must not be empty."
  }

  # A user app is somebody else's code on a hostname we hand out. On a subdomain
  # of the dashboard's own domain it could set a cookie the browser then sends
  # to the api, which is a session-fixation primitive handed to every tenant.
  # A separate registrable domain is what puts them either side of the public
  # suffix boundary, so this is a security bound rather than a preference.
  validation {
    condition     = var.api_hostname != var.app_host_domain && !endswith(var.api_hostname, ".${var.app_host_domain}")
    error_message = "app_host_domain must be a different registrable domain from api_hostname."
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

# Where the two names in the app host zone that serve nothing send their visitors:
# the apex, and the fallback origin. Nothing here provisions it — the marketing
# site is a Worker of its own — so it enters as configuration, and has no default
# for the reason api_hostname has none.
variable "www_hostname" {
  type        = string
  description = "Public hostname of the marketing site. CI passes the WWW_HOSTNAME repository variable through."

  validation {
    condition     = trimspace(var.www_hostname) != ""
    error_message = "www_hostname must not be empty."
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

variable "umami_admin_username" {
  type        = string
  default     = "nibrun"
  description = "Initial Umami administrator username; subsequent changes belong in Umami."

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9_-]{0,254}$", var.umami_admin_username))
    error_message = "Use 1–255 lowercase letters, digits, underscores or hyphens, starting with a letter or digit."
  }
}

variable "umami_hostname" {
  type        = string
  description = "Public hostname of the Umami dashboard. CI passes the UMAMI_HOSTNAME repository variable."

  validation {
    condition     = trimspace(var.umami_hostname) != ""
    error_message = "umami_hostname must not be empty."
  }
}
