data "cloudflare_zone" "nibrunner" {
  filter = {
    account = { id = var.cloudflare_account_id }
    name    = var.nibrunner_domain
  }
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
