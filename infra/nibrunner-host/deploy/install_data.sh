#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v mkfs.xfs >/dev/null; then
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q xfsprogs util-linux
fi

install -m 0644 nibrunner-data.service /etc/systemd/system/nibrunner-data.service
for service in nibrunnerd nibrunner-zerofs; do
  install -D -m 0644 data.conf "/etc/systemd/system/${service}.service.d/data.conf"
done

systemctl daemon-reload
systemctl enable --now nibrunner-data.service
mountpoint -q /data
