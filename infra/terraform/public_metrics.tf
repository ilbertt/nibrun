variable "metrics_hostname" {
  type        = string
  description = "Public aggregate metrics dashboard hostname."

  validation {
    condition     = trimspace(var.metrics_hostname) != "" && var.metrics_hostname != var.grafana_hostname
    error_message = "metrics_hostname must be nonempty and different from grafana_hostname."
  }
}

resource "random_id" "grafana_public_dashboard_token" {
  byte_length = 16
}

output "metrics_hostname" {
  value = var.metrics_hostname
}

output "grafana_public_dashboard_token" {
  value = random_id.grafana_public_dashboard_token.hex
}
