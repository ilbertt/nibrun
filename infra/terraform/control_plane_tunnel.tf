locals {
  control_plane_hostnames       = toset([var.api_hostname, var.dozzle_hostname, var.victorialogs_hostname, var.umami_hostname])
  control_plane_tunnel_hostname = "${cloudflare_zero_trust_tunnel_cloudflared.control_plane.id}.cfargotunnel.com"
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "control_plane" {
  account_id = var.cloudflare_account_id
  name       = "${local.resource_name_prefix}-control-plane"
  config_src = "cloudflare"
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "control_plane" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.control_plane.id
  config = {
    ingress = concat([
      for hostname in local.control_plane_hostnames : {
        hostname = hostname
        service  = "http://caddy:80"
        origin_request = {
          http_host_header = hostname
        }
      }
    ], [{ service = "http_status:404" }])
  }
}

data "cloudflare_zero_trust_tunnel_cloudflared_token" "control_plane" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.control_plane.id
}

resource "aws_ssm_parameter" "cloudflared_token" {
  name  = "${var.ssm_secret_prefix}/cloudflared_token"
  type  = "SecureString"
  value = data.cloudflare_zero_trust_tunnel_cloudflared_token.control_plane.token

  tags = {
    Name = "${local.resource_name_prefix}-cloudflared-token"
  }
}

output "cloudflared_tunnel_hostname" {
  description = "CNAME target for the control-plane hostnames."
  value       = local.control_plane_tunnel_hostname
}
