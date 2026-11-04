data "cloudflare_zone" "nibrunner" {
  filter = {
    account = { id = var.cloudflare_account_id }
    name    = var.nibrunner_domain
  }
}

data "cloudflare_dns_records" "nibrunner" {
  for_each = local.nibrunner_hostnames
  zone_id  = data.cloudflare_zone.nibrunner.id
  name     = { exact = each.key }

  lifecycle {
    postcondition {
      condition = length([
        for record in self.result : record.id
        if contains(["A", "AAAA", "CNAME"], record.type)
      ]) <= 1
      error_message = "Consolidate the nibrunner hostname's A/AAAA/CNAME records to a single record before adopting it as a Tunnel CNAME."
    }
  }
}

locals {
  nibrunner_existing_routes = {
    for hostname, records in data.cloudflare_dns_records.nibrunner : hostname => [
      for record in records.result : record.id
      if contains(["A", "AAAA", "CNAME"], record.type)
    ]
  }
}

import {
  for_each = {
    for hostname, records in local.nibrunner_existing_routes : hostname => one(records)
    if length(records) == 1
  }
  to = cloudflare_dns_record.nibrunner[each.key]
  id = "${data.cloudflare_zone.nibrunner.id}/${each.value}"
}

resource "cloudflare_dns_record" "nibrunner" {
  for_each = local.nibrunner_hostnames
  zone_id  = data.cloudflare_zone.nibrunner.id
  name     = each.key
  type     = "CNAME"
  content  = local.nibrunner_tunnel_hostname
  proxied  = true
  ttl      = 1

  depends_on = [cloudflare_zero_trust_tunnel_cloudflared_config.nibrunner]
}
