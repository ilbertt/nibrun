#!/bin/bash
# Runs ON an instance, before anything touches the data. Mounts the persistent
# EBS data volume and creates the directories the workload expects under it, so
# data survives instance replacement. The root disk holds only what every deploy
# can rebuild.
#
#   MOUNT_POINT     where to mount (required)
#   SUBDIRS         space-separated dirs to create under MOUNT_POINT (optional)
#   DATA_VOLUME_ID  vol-… to mount (optional). Omit it and the single non-root
#                   EBS volume attached to this instance is used — which is what
#                   the agent rollout does, since one command fans out to every
#                   host and each has a different volume.
#
# Idempotent: a no-op once the volume is mounted and the directories exist.
set -euo pipefail

: "${MOUNT_POINT:?}"
SUBDIRS="${SUBDIRS:-}"
DATA_VOLUME_ID="${DATA_VOLUME_ID:-}"

log() { echo "=== [ensure_data_volume $(date -u +%H:%M:%S)] $* ==="; }

# Nitro instances expose EBS volumes as NVMe; the volume id (sans dash) is the
# device serial, so this by-id path is stable regardless of attach order. Both
# resolvers return the by-id link, never the /dev/nvmeXn1 it points at — NVMe
# enumeration order can change across reboots, and this path ends up in fstab.
resolve_by_id() {
  local dev="/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${DATA_VOLUME_ID/-/}"
  for _ in $(seq 1 30); do
    [ -e "$dev" ] && { printf '%s\n' "$dev"; return 0; }
    log "waiting for ${DATA_VOLUME_ID} to attach..."
    sleep 2
  done
  log "data volume device $dev not found"
  return 1
}

# Everything EBS-backed except the disk holding /.
discover_data_device() {
  local root_disk found=()
  root_disk="$(lsblk -no PKNAME "$(findmnt -no SOURCE /)")"

  for _ in $(seq 1 30); do
    found=()
    for link in /dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_vol*; do
      [ -e "$link" ] || continue
      case "$link" in *-part*) continue ;; esac
      [ "$(basename "$(readlink -f "$link")")" = "$root_disk" ] && continue
      found+=("$link")
    done
    [ "${#found[@]}" -ge 1 ] && break
    log "waiting for a data volume to attach..."
    sleep 2
  done

  if [ "${#found[@]}" -ne 1 ]; then
    log "expected exactly one non-root EBS volume, found ${#found[@]}: ${found[*]:-none}"
    log "set DATA_VOLUME_ID to pick one explicitly"
    return 1
  fi
  printf '%s\n' "${found[0]}"
}

if [ -n "$DATA_VOLUME_ID" ]; then
  dev="$(resolve_by_id)"
else
  dev="$(discover_data_device)"
fi
log "using data device $dev"

if ! blkid "$dev" >/dev/null; then
  log "formatting blank data volume"
  mkfs.xfs "$dev"
fi

mkdir -p "$MOUNT_POINT"
# Match on the resolved device rather than the by-id link so a re-run after a
# reboot does not append a second fstab entry.
grep -qF " $MOUNT_POINT " /etc/fstab || echo "$dev $MOUNT_POINT xfs defaults,nofail 0 2" >> /etc/fstab
mountpoint -q "$MOUNT_POINT" || mount "$MOUNT_POINT"

# Docker does not create missing host directories for local volumes with
# `o: bind` driver_opts (unlike container bind mounts) — volume creation fails.
for subdir in $SUBDIRS; do
  mkdir -p "$MOUNT_POINT/$subdir"
done
