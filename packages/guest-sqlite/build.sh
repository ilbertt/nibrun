#!/usr/bin/env bash
set -euo pipefail

reader_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
dist=${DIST:-$reader_dir/dist}

# shellcheck disable=SC1091
set -a && . "$reader_dir/versions.env" && set +a

rm -rf "$dist"
mkdir -p "$dist"

docker build \
  --platform=linux/amd64 \
  --build-arg BUILDER_IMAGE="$BUILDER_IMAGE" \
  --build-arg SQLITE_ARCHIVE="$SQLITE_ARCHIVE" \
  --build-arg SQLITE_SHA256="$SQLITE_SHA256" \
  --build-arg JANSSON_VERSION="$JANSSON_VERSION" \
  --build-arg JANSSON_SHA256="$JANSSON_SHA256" \
  --target=library \
  --output "type=local,dest=$dist" \
  --progress=plain \
  "$reader_dir"

ls -l "$dist/libnibrun-guest-sqlite.a"
