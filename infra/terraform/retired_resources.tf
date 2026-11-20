moved {
  from = cloudflare_custom_hostname_fallback_origin.app_host
  to   = cloudflare_custom_hostname_fallback_origin.apps
}

# Keep the published artifacts private and encrypted while removing their obsolete management.
removed {
  from = aws_s3_bucket.guest_images
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket_public_access_block.guest_images
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket_server_side_encryption_configuration.guest_images
  lifecycle {
    destroy = false
  }
}
