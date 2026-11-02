# One-time adoption after the manual DNS cutover. Remove after the import apply.
data "cloudflare_dns_records" "control_plane_import" {
  for_each = local.control_plane_hostnames
  zone_id  = local.control_plane_zone_ids[each.key]
  name     = { exact = each.key }
  type     = "CNAME"
  content  = { exact = local.control_plane_tunnel_hostname }
  proxied  = true

  lifecycle {
    postcondition {
      condition     = length(self.result) == 1 ? self.result[0].ttl == 1 : false
      error_message = "${each.key} must already have exactly one proxied tunnel CNAME with TTL Auto before importing."
    }
  }
}

import {
  for_each = data.cloudflare_dns_records.control_plane_import
  to       = cloudflare_dns_record.control_plane[each.key]
  id       = "${local.control_plane_zone_ids[each.key]}/${each.value.result[0].id}"
}
