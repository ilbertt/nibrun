variable "cloudflare_account_id" {
  type        = string
  description = "Account owning the control-plane and nibrunner Tunnels and their zones. CI supplies the CLOUDFLARE_ACCOUNT_ID repository variable."

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.cloudflare_account_id))
    error_message = "cloudflare_account_id must be a 32-character Cloudflare account ID."
  }
}

variable "cloudflare_terraform_api_token" {
  type        = string
  sensitive   = true
  description = "Infrastructure-only API token with Cloudflare Tunnel Edit and Account API Tokens Edit on the selected account, Zone Read on the application, control-plane and nibrunner zones, DNS Edit on the control-plane and nibrunner zones, Zone Settings Edit on the nibrunner zone, and SSL and Certificates Edit on app_host_domain and nibrunner_domain. Never sent to the application or instance."

  validation {
    condition     = trimspace(var.cloudflare_terraform_api_token) != ""
    error_message = "cloudflare_terraform_api_token must not be empty."
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_terraform_api_token
}
