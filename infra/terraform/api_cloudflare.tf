data "cloudflare_zone" "app_host" {
  filter = {
    account = { id = var.cloudflare_account_id }
    name    = var.app_host_domain
  }
}

data "cloudflare_account_api_token_permission_groups_list" "zone" {
  account_id = var.cloudflare_account_id
  scope      = "com.cloudflare.api.account.zone"
}

resource "cloudflare_account_token" "api_custom_hostnames" {
  account_id = var.cloudflare_account_id
  name       = "${local.resource_name_prefix}-api-custom-hostnames"
  policies = [{
    effect = "allow"
    permission_groups = [{
      id = one([
        for permission in data.cloudflare_account_api_token_permission_groups_list.zone.result : permission
        if permission.name == "SSL and Certificates Write" && permission.is_selectable
      ]).id
    }]
    resources = jsonencode({
      "com.cloudflare.api.account.zone.${data.cloudflare_zone.app_host.id}" = "*"
    })
  }]
}
