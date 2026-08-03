#!/usr/bin/env bash
# Builds dist/init, the guest's PID 1. The only host dependency is Docker: the
# toolchain and the target architecture live in the container, so a developer Mac
# and an ubuntu-latest runner build the same binary.
#
# infra/guest-image copies what this produces to /init in the rootfs, and hashes it
# into that image's version — which is why the toolchain is pinned in versions.env
# and why the binary is stripped and carries no build id.
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
  --build-arg DEBIAN_SNAPSHOT="$DEBIAN_SNAPSHOT" \
  --target=init \
  --output "type=local,dest=$dist" \
  --progress=plain \
  "$runtime_dir"

chmod 0755 "$dist/init"
ls -l "$dist/init"
