#!/bin/sh
# Gives test-mounts the two block devices it needs: a squashfs holding a binary at
# /server, and an ext4 filesystem. Both are loop devices, which is why this needs a
# privileged container — nothing else here does.
set -eu

# Docker's /dev is a tmpfs it manages, so the nodes losetup creates through
# /dev/loop-control would never appear in it.
mount -t devtmpfs devtmpfs /dev

mkdir -p /tmp/artifact
cp /fake-tenant /tmp/artifact/server
mksquashfs /tmp/artifact /tmp/artifact.squashfs -noappend -no-progress -quiet

truncate -s 32M /tmp/data.ext4
mkfs.ext4 -q -F /tmp/data.ext4

squashfs_device=$(losetup -f --show /tmp/artifact.squashfs)
ext4_device=$(losetup -f --show /tmp/data.ext4)

exec /test-mounts "$squashfs_device" "$ext4_device"
