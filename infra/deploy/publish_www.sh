#!/usr/bin/env bash
# Publishes the statically rendered apps/www build to the CDN origin.
set -euo pipefail

: "${WWW_BUCKET:?}" "${WWW_DISTRIBUTION_ID:?}"

build_dir="${WWW_BUILD_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/apps/www/dist}"
if [ ! -d "$build_dir" ]; then
  echo "Missing $build_dir — build apps/www first." >&2
  exit 1
fi

# Hashed assets are immutable and cached hard; the HTML that references them
# must not be, or a deploy ships new assets that nobody is pointed at.
aws s3 sync "$build_dir" "s3://${WWW_BUCKET}" \
  --delete \
  --exclude '*.html' \
  --cache-control 'public,max-age=31536000,immutable'

aws s3 sync "$build_dir" "s3://${WWW_BUCKET}" \
  --delete \
  --exclude '*' --include '*.html' \
  --cache-control 'public,max-age=0,must-revalidate'

invalidation_id=$(aws cloudfront create-invalidation \
  --distribution-id "$WWW_DISTRIBUTION_ID" \
  --paths '/*' \
  --query 'Invalidation.Id' --output text)
echo "Invalidation: $invalidation_id"

aws cloudfront wait invalidation-completed \
  --distribution-id "$WWW_DISTRIBUTION_ID" \
  --id "$invalidation_id"
echo "Invalidation complete"
