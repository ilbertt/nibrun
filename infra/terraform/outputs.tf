# Outputs that feed the deploy carry the exact name the environment variable
# has, all the way to the .env the box writes — nothing is renamed in transit.

output "api_hostname" {
  value = var.api_hostname
}

output "dozzle_hostname" {
  value = var.dozzle_hostname
}

output "umami_hostname" {
  value = var.umami_hostname
}

output "www_hostname" {
  value = var.www_hostname
}

output "app_host_domain" {
  description = "User apps are served under this. One wildcard record covers the fleet, so there is nothing per-app in DNS."
  value       = var.app_host_domain
}

output "api_github_client_id" {
  description = "Public half of the GitHub OAuth App credentials; the secret half is read from SSM on the box."
  value       = var.api_github_client_id
}

output "api_google_client_id" {
  description = "Public half of the Google OAuth web client credentials; the secret half is read from SSM on the box."
  value       = var.api_google_client_id
}

output "api_cloudflare_zone_id" {
  description = "Zone custom hostnames are registered in; the token used against it is read from SSM on the box."
  value       = data.cloudflare_zone.app_host.id
}

output "artifacts_bucket" {
  value = aws_s3_bucket.artifacts.bucket
}

output "api_s3_endpoint" {
  value = "https://s3.${var.region}.amazonaws.com"
}

output "pg_backup_bucket" {
  description = "Nightly Postgres dumps."
  value       = aws_s3_bucket.backups.bucket
}

output "data_volume_id" {
  description = "The deploy script locates the device by this id to mount /data."
  value       = aws_ebs_volume.data.id
}

output "ssm_secret_prefix" {
  value = var.ssm_secret_prefix
}

output "deploy_group" {
  description = "SSM targeting tag used by the deploy workflow."
  value       = local.resource_name_prefix
}

output "deploy_bucket" {
  description = "Where CI uploads the runtime bundle; the box downloads it from the resulting URL."
  value       = aws_s3_bucket.deploy.bucket
}

# Private, not the elastic IP: agents reach the api inside the VPC, and control
# traffic never leaves it.
output "control_plane_internal_url" {
  description = "What an agent dials to reach the api."
  value       = "http://${aws_instance.app.private_ip}:${var.internal_port}"
}

output "internal_port" {
  value = var.internal_port
}

output "log_ingest_port" {
  value = var.log_ingest_port
}

output "log_ingest_url" {
  description = "Where nibrunner ships logs inside the VPC."
  value       = "http://${aws_instance.app.private_ip}:${var.log_ingest_port}"
}

output "vpc_ipv4_cidr_block" {
  description = "Denied to tenant microVMs."
  value       = aws_vpc.app.cidr_block
}

output "vpc_ipv6_cidr_block" {
  description = "Denied to tenant microVMs. Unlike the v4 block, nothing else covers it."
  value       = aws_vpc.app.ipv6_cidr_block
}




output "exports_bucket" {
  description = "Downloadable app exports. Written by nibrunner, read by the api only to sign a download URL."
  value       = aws_s3_bucket.exports.bucket
}

# The api has to say when an export stops being downloadable, and the bucket rule
# above is what makes that true. Read from the same variable rather than repeated
# in the api's configuration, so the promise cannot outlive the expiry.
output "export_retention_days" {
  description = "How long a downloadable export survives, as enforced by the exports bucket's lifecycle rule."
  value       = var.export_retention_days
}

output "imports_bucket" {
  description = "Archives an owner uploads to seed an app's data. Written and signed by the api, read once by nibrunner."
  value       = aws_s3_bucket.imports.bucket
}



output "github_deploy_role_arn" {
  description = "Assumed by the deploy steps, after Terraform has run."
  value       = var.enable_github_deploy ? aws_iam_role.github_deploy[0].arn : null
}
