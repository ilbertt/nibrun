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

variable "app_host_instance_type" {
  type        = string
  default     = "m7i-flex.large"
  description = "Runs Firecracker microVMs and ZeroFS. Nested virtualisation works on ordinary Intel instances — verified on this one — so this is not a metal type and does not need to be."
}

variable "app_host_count" {
  type        = number
  default     = 1
  description = "Size of the app host fleet. Terraform does not provision hosts dynamically, so scaling is changing this — but scaling down is not a plain decrement, see app_host.tf."
}

variable "app_host_root_volume_size" {
  type        = number
  default     = 50
  description = "Root EBS volume size in GB for an app host. Holds the OS, the versioned binaries under /opt/nibrun and the artifact cache under /var/lib/nibrun."
}

variable "app_host_data_volume_size" {
  type        = number
  default     = 100
  description = "Per-host data EBS volume size in GB, mounted at /data. Sized for ZeroFS's working set, not for the fleet's data — S3 holds that."
}

variable "export_retention_days" {
  type        = number
  default     = 1
  description = "How long a downloadable export survives. A security bound rather than a retention policy: the bundle carries the tenant's environment variables and their whole dataset. S3 lifecycle expiry runs daily, so 1 is the smallest meaningful value."
}

variable "internal_port" {
  type        = number
  default     = 19080
  description = "Port the control plane serves /internal on, reachable from app hosts over the VPC and from nowhere else. Plain HTTP: the security group is the boundary, and an origin certificate names hostnames rather than the private address an agent dials."

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

# Named on the origin certificate alongside api_hostname — one certificate, both
# names, so the proxy has a single pair to serve. Adding a name here means
# reissuing that certificate, not adding a second one.
variable "dozzle_hostname" {
  type        = string
  description = "Public hostname the container logs are served on. Point an A record at the elastic IP."

  # An unset repository variable arrives empty, and Caddy reads an empty site
  # address as a catch-all — which would put the logs on the api's hostname.
  validation {
    condition     = trimspace(var.dozzle_hostname) != ""
    error_message = "dozzle_hostname must not be empty."
  }
}

# The third name on the origin certificate. Same reasoning as dozzle_hostname,
# and the same consequence for leaving it empty.
variable "victorialogs_hostname" {
  type        = string
  description = "Public hostname the fleet's logs are queried on. Point an A record at the elastic IP."

  validation {
    condition     = trimspace(var.victorialogs_hostname) != ""
    error_message = "victorialogs_hostname must not be empty."
  }
}

# No default for the same reason api_hostname has none, and read the validation
# below before choosing a value: user apps must not share a registrable domain
# with the dashboard.
variable "app_domain" {
  type        = string
  description = "Registrable domain user apps are served under, as <slug>.<app_domain>. Point a wildcard A record at an app host."

  validation {
    condition     = trimspace(var.app_domain) != ""
    error_message = "app_domain must not be empty."
  }

  # A user app is somebody else's code on a hostname we hand out. On a subdomain
  # of the dashboard's own domain it could set a cookie the browser then sends
  # to the api, which is a session-fixation primitive handed to every tenant.
  # A separate registrable domain is what puts them either side of the public
  # suffix boundary, so this is a security bound rather than a preference.
  validation {
    condition     = var.api_hostname != var.app_domain && !endswith(var.api_hostname, ".${var.app_domain}")
    error_message = "app_domain must be a different registrable domain from api_hostname."
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

# The app hosts' own pair, issued for app_domain. Separate from the control
# plane's because a Cloudflare Origin Certificate is issued per zone and
# app_domain is a different zone by design — the same split the two proxies
# already are. It has to be a wildcard: hostnames are handed out per app, and
# reissuing a certificate every time somebody creates one is not a deploy step.
variable "app_host_caddy_tls_cert" {
  type        = string
  description = "PEM of the Cloudflare Origin Certificate for *.app_domain. CI passes the APP_HOST_CADDY_TLS_CERT repository variable through."

  validation {
    condition     = strcontains(var.app_host_caddy_tls_cert, "BEGIN CERTIFICATE")
    error_message = "app_host_caddy_tls_cert must be a PEM certificate."
  }
}

variable "app_host_caddy_tls_key" {
  type        = string
  sensitive   = true
  description = "PEM of the private key for app_host_caddy_tls_cert. CI passes the APP_HOST_CADDY_TLS_KEY repository secret through."

  validation {
    condition     = strcontains(var.app_host_caddy_tls_key, "PRIVATE KEY")
    error_message = "app_host_caddy_tls_key must be a PEM private key."
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
