#!/bin/bash
# Runs ON the instance before the compose stack is touched. Mounts the
# persistent EBS data volume at /data and prepares the directories the prod
# compose file binds the data-bearing named volumes to, so that data survives
# instance replacement. Docker's own state (images, containers, derived volumes)
# stays on the root disk — every deploy rebuilds it.
# Idempotent: a no-op once the volume is mounted and the directories exist.
set -euo pipefail

: "${DATA_VOLUME_ID:?}"

log() { echo "=== [ensure_data_volume $(date -u +%H:%M:%S)] $* ==="; }

# Nitro instances expose EBS volumes as NVMe; the volume id (sans dash) is the
# device serial, so this by-id path is stable regardless of attach order — and
# unlike /dev/nvmeXn1, it survives a reboot, which matters because it ends up in
# fstab.
dev="/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${DATA_VOLUME_ID/-/}"

for _ in $(seq 1 30); do
  [ -e "$dev" ] && break
  log "waiting for ${DATA_VOLUME_ID} to attach..."
  sleep 2
done
if [ ! -e "$dev" ]; then
  log "data volume device $dev not found"
  exit 1
fi

if ! blkid "$dev" >/dev/null; then
  log "formatting blank data volume"
  mkfs.xfs "$dev"
fi

mkdir -p /data
grep -qF "$dev" /etc/fstab || echo "$dev /data xfs defaults,nofail 0 2" >> /etc/fstab
mountpoint -q /data || mount /data

# Docker does not create missing host directories for local volumes with
# `o: bind` driver_opts (unlike container bind mounts) — volume creation fails.
mkdir -p /data/volumes/postgres-data /data/volumes/gateway-data
