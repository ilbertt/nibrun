#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"
exec 9>/run/nibrunner-metrics-deploy.lock
flock -w 300 9
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -q curl ca-certificates
install -d -m 0755 /etc/apt/keyrings
curl -fsSL --retry 3 https://apt.grafana.com/gpg-full.key -o "$work/grafana.asc"
install -m 0644 "$work/grafana.asc" /etc/apt/keyrings/grafana.asc
printf '%s\n' 'deb [signed-by=/etc/apt/keyrings/grafana.asc] https://apt.grafana.com stable main' \
  > /etc/apt/sources.list.d/grafana.list
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -q alloy
systemctl disable --now alloy.service

alloy validate metrics.alloy
install -d -m 0755 /etc/nibrunner-metrics
install -m 0644 metrics.alloy /etc/nibrunner-metrics/config.alloy
install -m 0644 nibrun-nibrunner-metrics.service /etc/systemd/system/nibrun-nibrunner-metrics.service
systemctl daemon-reload
systemctl enable nibrun-nibrunner-metrics.service

record_activation() {
  sha256sum "$(command -v alloy)" /etc/nibrunner-metrics/config.alloy \
    /etc/systemd/system/nibrun-nibrunner-metrics.service
  systemctl show nibrun-nibrunner-metrics.service --property=InvocationID --value
}

record_activation > "$work/activation"
if ! systemctl is-active --quiet nibrun-nibrunner-metrics.service ||
  ! cmp -s "$work/activation" /etc/nibrunner-metrics/applied; then
  systemctl restart nibrun-nibrunner-metrics.service
fi

for _ in $(seq 1 60); do
  if curl --fail --silent --max-time 2 http://127.0.0.1:12345/-/ready > /dev/null; then
    systemctl is-active --quiet nibrun-nibrunner-metrics.service
    record_activation > "$work/activation"
    install -m 0644 "$work/activation" /etc/nibrunner-metrics/applied
    exit 0
  fi
  sleep 1
done
echo "the nibrunner metrics collector did not become ready" >&2
exit 1
