data "cloudflare_zones" "control_plane" {
  account = { id = var.cloudflare_account_id }

  lifecycle {
    postcondition {
      condition = alltrue([
        for hostname in local.control_plane_hostnames : length([
          for zone in self.result : zone.id
          if hostname == zone.name || endswith(hostname, ".${zone.name}")
        ]) == 1
      ])
      error_message = "Each control-plane hostname must match exactly one visible Cloudflare zone. Grant the Terraform token Zone Read on those zones; the cutover also requires DNS Edit there."
    }
  }
}

locals {
  control_plane_zone_ids = {
    for hostname in local.control_plane_hostnames : hostname => one([
      for zone in data.cloudflare_zones.control_plane.result : zone
      if hostname == zone.name || endswith(hostname, ".${zone.name}")
    ]).id
  }
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
