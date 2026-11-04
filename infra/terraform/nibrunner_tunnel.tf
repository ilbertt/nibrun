locals {
  nibrunner_hostnames       = toset([var.nibrunner_domain, "*.${var.nibrunner_domain}"])
  nibrunner_tunnel_hostname = "${cloudflare_zero_trust_tunnel_cloudflared.nibrunner.id}.cfargotunnel.com"
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "nibrunner" {
  account_id = var.cloudflare_account_id
  name       = "${local.resource_name_prefix}-nibrunner"
  config_src = "cloudflare"
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "nibrunner" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.nibrunner.id
  config = {
    ingress = concat([
      for hostname in sort(tolist(local.nibrunner_hostnames)) : {
        hostname = hostname
        service  = "http://127.0.0.1:8080"
      }
    ], [{ service = "http_status:404" }])
  }
}

data "cloudflare_zero_trust_tunnel_cloudflared_token" "nibrunner" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.nibrunner.id
}

resource "aws_ssm_parameter" "nibrunner_cloudflared_token" {
  name  = "${var.ssm_secret_prefix}/nibrunner_cloudflared_token"
  type  = "SecureString"
  value = data.cloudflare_zero_trust_tunnel_cloudflared_token.nibrunner.token

  tags = {
    Name = "${local.resource_name_prefix}-nibrunner-cloudflared-token"
  }
}

output "nibrunner_cloudflared_token_parameter" {
  value = aws_ssm_parameter.nibrunner_cloudflared_token.name
}

output "nibrunner_tunnel_hostname" {
  description = "CNAME target for the nibrunner domain and its wildcard."
  value       = local.nibrunner_tunnel_hostname
}
