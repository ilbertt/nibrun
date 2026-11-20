locals {
  app_hostnames = toset([var.app_domain, "*.${var.app_domain}"])
}

resource "cloudflare_dns_record" "app_origin" {
  for_each = local.app_hostnames

  zone_id = data.cloudflare_zone.apps.id
  name    = each.value
  type    = "CNAME"
  content = local.nibrunner_tunnel_hostname
  proxied = true
  ttl     = 1

  depends_on = [cloudflare_zero_trust_tunnel_cloudflared_config.nibrunner]
}

resource "cloudflare_custom_hostname_fallback_origin" "apps" {
  zone_id = data.cloudflare_zone.apps.id
  origin  = cloudflare_dns_record.app_origin[var.app_domain].name
}
