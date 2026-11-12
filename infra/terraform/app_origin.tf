locals {
  legacy_fallback_hostname = "fallback.${var.app_host_domain}"
  app_origin_hostnames     = toset([var.app_host_domain, "*.${var.app_host_domain}", local.legacy_fallback_hostname])
}

resource "cloudflare_dns_record" "app_origin" {
  for_each = local.app_origin_hostnames

  zone_id = data.cloudflare_zone.app_host.id
  name    = each.value
  type    = each.value == local.legacy_fallback_hostname ? "A" : "CNAME"
  content = each.value == local.legacy_fallback_hostname ? aws_eip.app_host[0].public_ip : local.nibrunner_tunnel_hostname
  proxied = true
  ttl     = 1

  depends_on = [cloudflare_zero_trust_tunnel_cloudflared_config.nibrunner]
}

import {
  to = cloudflare_custom_hostname_fallback_origin.app_host
  id = data.cloudflare_zone.app_host.id
}

resource "cloudflare_custom_hostname_fallback_origin" "app_host" {
  zone_id = data.cloudflare_zone.app_host.id
  origin  = cloudflare_dns_record.app_origin[var.app_host_domain].name
}
