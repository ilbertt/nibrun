#!/usr/bin/env bash
# Shared by build.sh and version.sh. Not executable on its own.

guest_image_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$guest_image_dir/../.." && pwd)

# shellcheck disable=SC1091
set -a && . "$guest_image_dir/versions.env" && set +a

# macOS ships shasum, Linux ships sha256sum, and the version has to come out the
# same on a laptop and on the runner that publishes it.
if command -v sha256sum >/dev/null 2>&1; then
  sha256_stream() { sha256sum | cut -d' ' -f1; }
else
  sha256_stream() { shasum -a 256 | cut -d' ' -f1; }
fi

sha256_file() { sha256_stream <"$1"; }

die() {
  echo "guest-image: $*" >&2
  exit 1
}

runtime_init_path() {
  echo "${RUNTIME_INIT:-$repo_root/apps/runtime/dist/init}"
}

require_runtime_init() {
  local init
  init=$(runtime_init_path)
  [ -f "$init" ] || die "guest runtime binary not found at $init
apps/runtime must be built first, or point RUNTIME_INIT at the binary.
For a local build with no runtime, set GUEST_IMAGE_STUB_INIT=1 to substitute a
throwaway /init — it changes the computed version, so a stub build can never be
mistaken for a publishable one."
  echo "$init"
}
