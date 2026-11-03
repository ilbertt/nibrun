#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

: "${NIBRUNNER_VERSION:?}" "${NIBRUNNER_BINARY_SHA256:?}"
: "${NIBRUNNER_GUEST_IMAGE_URL:?}" "${NIBRUNNER_GUEST_IMAGE_SHA256:?}"

if [ -e /var/lib/nibrun/host-id ]; then
  echo "refusing to install nibrunner over a registered legacy app host" >&2
  exit 1
fi

modprobe kvm_intel
test -c /dev/kvm

bash install_tls.sh

marker=/opt/nibrun/nibrunner-host/installed-binary.sha256
if ! cmp -s config.toml /etc/nibrunner/config.toml ||
  [ ! -f "$marker" ] || [ "$(cat "$marker")" != "$NIBRUNNER_BINARY_SHA256" ] ||
  ! printf '%s  %s\n' "$NIBRUNNER_BINARY_SHA256" /usr/local/bin/nibrunnerd | sha256sum --check --status; then
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q nftables e2fsprogs nbd-client fuse3 kmod passwd curl ca-certificates
  curl -fsSL --retry 3 \
    "https://github.com/ilbertt/nibrunner/releases/download/${NIBRUNNER_VERSION}/nibrunnerd-linux-x64" \
    -o "$work/nibrunnerd"
  printf '%s  %s\n' "$NIBRUNNER_BINARY_SHA256" "$work/nibrunnerd" | sha256sum --check
  install -m 0755 "$work/nibrunnerd" /usr/local/bin/nibrunnerd
  aws --region "$AWS_REGION" s3 cp --no-progress "$NIBRUNNER_GUEST_IMAGE_URL" "$work/image.tar.gz"
  printf '%s  %s\n' "$NIBRUNNER_GUEST_IMAGE_SHA256" "$work/image.tar.gz" | sha256sum --check
  tar -xzf "$work/image.tar.gz" -C "$work" vmlinux rootfs.ext4 manifest.json checksums.txt
  install -d -m 0700 /etc/nibrunner
  install -m 0600 config.toml /etc/nibrunner/config.toml
  nibrunnerd install --from "$work"
  systemctl daemon-reload
  systemctl try-restart nibrunnerd.service
  printf '%s\n' "$NIBRUNNER_BINARY_SHA256" > "$marker"
fi

nibrunnerd start
systemctl is-active --quiet nibrunnerd.service
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:9100/metrics > /dev/null
nibrunnerd --version
