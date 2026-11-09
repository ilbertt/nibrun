#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

: "${NIBRUNNER_VERSION:?}" "${NIBRUNNER_BINARY_SHA256:?}"
: "${NIBRUNNER_GUEST_IMAGE_URL:?}" "${NIBRUNNER_GUEST_IMAGE_SHA256:?}"

if [ -e /var/lib/nibrun/host-id ]; then
  echo "refusing to install nibrunner over a registered legacy app host" >&2
  exit 1
fi

install -m 0644 apt.conf /etc/apt/apt.conf.d/99nibrun-lock-timeout

if [ -d /var/lib/nibrunner/volumes ] &&
  [ -n "$(find /var/lib/nibrunner/volumes -type f -print -quit)" ]; then
  echo "refusing to activate ZeroFS while local volume data remains" >&2
  exit 1
fi

modprobe kvm_intel
test -c /dev/kvm

instance_store_device=
for candidate in /dev/disk/by-id/nvme-Amazon_EC2_NVMe_Instance_Storage_*; do
  case "$candidate" in
    *-part[0-9]*) continue ;;
  esac
  [ -b "$candidate" ] || continue
  instance_store_device=$candidate
  break
done
if [ -z "$instance_store_device" ]; then
  echo "no EC2 instance-store device found for nibrunner host storage" >&2
  exit 1
fi
sed -i "s|{{HOST_STORAGE_DEVICE}}|$instance_store_device|g" config.toml

marker=/opt/nibrun/nibrunner-host/installed-binary.sha256
if ! cmp -s config.toml /etc/nibrunner/config.toml ||
  [ ! -f "$marker" ] || [ "$(cat "$marker")" != "$NIBRUNNER_BINARY_SHA256" ] ||
  ! printf '%s  %s\n' "$NIBRUNNER_BINARY_SHA256" /usr/local/bin/nibrunnerd | sha256sum --check --status; then
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q nftables e2fsprogs xfsprogs util-linux mount nbd-client fuse3 kmod passwd curl ca-certificates awscli libarchive-tools
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
  printf '%s\n' "$NIBRUNNER_BINARY_SHA256" > "$marker"
fi

bash install_storage_environment.sh
nibrunnerd start
systemctl is-active --quiet nibrunnerd.service
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:9100/metrics > /dev/null
nibrunnerd --version
