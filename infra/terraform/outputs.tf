output "public_ip" {
  description = "Point the hostname's A record at this, DNS-only / not proxied."
  value       = aws_eip.app.public_ip
}

output "public_ipv6" {
  value = one(aws_instance.app.ipv6_addresses)
}

output "hostname" {
  value = var.hostname
}

output "acme_email" {
  value = var.acme_email
}

output "instance_id" {
  value = aws_instance.app.id
}

output "deploy_group_tag" {
  description = "SSM targeting tag used by the deploy workflow."
  value       = local.resource_name_prefix
}

output "data_volume_id" {
  description = "The deploy script locates the device by this id to mount /data."
  value       = aws_ebs_volume.data.id
}

output "deploy_bucket" {
  description = "Runtime bundles and Postgres dumps."
  value       = aws_s3_bucket.deploy.bucket
}

output "artifacts_bucket" {
  description = "User-uploaded binaries."
  value       = aws_s3_bucket.artifacts.bucket
}

output "github_deploy_role_arn" {
  description = "Set as AWS_DEPLOY_ROLE_ARN in GitHub repo variables."
  value       = var.enable_github_deploy ? aws_iam_role.github_deploy[0].arn : null
}
