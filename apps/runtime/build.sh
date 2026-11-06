#!/usr/bin/env bash
# Builds dist/init, the guest's PID 1. The only host dependency is Docker: the
# toolchain and the target architecture live in the container, so a developer Mac
# and an ubuntu-latest runner build the same binary.
#
# infra/guest-image hashes the resulting binary into its version, including any
# changes caused by Debian toolchain updates.
set -euo pipefail

runtime_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
dist=${DIST:-$runtime_dir/dist}

# shellcheck disable=SC1091
set -a && . "$runtime_dir/versions.env" && set +a

rm -rf "$dist"
mkdir -p "$dist"

docker build \
  --platform=linux/amd64 \
  --build-arg BUILDER_IMAGE="$BUILDER_IMAGE" \
  --build-arg SQLITE_ARCHIVE="$SQLITE_ARCHIVE" \
  --build-arg SQLITE_SHA256="$SQLITE_SHA256" \
  --build-arg JANSSON_VERSION="$JANSSON_VERSION" \
  --build-arg JANSSON_SHA256="$JANSSON_SHA256" \
  --target=init \
  --output "type=local,dest=$dist" \
  --progress=plain \
  "$runtime_dir"

chmod 0755 "$dist/init"
ls -l "$dist/init"
