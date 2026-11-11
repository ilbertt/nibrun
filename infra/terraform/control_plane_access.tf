locals {
  control_plane_access_hostnames = {
    dozzle = var.dozzle_hostname
    logs   = var.victorialogs_hostname
  }
}

data "cloudflare_zero_trust_organization" "control_plane" {
  account_id = var.cloudflare_account_id
}

resource "cloudflare_zero_trust_access_policy" "control_plane" {
  account_id       = var.cloudflare_account_id
  name             = "${local.resource_name_prefix}-control-plane"
  decision         = "allow"
  session_duration = "24h"

  include = [{
    cloudflare_account_member = {
      account_id = var.cloudflare_account_id
    }
  }]
}

resource "cloudflare_zero_trust_access_application" "control_plane" {
  for_each = local.control_plane_access_hostnames

  account_id                 = var.cloudflare_account_id
  name                       = "${local.resource_name_prefix}-${each.key}"
  type                       = "self_hosted"
  domain                     = each.value
  session_duration           = cloudflare_zero_trust_access_policy.control_plane.session_duration
  http_only_cookie_attribute = true

  destinations = [{
    type = "public"
    uri  = each.value
  }]

  policies = [{
    id         = cloudflare_zero_trust_access_policy.control_plane.id
    precedence = 1
  }]
}
