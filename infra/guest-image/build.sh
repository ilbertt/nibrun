#!/usr/bin/env bash
# Builds the guest image into dist/. The only host dependency is Docker: the
# toolchain, the target architecture and the package set all live in the
# container, so a developer Mac and an ubuntu-latest runner build the same thing.
set -euo pipefail

# shellcheck source=lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

dist=${DIST:-$guest_image_dir/dist}

staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT

docker_build() {
  docker build \
    --platform=linux/amd64 \
    --build-context "runtime=$staging" \
    --build-arg BUILDER_IMAGE="$DEBIAN_IMAGE" \
    --build-arg DEBIAN_SNAPSHOT="$DEBIAN_SNAPSHOT" \
    --build-arg KERNEL_VERSION="$KERNEL_VERSION" \
    --build-arg KERNEL_SHA256="$KERNEL_SHA256" \
    --build-arg FIRECRACKER_CONFIG_SHA256="$FIRECRACKER_CONFIG_SHA256" \
    --build-arg SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" \
    --build-arg ROOTFS_UUID="$ROOTFS_UUID" \
    --build-arg ROOTFS_HASH_SEED="$ROOTFS_HASH_SEED" \
    --build-arg ROOTFS_LABEL="$ROOTFS_LABEL" \
    --progress=plain \
    "$@" \
    "$guest_image_dir"
}

init_is_stub=false
if [ "${GUEST_IMAGE_STUB_INIT:-0}" = "1" ]; then
  init_is_stub=true
  echo 'guest-image: building the stub /init — this image is not publishable' >&2
  docker_build --target=stub-init --output "type=local,dest=$staging"
else
  init=$(require_runtime_init)
  install -m 0755 "$init" "$staging/init"
fi

version=$("$guest_image_dir/version.sh")

rm -rf "$dist"
mkdir -p "$dist"
# One export directory per target. BuildKit's local exporter diffs against what
# is already in the destination and will remove entries the stage does not own,
# so two targets sharing one directory is a race, not a merge.
for target in kernel rootfs; do
  docker_build --target="$target" --output "type=local,dest=$staging/$target"
  mv "$staging/$target"/* "$dist/"
done

for artifact in vmlinux kernel.config rootfs.ext4; do
  [ -s "$dist/$artifact" ] || die "the build produced no $artifact"
done

artifact_json() {
  printf '{"name":"%s","bytes":%s,"sha256":"%s"}' \
    "$1" "$(wc -c <"$dist/$1" | tr -d ' ')" "$(sha256_file "$dist/$1")"
}

packages_json() {
  local separator='' name package_version
  while IFS='=' read -r name package_version; do
    printf '%s"%s":"%s"' "$separator" "$name" "$package_version"
    separator=','
  done <"$dist/packages"
}

cat >"$dist/manifest.json" <<EOF
{
  "version": "$version",
  "artifacts": [
    $(artifact_json vmlinux),
    $(artifact_json rootfs.ext4),
    $(artifact_json kernel.config)
  ],
  "inputs": {
    "kernel_version": "$KERNEL_VERSION",
    "kernel_sha256": "$KERNEL_SHA256",
    "firecracker_ref": "$FIRECRACKER_REF",
    "firecracker_commit": "$FIRECRACKER_COMMIT",
    "firecracker_config_sha256": "$FIRECRACKER_CONFIG_SHA256",
    "debian_image": "$DEBIAN_IMAGE",
    "debian_snapshot": "$DEBIAN_SNAPSHOT",
    "source_date_epoch": $SOURCE_DATE_EPOCH,
    "rootfs_packages": {$(packages_json)},
    "init_sha256": "$(sha256_file "$staging/init")",
    "init_is_stub": $init_is_stub
  }
}
EOF

rm -f "$dist/packages"

echo
cat "$dist/manifest.json"
