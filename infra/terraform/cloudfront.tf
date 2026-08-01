# apps/www is statically rendered for SEO and served from a CDN, so it never
# touches the control-plane box. Origin is a private bucket reachable only
# through CloudFront (origin access control, no website endpoint).
#
# Off until enable_www_cdn is set: the distribution cannot come up before the
# ACM certificate is validated, and validation needs DNS records you add by
# hand (see the acm_validation_records output).

locals {
  www_aliases     = var.enable_www_cdn ? concat([var.www_hostname], var.www_alternate_hostnames) : []
  www_origin_id   = "${local.resource_name_prefix}-www"
  www_bucket_name = "nibrun-www-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket" "www" {
  count = var.enable_www_cdn ? 1 : 0

  bucket        = local.www_bucket_name
  force_destroy = true

  tags = {
    Name = local.www_origin_id
  }
}

resource "aws_s3_bucket_public_access_block" "www" {
  count = var.enable_www_cdn ? 1 : 0

  bucket                  = aws_s3_bucket.www[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_acm_certificate" "www" {
  count = var.enable_www_cdn ? 1 : 0

  provider                  = aws.us_east_1
  domain_name               = var.www_hostname
  subject_alternative_names = var.www_alternate_hostnames
  validation_method         = "DNS"

  tags = {
    Name = local.www_origin_id
  }

  lifecycle {
    create_before_destroy = true

    precondition {
      condition     = trimspace(var.www_hostname) != ""
      error_message = "www_hostname must be set when enable_www_cdn is true."
    }
  }
}

# Blocks the apply until the DNS validation records exist. Expect the first
# apply with enable_www_cdn = true to sit here while you add them.
resource "aws_acm_certificate_validation" "www" {
  count = var.enable_www_cdn ? 1 : 0

  provider        = aws.us_east_1
  certificate_arn = aws_acm_certificate.www[0].arn
}

resource "aws_cloudfront_origin_access_control" "www" {
  count = var.enable_www_cdn ? 1 : 0

  name                              = local.www_origin_id
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "www" {
  count = var.enable_www_cdn ? 1 : 0

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  aliases             = local.www_aliases
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.www[0].bucket_regional_domain_name
    origin_id                = local.www_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.www[0].id
  }

  default_cache_behavior {
    target_origin_id       = local.www_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # Managed-CachingOptimized. Static output, so let CloudFront hold it.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # A static build has no server to render 404s, so hand the SPA-ish 404 page
  # back with the right status rather than CloudFront's XML error.
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }
  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.www[0].certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = {
    Name = local.www_origin_id
  }
}

data "aws_iam_policy_document" "www_bucket" {
  count = var.enable_www_cdn ? 1 : 0

  statement {
    sid       = "CloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.www[0].arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.www[0].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "www" {
  count = var.enable_www_cdn ? 1 : 0

  bucket = aws_s3_bucket.www[0].id
  policy = data.aws_iam_policy_document.www_bucket[0].json
}
