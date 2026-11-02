variable "nibrunner_origin_domain" {
  type        = string
  description = "Registrable domain covered by the nibrunner origin certificate. CI supplies NIBRUNNER_ORIGIN_DOMAIN."

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]*\\.[a-z]{2,}$", var.nibrunner_origin_domain))
    error_message = "nibrunner_origin_domain must be a domain name without a wildcard or URL scheme."
  }
}

locals {
  origin_certificate_domains = {
    app_host  = var.app_host_domain
    nibrunner = var.nibrunner_origin_domain
  }
}

resource "tls_private_key" "origin" {
  for_each    = local.origin_certificate_domains
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "tls_cert_request" "origin" {
  for_each        = local.origin_certificate_domains
  private_key_pem = tls_private_key.origin[each.key].private_key_pem_pkcs8
  dns_names       = [each.value, "*.${each.value}"]
}

resource "cloudflare_origin_ca_certificate" "origin" {
  for_each           = tls_cert_request.origin
  csr                = each.value.cert_request_pem
  hostnames          = each.value.dns_names
  request_type       = "origin-ecc"
  requested_validity = 5475

  # Apply runs before hosts reload. Rotation must deploy a second certificate
  # before retiring the first, rather than revoke a certificate still in use.
  lifecycle {
    prevent_destroy = true
  }
}
