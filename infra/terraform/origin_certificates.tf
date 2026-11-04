variable "nibrunner_domain" {
  type        = string
  description = "Domain routed to the nibrunner host. CI retains the existing NIBRUNNER_ORIGIN_DOMAIN repository variable."

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]*\\.[a-z]{2,}$", var.nibrunner_domain))
    error_message = "nibrunner_domain must be a domain name without a wildcard or URL scheme."
  }
}

locals {
  origin_certificate_domains = {
    app_host = var.app_host_domain
  }
}

moved {
  from = tls_private_key.origin["nibrunner"]
  to   = tls_private_key.nibrunner
}

moved {
  from = tls_cert_request.origin["nibrunner"]
  to   = tls_cert_request.nibrunner
}

moved {
  from = cloudflare_origin_ca_certificate.origin["nibrunner"]
  to   = cloudflare_origin_ca_certificate.nibrunner
}

resource "tls_private_key" "nibrunner" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "tls_cert_request" "nibrunner" {
  private_key_pem = tls_private_key.nibrunner.private_key_pem_pkcs8
  dns_names       = [var.nibrunner_domain, "*.${var.nibrunner_domain}"]
}

resource "cloudflare_origin_ca_certificate" "nibrunner" {
  csr                = tls_cert_request.nibrunner.cert_request_pem
  hostnames          = sort(tls_cert_request.nibrunner.dns_names)
  request_type       = "origin-ecc"
  requested_validity = 5475

  lifecycle {
    prevent_destroy = true
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
  for_each = tls_cert_request.origin
  csr      = each.value.cert_request_pem
  # Origin CA sorts hostnames on read. Keep the CSR itself stable to avoid reissuance.
  hostnames          = sort(each.value.dns_names)
  request_type       = "origin-ecc"
  requested_validity = 5475

  # Apply runs before hosts reload. Rotation must deploy a second certificate
  # before retiring the first, rather than revoke a certificate still in use.
  lifecycle {
    prevent_destroy = true
  }
}
