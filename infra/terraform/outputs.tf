output "public_ip" {
  description = "Control-plane elastic IP. Both the api hostname and the customer-app wildcard point here."
  value       = aws_eip.control_plane.public_ip
}

output "public_ipv6" {
  value = one(aws_instance.control_plane.ipv6_addresses)
}

# DNS is not managed here — the registrar may not be Route 53 — so this is the
# list of records to create by hand. Keep the proxy off (grey cloud on
# Cloudflare): the gateway terminates TLS itself.
output "dns_records" {
  description = "Records to create at your DNS provider, DNS-only / not proxied."
  value = concat(
    [
      "A    ${var.api_hostname}      ${aws_eip.control_plane.public_ip}",
      "A    *.${var.apps_domain}     ${aws_eip.control_plane.public_ip}",
    ],
    var.enable_www_cdn ? [
      for name in local.www_aliases :
      "CNAME ${name}    ${aws_cloudfront_distribution.www[0].domain_name}"
    ] : []
  )
}

output "acm_validation_records" {
  description = "CNAMEs proving you own the www hostnames. Add these or the first enable_www_cdn apply will hang on validation."
  value = var.enable_www_cdn ? [
    for option in aws_acm_certificate.www[0].domain_validation_options :
    "CNAME ${option.resource_record_name} ${option.resource_record_value}"
  ] : []
}

output "api_hostname" {
  value = var.api_hostname
}

output "apps_domain" {
  value = var.apps_domain
}

output "www_hostname" {
  value = var.www_hostname
}

output "acme_email" {
  description = "Passed to the gateway by the control-plane deploy."
  value       = var.acme_email
}

# --- Deploy targets ---

output "control_plane_deploy_group" {
  description = "SSM targeting tag for the control-plane deploy."
  value       = local.control_plane_deploy_group
}

output "host_deploy_group" {
  description = "SSM targeting tag for the agent rollout. Matches every compute host."
  value       = local.host_deploy_group
}

output "control_plane_instance_id" {
  value = aws_instance.control_plane.id
}

output "host_instance_ids" {
  value = aws_instance.host[*].id
}

output "control_plane_data_volume_id" {
  description = "The deploy script locates the device by this id to mount /data."
  value       = aws_ebs_volume.control_plane_data.id
}

output "deploy_bucket" {
  description = "Runtime bundles and Postgres dumps."
  value       = aws_s3_bucket.deploy.bucket
}

output "artifacts_bucket" {
  description = "User-uploaded binaries. Written by the api, read by hosts."
  value       = aws_s3_bucket.artifacts.bucket
}

output "github_deploy_role_arn" {
  description = "Set as AWS_DEPLOY_ROLE_ARN in GitHub repo variables."
  value       = var.enable_github_deploy ? aws_iam_role.github_deploy[0].arn : null
}

# --- CDN ---

output "www_bucket" {
  value = var.enable_www_cdn ? aws_s3_bucket.www[0].bucket : null
}

output "www_distribution_id" {
  description = "Target of the cache invalidation the www deploy issues."
  value       = var.enable_www_cdn ? aws_cloudfront_distribution.www[0].id : null
}
