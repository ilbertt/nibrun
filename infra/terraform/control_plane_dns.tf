data "cloudflare_zones" "control_plane" {
  account = { id = var.cloudflare_account_id }
}

locals {
  control_plane_zone_ids = {
    for hostname in local.control_plane_hostnames : hostname => one([
      for zone in data.cloudflare_zones.control_plane.result : zone
      if hostname == zone.name || endswith(hostname, ".${zone.name}")
    ]).id
  }
}

# Adopt the current A records so cutover updates their identities in place.
# After cutover these queries are empty; the CNAMEs are already in state.
data "cloudflare_dns_records" "control_plane_origin" {
  for_each = local.control_plane_hostnames
  zone_id  = local.control_plane_zone_ids[each.key]
  name     = { exact = each.key }
  type     = "A"
}

import {
  for_each = {
    for hostname, records in data.cloudflare_dns_records.control_plane_origin : hostname => one(records.result)
    if length(records.result) > 0
  }
  to = cloudflare_dns_record.control_plane[each.key]
  id = "${local.control_plane_zone_ids[each.key]}/${each.value.id}"
}

resource "cloudflare_dns_record" "control_plane" {
  for_each = local.control_plane_hostnames
  zone_id  = local.control_plane_zone_ids[each.key]
  name     = each.key
  type     = "CNAME"
  content  = local.control_plane_tunnel_hostname
  proxied  = true
  ttl      = 1

  depends_on = [cloudflare_zero_trust_tunnel_cloudflared_config.control_plane]
}
