#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"
exec 9>/run/nibrun-nibrunner-bridge-deploy.lock
flock -w 300 9

: "${AGENT_VERSION:?}" "${AGENT_URL:?}" "${AGENT_SHA256:?}" "${AGENT_AWS_REGION:?}"
[[ "$AGENT_VERSION" =~ ^[0-9a-f]{40}$ ]]
[[ "$AGENT_SHA256" =~ ^[0-9a-f]{64}$ ]]

if [ -e /var/lib/nibrun/host-id ]; then
  echo "refusing to install the nibrunner bridge over a registered legacy host" >&2
  exit 1
fi
if [ ! -e /var/lib/nibrunner/bridge/host-id ] && [ -e /var/lib/nibrunner/desired.json ]; then
  echo "commission the existing engine state before registering the bridge" >&2
  exit 1
fi
systemctl is-active --quiet nibrunnerd.service

if ! command -v aws >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y awscli
fi

base=/opt/nibrun/nibrunner-host/bridge
release="$base/versions/$AGENT_VERSION"
install -d -m 0700 "$release" /etc/nibrunner
temporary=$(mktemp "$base/.agent.XXXXXX")
trap 'rm -f "$temporary" "$base/current.next"' EXIT

if [ ! -f "$release/nibrun-agent" ] ||
  ! printf '%s  %s\n' "$AGENT_SHA256" "$release/nibrun-agent" | sha256sum --check --status 2>/dev/null; then
  aws --region "$AGENT_AWS_REGION" s3 cp --no-progress "$AGENT_URL" "$temporary"
  printf '%s  %s\n' "$AGENT_SHA256" "$temporary" | sha256sum --check
  chmod 0755 "$temporary"
  mv "$temporary" "$release/nibrun-agent"
fi

install -m 0600 bridge.env /etc/nibrunner/bridge.env
install -m 0644 nibrun-nibrunner-bridge.service /etc/systemd/system/nibrun-nibrunner-bridge.service
ln -sfn "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
systemctl daemon-reload

systemctl enable nibrun-nibrunner-bridge.service
systemctl restart nibrun-nibrunner-bridge.service
systemctl is-active --quiet nibrun-nibrunner-bridge.service
