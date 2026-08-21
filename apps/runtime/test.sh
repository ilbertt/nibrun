#!/usr/bin/env bash
# Three suites, all in Docker for the same reason the build is: the runtime targets
# Linux and links against musl.
#
#   unit   config parsing, the tenant environment, backoff, the restart budget,
#          signal forwarding, orphan reaping — everything that needs only a process.
#   mount  the mount sequence against a real kernel, with loop devices standing in
#          for the guest's virtio-blk drives.
#   boot   the real /init as PID 1: the whole sequence, a tenant that runs, and the
#          shutdown that ends the machine.
#
# The last two need privileges the default container does not have, which is why
# they are images to run rather than more RUN steps. What none of them cover is
# listed in AGENTS.md under what only a microVM can prove.
set -euo pipefail

runtime_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
container=nibrun-runtime-boot-test
image_prefix=nibrun-runtime

# shellcheck disable=SC1091
set -a && . "$runtime_dir/versions.env" && set +a

build() {
  docker build \
    --platform=linux/amd64 \
    --build-arg BUILDER_IMAGE="$BUILDER_IMAGE" \
    --build-arg DEBIAN_SNAPSHOT="$DEBIAN_SNAPSHOT" \
    --progress=plain \
    "$@" \
    "$runtime_dir"
}

require() {
  local description=$1
  shift
  if "$@"; then
    echo "ok: $description"
  else
    echo "FAIL: $description" >&2
    exit 1
  fi
}

contains() { grep -qF "$2" <<<"$1"; }

echo '=== unit tests ==='
# Never cached: a test whose result was reused is a test that did not run, and these
# assert on real elapsed time.
build --target=unit-test --no-cache-filter=unit-test --output type=cacheonly

echo '=== mount tests ==='
build --target=mount-test --tag "$image_prefix-mount-test"
docker run --rm --privileged --platform=linux/amd64 "$image_prefix-mount-test"

echo '=== boot test ==='
build --target=boot-test --tag "$image_prefix-boot-test"
docker rm -f "$container" >/dev/null 2>&1 || true
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT

# Not --privileged: that hands the container the host's own /dev, where vdb and vdc
# are real disks and cannot be stood in for. These are the capabilities /init
# actually uses — mounting, making device nodes, and ending the machine — and the
# default seccomp and apparmor profiles refuse the first and the last regardless.
docker run --detach --name "$container" --platform=linux/amd64 \
  --cap-add SYS_ADMIN --cap-add MKNOD --cap-add SYS_BOOT \
  --security-opt apparmor=unconfined --security-opt seccomp=unconfined \
  --device-cgroup-rule 'b *:* rwm' --device-cgroup-rule 'c *:* rwm' \
  "$image_prefix-boot-test" >/dev/null

report=''
for _ in $(seq 1 60); do
  report=$(docker exec "$container" cat /app/data/report 2>/dev/null || true)
  [ -n "$report" ] && break
  sleep 1
done

require 'the tenant runs unprivileged, in /app, on the port and under the name the config gave it' \
  contains "$report" 'PORT=8080 NIBRUN_HOSTNAME=boot-test.nibrun.app HOME=/app CWD=/app UID=65534 GID=65534'

mounts=$(docker exec "$container" cat /proc/1/mounts)
require 'the artifact is read-only and the data filesystem is not' \
  contains "$mounts" '/mnt/artifact squashfs ro,nosuid,nodev'
require 'the tenant volume is mounted noatime' contains "$mounts" '/app/data ext4 rw,nosuid,nodev,noatime'
require 'the config drive, which carries the secrets, is gone' \
  bash -c "! grep -q /run/config <<<'$mounts'"

echo "PID 1 memory: $(docker exec "$container" grep VmRSS /proc/1/status)"

docker kill --signal TERM "$container" >/dev/null
exit_code=$(docker wait "$container")
require 'the guest ends the machine rather than lingering' [ "$exit_code" = 129 ]

logs=$(docker logs "$container" 2>&1)
require 'the tenant was asked to stop and did' contains "$logs" 'the tenant has stopped'
require 'no tenant had to be killed' bash -c "! grep -q 'killing it' <<<'$logs'"

image=$(mktemp "${TMPDIR:-/tmp}/nibrun-data.XXXXXX")
docker cp "$container:/images/data.ext4" "$image" >/dev/null
volume=$(docker run --rm --platform=linux/amd64 -v "$image:/data.ext4" --entrypoint /bin/sh \
  "$image_prefix-boot-test" -ec 'debugfs -R "cat /report" /data.ext4 2>/dev/null; dumpe2fs -h /data.ext4 2>/dev/null | grep "Filesystem state"')
rm -f "$image"

require 'what the tenant wrote reached the block device' contains "$volume" 'term'
require 'the volume was unmounted before the machine ended' contains "$volume" 'clean'
