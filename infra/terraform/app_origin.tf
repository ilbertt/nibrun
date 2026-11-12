locals {
  app_origin_hostnames = toset([var.app_host_domain, "*.${var.app_host_domain}"])
}

data "cloudflare_dns_records" "app_origin" {
  for_each = local.app_origin_hostnames

  zone_id = data.cloudflare_zone.app_host.id
  name    = { exact = each.value }
}

import {
  for_each = local.app_origin_hostnames

  to = cloudflare_dns_record.app_origin[each.value]
  id = "${data.cloudflare_zone.app_host.id}/${one(data.cloudflare_dns_records.app_origin[each.value].result).id}"
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
