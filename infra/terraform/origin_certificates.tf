locals {
  origin_certificate_domains = {
    app_host = var.app_host_domain
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
