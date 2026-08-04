# Outputs that feed the deploy carry the exact name the environment variable
# has, all the way to the .env the box writes — nothing is renamed in transit.

output "public_ip" {
  description = "Point the hostname's A record at this, DNS-only / not proxied."
  value       = aws_eip.app.public_ip
}

output "api_hostname" {
  value = var.api_hostname
}

output "dozzle_hostname" {
  value = var.dozzle_hostname
}

output "app_domain" {
  description = "User apps are served under this. One wildcard record covers the fleet, so there is nothing per-app in DNS."
  value       = var.app_domain
}

output "api_github_client_id" {
  description = "Public half of the GitHub OAuth App credentials; the secret half is read from SSM on the box."
  value       = var.api_github_client_id
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

output "instance_id" {
  value = aws_instance.app.id
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

# Private for the same reason control_plane_internal_url is: a shipper on an app
# host writes across the VPC, and log traffic never leaves it.
output "log_ingest_url" {
  description = "What a log shipper on an app host writes to."
  value       = "http://${aws_instance.app.private_ip}:${var.log_ingest_port}"
}

# The agent drops guest traffic to this by name, rather than leaving the control
# plane to the blanket private-address rule that happens to contain it.
output "vpc_ipv4_cidr_block" {
  description = "Denied to tenant microVMs."
  value       = aws_vpc.app.cidr_block
}

# The v6 half has no blanket rule behind it: AWS allocates VPC IPv6 from global
# unicast space, so `fc00::/7` does not contain it and a ruleset that only knows
# the documented private ranges reads the control plane as ordinary internet.
# Naming it here is the only thing that denies it.
output "vpc_ipv6_cidr_block" {
  description = "Denied to tenant microVMs. Unlike the v4 block, nothing else covers it."
  value       = aws_vpc.app.ipv6_cidr_block
}

output "app_host_deploy_group" {
  description = "SSM targeting tag for app hosts. Distinct from deploy_group so a deploy reaches one machine class without touching the other."
  value       = local.app_host_deploy_group
}

output "app_host_instance_ids" {
  value = aws_instance.app_host[*].id
}

output "app_host_public_ips" {
  description = "A record targets for the app domain's wildcard."
  value       = aws_eip.app_host[*].public_ip
}

# Not a single DATA_VOLUME_ID like the control plane's, because each host has
# its own: a deploy fanning out looks the instance it is targeting up here and
# exports that one value under the usual name.
output "app_host_data_volume_ids" {
  description = "Instance id to the id of the volume mounted at /data on it."
  value       = { for index, host in aws_instance.app_host : host.id => aws_ebs_volume.app_host_data[index].id }
}

output "exports_bucket" {
  description = "Downloadable app exports. Written by app hosts, read by the api only to sign a download URL."
  value       = aws_s3_bucket.exports.bucket
}

output "filesystems_bucket" {
  description = "ZeroFS's backing store. Read-write from app hosts, read-only from the control plane."
  value       = aws_s3_bucket.filesystems.bucket
}

output "guest_images_bucket" {
  description = "Where CI publishes the pinned guest image and app hosts fetch it from."
  value       = aws_s3_bucket.guest_images.bucket
}

output "github_deploy_role_arn" {
  description = "Assumed by the deploy steps, after Terraform has run."
  value       = var.enable_github_deploy ? aws_iam_role.github_deploy[0].arn : null
}
