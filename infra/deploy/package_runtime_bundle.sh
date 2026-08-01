#!/usr/bin/env bash
# Builds the tarball the box downloads from S3 and unpacks into /opt/nibrun.
# Everything the on-box deploy touches has to be in here.
#
# Nothing from apps/ is included: the api ships as a container image with the
# dashboard embedded, so there is no config to bind-mount and nothing to reload
# after an image swap.
set -euo pipefail

output_path="${1:-${BUNDLE_PATH:-}}"
if [ -z "$output_path" ]; then
  echo "Usage: $0 <output-tarball>" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "$(dirname "$output_path")"

for required in docker-compose.yml docker-compose.prod.yml; do
  if [ ! -f "$repo_root/$required" ]; then
    echo "Missing $required at the repo root — the on-box deploy runs both." >&2
    exit 1
  fi
done

cmd=(
  tar czf "$output_path"
  -C "$repo_root"
  docker-compose.yml docker-compose.prod.yml
  -C "$repo_root/infra/deploy"
  on_box_deploy.sh ensure_data_volume.sh
)

printf '$'
printf ' %q' "${cmd[@]}"
printf '\n'
"${cmd[@]}"
