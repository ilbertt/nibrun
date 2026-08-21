#!/bin/sh
# Boots the real /init as PID 1 with stand-in drives: loop devices wearing the
# virtio-blk names the guest boot contract gives them. Everything /init does from
# there is the code path a microVM takes.
#
# devtmpfs is mounted only long enough to reach the loop devices and is then put
# back, because the host's own /dev/vdb is a real disk and the guest's is not. The
# nodes /init opens are made in the container's own /dev.
#
# What a container cannot reproduce: virtio-blk drives and a read-only root;
# ctrl-alt-del arriving as a signal, since reboot(RB_DISABLE_CAD) returns EINVAL
# outside the initial PID namespace — /init reports that and carries on; and a guest
# reset ending the microVM, which here terminates the PID namespace instead. That
# last one is what makes this container exit when the tenant stops.
set -eu

mkdir -p /images/artifact /images/config
cp /fake-tenant /images/artifact/server

cat >/images/config/instance.env <<'ENV'
NIBRUN_PORT=8080
NIBRUN_HOSTNAME=boot-test.nibrun.app
NIBRUN_MAX_RESTARTS=5
NIBRUN_INITIAL_BACKOFF_MS=100
NIBRUN_MAX_BACKOFF_MS=1000
NIBRUN_BACKOFF_FACTOR=2
NIBRUN_RESET_AFTER_MS=60000
NIBRUN_DNS=1.1.1.1,8.8.8.8
ENV_FAKE_MODE=serve
ENV_FAKE_RECORD=data/report
ENV

mksquashfs /images/artifact /images/artifact.squashfs -noappend -no-progress -quiet
mksquashfs /images/config /images/config.squashfs -noappend -no-progress -quiet
truncate -s 32M /images/data.ext4
mkfs.ext4 -q -F /images/data.ext4

mount -t devtmpfs devtmpfs /dev
artifact_device=$(losetup -f --show /images/artifact.squashfs)
config_device=$(losetup -f --show /images/config.squashfs)
data_device=$(losetup -f --show /images/data.ext4)
identify() { stat -c '%t %T' "$1"; }
artifact_ids=$(identify "$artifact_device")
config_ids=$(identify "$config_device")
data_ids=$(identify "$data_device")
umount /dev

name_device() {
  mknod "/dev/$1" b "$((0x$2))" "$((0x$3))"
}
# shellcheck disable=SC2086
name_device vdb $artifact_ids
# shellcheck disable=SC2086
name_device vdc $config_ids
# shellcheck disable=SC2086
name_device vdd $data_ids

echo "boot test: vdb=$artifact_device vdc=$config_device vdd=$data_device"
exec /init
