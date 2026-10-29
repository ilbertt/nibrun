#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

: "${NIBRUNNER_VERSION:?}" "${NIBRUNNER_INSTALLER_SHA256:?}" "${NIBRUNNER_BINARY_SHA256:?}"

if [ -e /var/lib/nibrun/host-id ]; then
  echo "refusing to install nibrunner over a registered legacy app host" >&2
  exit 1
fi

modprobe kvm_intel
test -c /dev/kvm

install -d -m 0700 /etc/nibrunner
if ! cmp -s config.toml /etc/nibrunner/config.toml; then
  install -m 0600 config.toml /etc/nibrunner/config.toml
fi

marker=/opt/nibrun/nibrunner-host/installed-binary.sha256
if [ ! -f "$marker" ] || [ "$(cat "$marker")" != "$NIBRUNNER_BINARY_SHA256" ] ||
  ! printf '%s  %s\n' "$NIBRUNNER_BINARY_SHA256" /usr/local/bin/nibrunnerd | sha256sum --check --status; then
  installer=$(mktemp)
  trap 'rm -f "$installer"' EXIT
  curl -fsSL --retry 3 \
    "https://raw.githubusercontent.com/ilbertt/nibrunner/${NIBRUNNER_VERSION}/deploy/install.sh" \
    -o "$installer"
  printf '%s  %s\n' "$NIBRUNNER_INSTALLER_SHA256" "$installer" | sha256sum --check
  export NIBRUNNER_VERSION
  bash "$installer"
  printf '%s  %s\n' "$NIBRUNNER_BINARY_SHA256" /usr/local/bin/nibrunnerd | sha256sum --check
  systemctl daemon-reload
  systemctl try-restart nibrunnerd.service
  printf '%s\n' "$NIBRUNNER_BINARY_SHA256" > "$marker"
fi

nibrunnerd start
systemctl is-active --quiet nibrunnerd.service
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:9100/metrics > /dev/null
nibrunnerd --version
