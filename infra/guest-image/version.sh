#!/usr/bin/env bash
# Prints the guest image version: a digest of everything the build reads.
#
# Deliberately an over-approximation — it covers every file under this directory,
# including this one and the docs. A doc edit therefore costs one rebuild, while
# an input the digest failed to cover would publish a different image under a
# version already on the hosts. Only one of those two failures is recoverable.
#
# CI computes this before deciding whether to build at all, which is why it takes
# only Docker-free shell and why the runtime binary has to exist first.
set -euo pipefail

# shellcheck source=lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

DIGEST_CHARS=12

if [ "${GUEST_IMAGE_STUB_INIT:-0}" = "1" ]; then
  init_sha=stub
else
  init=$(require_runtime_init)
  init_sha=$(sha256_file "$init")
fi

input_lines() {
  cd "$guest_image_dir"
  # .DS_Store would otherwise put a Mac and a runner on different versions.
  find . \( -type f -o -type l \) \
    -not -path './dist/*' \
    -not -name .DS_Store \
    -print |
    LC_ALL=C sort |
    while IFS= read -r path; do
      if [ -L "$path" ]; then
        printf 'link %s %s\n' "${path#./}" "$(readlink "$path")"
      elif [ -x "$path" ]; then
        printf '755 %s %s\n' "${path#./}" "$(sha256_file "$path")"
      else
        printf '644 %s %s\n' "${path#./}" "$(sha256_file "$path")"
      fi
    done
  printf 'init %s\n' "$init_sha"
}

digest=$(input_lines | sha256_stream)
echo "${KERNEL_VERSION}-${digest:0:$DIGEST_CHARS}"
