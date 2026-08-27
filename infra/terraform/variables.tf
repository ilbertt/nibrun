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

# Not m7i-flex, which this was and which nested virtualisation was verified on: a
# flex instance sustains 40% of its vCPUs and bursts above that on credit, and a
# host whose whole job is packing microVMs has nothing to spare when the credit
# runs out.
#
# m8id rather than m7i because it is the cheaper of the two on spot and carries a
# 118 GB NVMe instance store. Nothing uses that disk yet: /data is still the EBS
# volume below, and moving the ZeroFS cache onto ephemeral storage needs a
# boot-time format that nothing here does — ensure_data_volume.sh runs from the
# deploy while /data remounts from fstab, so a blank instance store would come back
# unmounted after every spot stop rather than merely cold.
variable "app_host_instance_type" {
  type        = string
  default     = "m8id.large"
  description = "Runs Firecracker microVMs and ZeroFS. Nested virtualisation works on ordinary Intel instances, so this is not a metal type and does not need to be — but it must be a type whose ProcessorInfo.SupportedFeatures lists nested-virtualization, or the host boots no microVM."
}

# Spot for the app host, and only ever the stopping kind. A reclaimed on-demand
# request is terminated, which would put a replacement host on the same ZeroFS
# prefix while the old one still held the writer epoch — and infra/app-host/AGENTS.md
# is explicit that two read-write `zerofs run` against one prefix is an outage
# rather than an error message. Stopping keeps the instance id, its data volume and
# its elastic ip, so what comes back is the same host rather than a rival to it.
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
  description = "Size of the app host fleet. Terraform does not provision hosts dynamically, so scaling is changing this — but scaling down is not a plain decrement, see app_host.tf."
}

variable "port_relay_count" {
  type        = number
  default     = 0
  description = "Number of tenant port relays, which is 0 or 1. The public address for a tenant port that is not the HTTPS edge; nothing needs one until an app can ask for a port, so it defaults to none. See port_relay.tf."
}

variable "port_relay_instance_type" {
  type        = string
  default     = "t3.micro"
  description = "Sized by network baseline rather than by CPU, because forwarding is kernel work and what crosses it is whatever the tenants behind it send. t3.micro carries 64 Mbps sustained and leans on burst credits above that; step up a size if the baseline is the thing being reached."
}

# The range the app host's agent allocates a tenant's public port from, restated
# here because a security group is the other half of opening one and nothing
# compares the two numbers — the same bargain as nbds_max in
# app_host_user_data.sh.tftpl. Deliberately narrow: it is a range anyone may
# reach, so it should be no wider than the ports actually handed out.
variable "tenant_port_first" {
  type        = number
  default     = 22000
  description = "First port a tenant can be given. Must match the agent's own base, and must not overlap the loopback range the proxy reaches an app's HTTP on — those ports are reachable only from the host and must stay that way."
}

variable "tenant_port_last" {
  type        = number
  default     = 22015
  description = "Last port a tenant can be given, inclusive."
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
variable "app_host_domain" {
  type        = string
  description = "Registrable domain user apps are served under, as <slug>.<app_host_domain>. Point a wildcard A record at an app host."

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

# The app hosts' own pair, issued for app_host_domain. Separate from the control
# plane's because a Cloudflare Origin Certificate is issued per zone and
# app_host_domain is a different zone by design — the same split the two proxies
# already are. It has to be a wildcard: hostnames are handed out per app, and
# reissuing a certificate every time somebody creates one is not a deploy step.
variable "app_host_caddy_tls_cert" {
  type        = string
  description = "PEM of the Cloudflare Origin Certificate for *.app_host_domain. CI passes the APP_HOST_CADDY_TLS_CERT repository variable through."

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

# Custom domains. A brought domain is in nobody's zone here, so the edge has to
# be told about each one as it is added — the one Cloudflare operation that
# cannot be a manual step in infra/AGENTS.md the way the rest of them are.
#
# Created by hand in the Cloudflare dashboard, so like the OAuth App credentials
# these enter from outside rather than being generated, and like them they have
# no default: an api deployed without them answers every custom-domain request
# with a 502, which is a broken feature rather than an absent one.
variable "cloudflare_api_token" {
  type        = string
  sensitive   = true
  description = "API token scoped to Zone -> SSL and Certificates -> Edit on the app_host_domain zone, and nothing else. CI passes the CLOUDFLARE_API_TOKEN repository secret through."

  validation {
    condition     = trimspace(var.cloudflare_api_token) != ""
    error_message = "cloudflare_api_token must not be empty."
  }
}

# Not secret — it is in every dashboard URL for the zone — but it travels with
# the token so the box has one place to read both, and one thing to be missing.
variable "cloudflare_zone_id" {
  type        = string
  description = "Zone id of app_host_domain. CI passes the CLOUDFLARE_ZONE_ID repository variable through."

  validation {
    condition     = trimspace(var.cloudflare_zone_id) != ""
    error_message = "cloudflare_zone_id must not be empty."
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
