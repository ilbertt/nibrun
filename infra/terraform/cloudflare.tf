variable "cloudflare_account_id" {
  type        = string
  description = "Account owning the control-plane Tunnel and app_host_domain zone. CI supplies the CLOUDFLARE_ACCOUNT_ID repository variable."

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.cloudflare_account_id))
    error_message = "cloudflare_account_id must be a 32-character Cloudflare account ID."
  }
}

variable "cloudflare_terraform_api_token" {
  type        = string
  sensitive   = true
  description = "Infrastructure-only API token with Cloudflare Tunnel Edit and Account API Tokens Edit on the selected account, plus Zone Read on app_host_domain. Never sent to the application or instance."

  validation {
    condition     = trimspace(var.cloudflare_terraform_api_token) != ""
    error_message = "cloudflare_terraform_api_token must not be empty."
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_terraform_api_token
}
