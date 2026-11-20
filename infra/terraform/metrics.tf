variable "grafana_hostname" {
  type        = string
  description = "Private Grafana hostname, protected by Cloudflare Access."

  validation {
    condition     = trimspace(var.grafana_hostname) != ""
    error_message = "grafana_hostname must not be empty."
  }
}

variable "metrics_hostname" {
  type        = string
  description = "Public aggregate metrics dashboard hostname."

  validation {
    condition     = trimspace(var.metrics_hostname) != "" && var.metrics_hostname != var.grafana_hostname
    error_message = "metrics_hostname must be nonempty and different from grafana_hostname."
  }
}

variable "metrics_ingest_port" {
  type        = number
  default     = 19082
  description = "Remote-write listener admitted only from the nibrunner security group."

  validation {
    condition     = var.metrics_ingest_port >= 1024 && var.metrics_ingest_port <= 65535 && !contains([var.internal_port, var.log_ingest_port], var.metrics_ingest_port)
    error_message = "metrics_ingest_port must be an unprivileged TCP port distinct from the control and log listeners."
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

# This token selects an intentionally public dashboard; it is not a credential.
resource "random_id" "grafana_public_dashboard_token" {
  byte_length = 16
}

output "grafana_hostname" {
  value = var.grafana_hostname
}

output "metrics_hostname" {
  value = var.metrics_hostname
}

output "grafana_public_dashboard_token" {
  value = random_id.grafana_public_dashboard_token.hex
}

output "metrics_ingest_port" {
  value = var.metrics_ingest_port
}

output "metrics_remote_write_url" {
  value = "http://${aws_instance.app.private_ip}:${var.metrics_ingest_port}/api/v1/write"
}
