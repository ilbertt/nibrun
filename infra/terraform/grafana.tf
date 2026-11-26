variable "grafana_hostname" {
  type        = string
  description = "Private Grafana hostname, protected by Cloudflare Access."

  validation {
    condition     = trimspace(var.grafana_hostname) != ""
    error_message = "grafana_hostname must not be empty."
  }
}

resource "random_password" "grafana_admin_password" {
  length  = 32
  special = false
}

resource "aws_ssm_parameter" "grafana_admin_password" {
  name  = "${var.ssm_secret_prefix}/grafana_admin_password"
  type  = "SecureString"
  value = random_password.grafana_admin_password.result
}

output "grafana_hostname" {
  value = var.grafana_hostname
}
