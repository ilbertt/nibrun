# Outputs that feed the deploy carry the exact name the environment variable
# has, all the way to the .env the box writes — nothing is renamed in transit.

output "public_ip" {
  description = "Point the hostname's A record at this, DNS-only / not proxied."
  value       = aws_eip.app.public_ip
}

output "public_ipv6" {
  value = one(aws_instance.app.ipv6_addresses)
}

output "api_hostname" {
  value = var.api_hostname
}

output "api_s3_bucket" {
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

output "github_deploy_role_arn" {
  description = "Set as AWS_DEPLOY_ROLE_ARN in GitHub repo variables."
  value       = var.enable_github_deploy ? aws_iam_role.github_deploy[0].arn : null
}

output "github_plan_role_arn" {
  description = "Set as AWS_PLAN_ROLE_ARN in GitHub repo variables."
  value       = var.enable_github_deploy ? aws_iam_role.github_plan[0].arn : null
}
