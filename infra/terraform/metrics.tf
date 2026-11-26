variable "metrics_ingest_port" {
  type        = number
  default     = 19082
  description = "Remote-write listener admitted only from the nibrunner security group."

  validation {
    condition     = var.metrics_ingest_port >= 1024 && var.metrics_ingest_port <= 65535 && !contains([var.internal_port, var.log_ingest_port], var.metrics_ingest_port)
    error_message = "metrics_ingest_port must be an unprivileged TCP port distinct from the control and log listeners."
  }
}

output "metrics_ingest_port" {
  value = var.metrics_ingest_port
}

output "metrics_remote_write_url" {
  value = "http://${aws_instance.app.private_ip}:${var.metrics_ingest_port}/api/v1/write"
}
