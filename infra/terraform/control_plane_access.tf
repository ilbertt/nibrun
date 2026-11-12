locals {
  control_plane_access_hostnames = {
    dozzle = var.dozzle_hostname
    logs   = var.victorialogs_hostname
    umami  = var.umami_hostname
  }
  umami_public_paths = {
    script  = "/script.js"
    collect = "/api/send"
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

resource "cloudflare_zero_trust_access_policy" "umami_public" {
  account_id = var.cloudflare_account_id
  name       = "${local.resource_name_prefix}-umami-public"
  decision   = "bypass"

  include = [{ everyone = {} }]
}

resource "cloudflare_zero_trust_access_application" "umami_public" {
  for_each = local.umami_public_paths

  account_id           = var.cloudflare_account_id
  name                 = "${local.resource_name_prefix}-umami-${each.key}"
  type                 = "self_hosted"
  domain               = "${var.umami_hostname}${each.value}"
  app_launcher_visible = false

  destinations = [{
    type = "public"
    uri  = "${var.umami_hostname}${each.value}"
  }]

  policies = [{
    id         = cloudflare_zero_trust_access_policy.umami_public.id
    precedence = 1
  }]
}
