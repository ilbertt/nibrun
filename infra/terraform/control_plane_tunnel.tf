locals {
  control_plane_hostnames       = toset(concat([var.api_hostname], values(local.control_plane_access_hostnames)))
  control_plane_tunnel_hostname = "${cloudflare_zero_trust_tunnel_cloudflared.control_plane.id}.cfargotunnel.com"
  control_plane_access = {
    for application in cloudflare_zero_trust_access_application.control_plane : application.domain => {
      required  = true
      team_name = trimsuffix(data.cloudflare_zero_trust_organization.control_plane.auth_domain, ".cloudflareaccess.com")
      aud_tag   = [application.aud]
    }
  }
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
      for path in values(local.umami_public_paths) : {
        hostname = var.umami_hostname
        path     = "^${replace(path, ".", "\\.")}$"
        service  = "http://caddy:80"
        origin_request = {
          http_host_header = var.umami_hostname
        }
      }
      ], [
      for hostname in local.control_plane_hostnames : {
        hostname = hostname
        service  = "http://caddy:80"
        origin_request = {
          http_host_header = hostname
          access           = lookup(local.control_plane_access, hostname, null)
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
