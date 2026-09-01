#!/bin/bash
# Puts /data on the instance store, and is the only thing that may.
#
# An app host's /data holds nothing but caches: ZeroFS's, and a checkpoint
# server's while an export reads. S3 is the source of truth for every byte of it,
# which is what makes an ephemeral disk the right medium rather than a tolerable
# one — the EBS volume it replaces was paying for durability nothing here wants.
#
# Run from a unit at boot rather than from the deploy, because the disk is blank
# every time the instance starts. A spot reclaim stops the host and AWS hands the
# replacement a fresh, unformatted device, so a filesystem made once at deploy
# time would be gone by the time anything looked for it.
set -euo pipefail

log() { echo "=== [ensure_ephemeral_data $(date -u +%H:%M:%S)] $* ==="; }

MOUNT_POINT=/data
# Every instance-store namespace answers to this, and only those do: an EBS volume
# is `nvme-Amazon_Elastic_Block_Store_*` under the same directory. Matching the
# model rather than a device number is what keeps this right when the kernel
# enumerates the NVMe controllers in a different order.
STORE_GLOB='/dev/disk/by-id/nvme-Amazon_EC2_NVMe_Instance_Storage_*'

device=""
for candidate in $STORE_GLOB; do
  # A namespace and its partitions both match; the partitions carry a -partN
  # suffix and are not what this formats.
  case "$candidate" in
    *-part[0-9]*) continue ;;
  esac
  [ -e "$candidate" ] || continue
  device="$candidate"
  break
done

# Louder than falling back to the root volume: ZeroFS is configured for a 70 GB
# cache and the root disk is 50 GB, so a /data that is quietly a directory fills
# the disk the host itself runs from. The unit that calls this is required by
# nibrun-zerofs.service, so failing here is what stops that.
if [ -z "$device" ]; then
  log "no instance store found — this host cannot serve /data"
  exit 1
fi
log "instance store is $device"

mkdir -p "$MOUNT_POINT"

# A deploy re-runs this while ZeroFS holds the cache underneath it, so finding the
# disk already mounted is the ordinary case and not an error. Finding anything
# else there is: nothing mounts /data but this, so mounting over whatever
# took it would hide a disk something is using rather than replace it.
if mountpoint -q "$MOUNT_POINT"; then
  current=$(findmnt -no SOURCE "$MOUNT_POINT")
  if [ "$(readlink -f "$current")" != "$(readlink -f "$device")" ]; then
    log "${MOUNT_POINT} is mounted from ${current}, which is not the instance store"
    exit 1
  fi
  log "already mounted from the instance store"
  exit 0
fi

# Blank on every start, so this is the ordinary path rather than the first-run
# one. `blkid` answering means a filesystem survived, which happens on a reboot
# that kept the instance rather than stopping it.
if ! blkid "$device" >/dev/null 2>&1; then
  log "formatting a blank instance store"
  mkfs.xfs -f "$device"
fi

mount "$device" "$MOUNT_POINT"
log "mounted $device at $MOUNT_POINT"

# Recreated on every boot because the disk they were on did not survive. The
# owner exists already — it is made by the deploy, on the root volume — but on a
# host whose first boot precedes its first deploy it does not, and a directory
# left owned by root is corrected by the deploy that creates the user.
owner=$1
shift
for directory in "$@"; do
  mkdir -p "${MOUNT_POINT}/${directory}"
  if id -u "$owner" >/dev/null 2>&1; then
    chown "${owner}:${owner}" "${MOUNT_POINT}/${directory}"
  fi
done
