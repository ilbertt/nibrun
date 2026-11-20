locals {
  nibrunner_fallback_hostname = "fallback.${var.nibrunner_domain}"
}

resource "cloudflare_dns_record" "nibrunner_fallback" {
  zone_id = data.cloudflare_zone.nibrunner.id
  name    = local.nibrunner_fallback_hostname
  type    = "CNAME"
  content = local.nibrunner_tunnel_hostname
  proxied = true
  ttl     = 1

  depends_on = [cloudflare_zero_trust_tunnel_cloudflared_config.nibrunner]
}

resource "cloudflare_zone_setting" "nibrunner_ssl" {
  zone_id    = data.cloudflare_zone.nibrunner.id
  setting_id = "ssl"
  value      = "strict"
}

resource "cloudflare_authenticated_origin_pulls_settings" "nibrunner" {
  zone_id = data.cloudflare_zone.nibrunner.id
  enabled = false
}

resource "cloudflare_custom_hostname_fallback_origin" "nibrunner" {
  zone_id = data.cloudflare_zone.nibrunner.id
  origin  = cloudflare_dns_record.nibrunner_fallback.name

  depends_on = [
    cloudflare_zone_setting.nibrunner_ssl,
    cloudflare_authenticated_origin_pulls_settings.nibrunner,
  ]
}

output "nibrunner_fallback_origin_host" {
  value = cloudflare_dns_record.nibrunner_fallback.name
}

output "nibrunner_fallback_redirect" {
  value = "https://${var.www_hostname}"
}
