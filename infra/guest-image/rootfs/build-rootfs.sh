#!/bin/bash
# Assembles the guest rootfs and writes it as an ext4 image without ever mounting
# one — mkfs.ext4 -d needs no loop device and no privileged container.
set -euo pipefail

: "${SOURCE_DATE_EPOCH:?}" "${ROOTFS_UUID:?}" "${ROOTFS_HASH_SEED:?}" "${ROOTFS_LABEL:?}"

root=/rootfs
out=/out
staged_init=/staged-init

# Everything a `bun build --compile` binary links against at runtime, and nothing
# else. The tenant binary and /init are the only things that ever execute, so the
# image carries no shell, no package manager and no init system.
runtime_packages=(libc6 libgcc-s1 libstdc++6 ca-certificates)

block_size=4096
inode_margin=512
free_space_kib=4096
content_headroom_percent=115

step() { printf '\n=== %s ===\n' "$*"; }

step 'Installing the runtime package set into the builder'
apt-get install -y --no-install-recommends "${runtime_packages[@]}"

step 'Laying out the root'
mkdir -p "$root"/usr/{bin,lib,lib64,sbin} "$root"/etc/ssl/certs
# Mounted by /init: the pseudo-filesystems, then a tmpfs at /app it can create
# the tenant's data/ under, then the read-only squashfs holding the artifact.
# Every one of these has to exist here — a mount point cannot be created on a
# read-only root.
mkdir -p "$root"/{proc,sys,dev,run,mnt/artifact,app}
mkdir -p "$root/tmp"
chmod 1777 "$root/tmp"
# base-files owns these on a merged-/usr Debian and we do not install it. A
# `bun build --compile` binary's PT_INTERP is /lib64/ld-linux-x86-64.so.2, which
# resolves through /lib64 and nowhere else.
ln -s usr/bin "$root/bin"
ln -s usr/lib "$root/lib"
ln -s usr/lib64 "$root/lib64"
ln -s usr/sbin "$root/sbin"

step 'Harvesting the runtime packages'
dpkg -L "${runtime_packages[@]}" |
  LC_ALL=C sort -u |
  grep -vE '^/usr/share/(doc|man|info|lintian|locale|i18n|bug|gcc|gdb)(/|$)' |
  while IFS= read -r path; do
    [ -e "$path" ] || [ -L "$path" ] || continue
    printf '%s\n' "${path#/}"
  done >/tmp/harvest
tar -C / --no-recursion -cf - -T /tmp/harvest | tar -C "$root" -xf -

# update-ca-certificates generates the bundle and the hash symlinks in postinst,
# so dpkg does not own them and a dpkg -L harvest alone leaves the image with a
# certificate directory and no certificates in it.
cp -a /etc/ssl/certs/. "$root/etc/ssl/certs/"

step 'Writing the static /etc'
# Numerically what Debian itself uses, so nothing here invents an identity. /init
# has no passwd parser and drops to a uid; these exist for the tenant binary's
# own getpwuid/getgrgid calls.
cat >"$root/etc/passwd" <<'EOF'
root:x:0:0:root:/:/dev/null
nobody:x:65534:65534:nobody:/nonexistent:/dev/null
EOF
cat >"$root/etc/group" <<'EOF'
root:x:0:
nogroup:x:65534:
EOF
cat >"$root/etc/hosts" <<'EOF'
127.0.0.1 localhost
::1 localhost
EOF
echo nibrun >"$root/etc/hostname"
# libc-bin owns nsswitch.conf and we do not ship libc-bin. Without the file
# glibc falls back to a compiled-in policy; writing it makes name resolution the
# same thing on every image rather than a property of the glibc build.
cat >"$root/etc/nsswitch.conf" <<'EOF'
passwd: files
group: files
shadow: files
hosts: files dns
services: files
protocols: files
EOF
# The root is read-only and the guest has no DHCP client to write a resolver, so
# /init writes one into the /run tmpfs and this points at it.
ln -s ../run/resolv.conf "$root/etc/resolv.conf"

step 'Generating the loader cache'
cat >"$root/etc/ld.so.conf" <<'EOF'
/usr/lib/x86_64-linux-gnu
/usr/lib
EOF
ldconfig -r "$root"

step 'Installing /init'
install -m 0755 "$staged_init" "$root/init"
file "$root/init"
file "$root/init" | grep -q 'ELF 64-bit LSB.*x86-64'
if readelf -l "$root/init" | grep -q INTERP; then
  echo 'init is dynamically linked; resolving its libraries inside the image'
  chroot "$root" /lib64/ld-linux-x86-64.so.2 --list /init | tee /tmp/init-libraries
  if grep -q 'not found' /tmp/init-libraries; then
    echo 'init needs a library the image does not carry' >&2
    exit 1
  fi
else
  echo 'init is statically linked'
fi

step 'Proving the image can exec a dynamically linked glibc/libstdc++ binary'
cat >/tmp/probe.cc <<'EOF'
#include <cstdio>
#include <string>
int main() {
  std::string message = "glibc + libstdc++ exec ok";
  std::printf("%s\n", message.c_str());
  return 0;
}
EOF
g++ -O0 -o "$root/.probe" /tmp/probe.cc
chroot "$root" /.probe
rm -f "$root/.probe"

step 'Normalising timestamps'
find "$root" -exec touch -h -d "@${SOURCE_DATE_EPOCH}" {} +

step 'Building the ext4 image'
content_kib=$(du -sk "$root" | cut -f1)
inode_count=$(($(find "$root" | wc -l) + inode_margin))
size_kib=$((content_kib * content_headroom_percent / 100 + free_space_kib))
block_count=$((size_kib * 1024 / block_size))
echo "content ${content_kib} KiB, ${inode_count} inodes, image ${size_kib} KiB"

mkdir -p "$out"
# No journal: the root is mounted ro for the life of the VM, so a journal costs
# megabytes and mount time to protect writes that never happen. No resize inode
# and no reserved blocks for the same reason. All three would otherwise default on.
mkfs.ext4 -q -F \
  -b "$block_size" \
  -m 0 \
  -I 256 \
  -N "$inode_count" \
  -L "$ROOTFS_LABEL" \
  -U "$ROOTFS_UUID" \
  -E "root_owner=0:0,hash_seed=${ROOTFS_HASH_SEED}" \
  -O '^has_journal,^resize_inode' \
  -d "$root" \
  "$out/rootfs.ext4" "$block_count"

step 'Verifying the image'
e2fsck -fn "$out/rootfs.ext4"
dumpe2fs -h "$out/rootfs.ext4"
debugfs -R 'ls -l /' "$out/rootfs.ext4"
debugfs -R 'ls -l /usr/lib/x86_64-linux-gnu' "$out/rootfs.ext4"
debugfs -R 'stat /init' "$out/rootfs.ext4" | head -5

dpkg-query -W -f='${Package}=${Version}\n' "${runtime_packages[@]}" >"$out/packages"
cat "$out/packages"
