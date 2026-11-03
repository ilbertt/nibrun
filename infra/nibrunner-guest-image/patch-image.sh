#!/bin/bash
set -euo pipefail

target=$1
epoch=$(sed -n 's/.*"source_date_epoch": \([0-9]*\).*/\1/p' /stock/manifest.json)
test -n "$epoch"
export E2FSPROGS_FAKE_TIME=$epoch
cp --sparse=always /stock/rootfs.ext4 "$target"
debugfs -R 'dump /init /original-init' "$target"
touch -d "@$epoch" /image-init /original-init
cat > /patch.commands <<'COMMANDS'
mkdir /usr/lib/nibrun
write /original-init /usr/lib/nibrun/nibrunner-init
set_inode_field /usr/lib/nibrun/nibrunner-init mode 0100755
rm /init
write /image-init /init
set_inode_field /init mode 0100755
COMMANDS
debugfs -w -f /patch.commands "$target"
e2fsck -fn "$target"
