resource "cloudflare_zero_trust_access_policy" "log_viewers" {
  account_id       = var.cloudflare_account_id
  name             = "${local.resource_name_prefix}-log-viewers"
  decision         = "allow"
  session_duration = "24h"

  include = [{
    cloudflare_account_member = {
      account_id = var.cloudflare_account_id
    }
  }]
}

resource "cloudflare_zero_trust_access_application" "logs" {
  for_each = {
    dozzle = var.dozzle_hostname
    logs   = var.victorialogs_hostname
  }

  account_id                 = var.cloudflare_account_id
  name                       = "${local.resource_name_prefix}-${each.key}"
  type                       = "self_hosted"
  domain                     = each.value
  session_duration           = cloudflare_zero_trust_access_policy.log_viewers.session_duration
  http_only_cookie_attribute = true

  destinations = [{
    type = "public"
    uri  = each.value
  }]

  policies = [{
    id         = cloudflare_zero_trust_access_policy.log_viewers.id
    precedence = 1
  }]
}
