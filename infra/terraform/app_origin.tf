locals {
  app_origin_hostnames = toset([var.app_host_domain, "*.${var.app_host_domain}", "fallback.${var.app_host_domain}"])
}

resource "cloudflare_dns_record" "app_origin" {
  for_each = local.app_origin_hostnames

  zone_id = data.cloudflare_zone.app_host.id
  name    = each.value
  type    = "CNAME"
  content = local.nibrunner_tunnel_hostname
  proxied = true
  ttl     = 1

  depends_on = [cloudflare_zero_trust_tunnel_cloudflared_config.nibrunner]
}
