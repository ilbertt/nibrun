variable "grafana_hostname" {
  type        = string
  description = "Private Grafana hostname, protected by Cloudflare Access."

  validation {
    condition     = trimspace(var.grafana_hostname) != ""
    error_message = "grafana_hostname must not be empty."
  }
}

output "grafana_hostname" {
  value = var.grafana_hostname
}
